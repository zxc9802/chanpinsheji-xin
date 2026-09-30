// 渲染流水线：按 stage 分三轮生成，后一轮以前一轮的成图作为一致性参考
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { VIEWS, viewById, buildPrompt } from './prompts.js';
import { generateImage } from './fal.js';
import { getProject, updateProject, saveFile, localPathFromPublic } from './store.js';
import { imageMime } from './references.js';

const running = new Set();

const SIZE = { view: 'square_hd', kv: 'landscape_16_9' };

async function fileToDataUri(publicPath) {
  const local = localPathFromPublic(publicPath);
  if (!local) throw new Error('参考图路径无效');
  const buf = await fs.readFile(local);
  const mime = imageMime(buf);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 优先复用 fal 的远程地址（请求体小），失效时退回本地文件
async function depImageUrl(img) {
  if (img.remoteUrl) {
    try {
      const head = await fetch(img.remoteUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      if (head.ok) return img.remoteUrl;
    } catch {}
  }
  return fileToDataUri(img.file);
}

async function downloadImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载成图失败（${res.status}）`);
  return Buffer.from(await res.arrayBuffer());
}

export const isRunning = (projectId, viewId) => running.has(`${projectId}:${viewId}`);

export async function buildViewInput(project, viewId, { extra = '' } = {}) {
  const view = viewById(viewId);
  const deps = view.deps.filter((d) => project.images?.[d]?.status === 'done' && project.images[d].file);
  const depUrls = await Promise.all(deps.map((d) => depImageUrl(project.images[d])));
  const userRefs = await Promise.all((project.refs || []).map((r) => fileToDataUri(r.file)));
  const match = project.referenceMatch;
  const libraryImages = await Promise.all((match?.images || []).map(async (asset) => {
    const uri = await fileToDataUri(asset.file);
    const hash = crypto.createHash('sha256').update(Buffer.from(uri.split(',')[1], 'base64')).digest('hex');
    if (hash !== asset.sha256) throw new Error('项目参考图已变更，请重新匹配后生成');
    return uri;
  }));
  const imageUrls = [...depUrls, ...userRefs, ...libraryImages];
  if (imageUrls.length > 16) throw new Error('参考图片超过模型输入上限');
  return {
    prompt: buildPrompt(project.brief, viewId, { depRefs: deps, userRefCount: userRefs.length, referenceMatch: match, extra }),
    imageUrls,
    imageSize: view.group === 'kv' ? SIZE.kv : SIZE.view,
    quality: project.options?.quality || 'high',
    referenceInputs: [
      ...deps.map(id => ({ role: 'generated_view', view: id, file: project.images[id].file })),
      ...(project.refs || []).map(r => ({ role: 'user_upload', file: r.file })),
      ...(match?.images || []).map(a => ({ role: 'library', productId: a.productId, layer: a.role, file: a.file, sha256: a.sha256 })),
    ],
  };
}

// 出一张图的通用流程：提交 → 轮询 → 下载落盘 → 记录版本。
// slot 指明结果写在项目里的哪个位置（整套视图的 images[viewId]，或平行方向的 directions[i].image）
async function renderImage({ projectId, key, viewId, extra = '', slot, contextOf, stem }) {
  if (running.has(key)) return;
  running.add(key);
  const patch = (fn) => updateProject(projectId, (p) => slot.set(p, fn(slot.get(p) || {})));
  try {
    const project = await getProject(projectId);
    const { referenceInputs, ...input } = await buildViewInput(contextOf(project), viewId, { extra });
    const { prompt } = input;

    await patch((img) => ({ ...img, status: 'running', phase: 'SUBMITTING', prompt, referenceInputs, extra, startedAt: Date.now(), error: null }));

    input.onStatus = (phase) => patch((img) => ({ ...img, phase })).catch(() => {});

    let remoteUrl;
    for (let attempt = 0; ; attempt++) {
      try {
        remoteUrl = await generateImage(input);
        break;
      } catch (err) {
        // 4xx（除限流）说明请求本身有问题，重试无意义
        const retriable = !err.status || err.status >= 500 || err.status === 429;
        if (attempt >= 1 || !retriable) throw err;
        await patch((img) => ({ ...img, phase: 'RETRYING' }));
      }
    }

    const buffer = await downloadImage(remoteUrl);
    const file = await saveFile(projectId, 'images', `${stem}-${Date.now()}.png`, buffer);
    await patch((prev) => {
      const versions = [...(prev.versions || []), { file, remoteUrl, prompt, referenceInputs, extra, createdAt: Date.now() }];
      return { ...prev, status: 'done', phase: 'COMPLETED', file, remoteUrl, finishedAt: Date.now(), versions, error: null };
    });
  } catch (err) {
    console.error(`[${stem}]`, err.message);
    await patch((img) => ({ ...img, status: 'error', phase: 'FAILED', error: err.message, finishedAt: Date.now() })).catch(() => {});
  } finally {
    running.delete(key);
  }
}

export function runView(projectId, viewId, { extra = '' } = {}) {
  return renderImage({
    projectId, key: `${projectId}:${viewId}`, viewId, extra, stem: viewId,
    contextOf: (project) => project,
    slot: { get: (p) => p.images[viewId], set: (p, img) => (p.images[viewId] = img) },
  });
}

// 平行方向的预览：每个方向用它自己的简报与 JEV 参考，只出外包装正视图
const directionKey = (projectId, directionId) => `${projectId}:dir:${directionId}`;
export const isDirectionRunning = (projectId, directionId) => running.has(directionKey(projectId, directionId));

function runDirectionView(projectId, directionId) {
  const find = (p) => p.directions?.find((d) => d.id === directionId);
  return renderImage({
    projectId, key: directionKey(projectId, directionId), viewId: 'outer_front', stem: `dir-${directionId}`,
    contextOf: (project) => {
      const d = find(project);
      if (!d) throw new Error('设计方向已被替换，请重新选择');
      return { ...project, brief: d.brief, referenceMatch: d.match, images: {} };
    },
    slot: { get: (p) => find(p)?.image, set: (p, img) => { const d = find(p); if (d) d.image = img; } },
  });
}

export async function runDirections(projectId, directionIds) {
  await updateProject(projectId, (p) => {
    for (const d of p.directions || []) {
      if (directionIds.includes(d.id)) d.image = { ...d.image, status: 'queued', phase: 'WAITING', error: null, startedAt: null, finishedAt: null };
    }
    p.direction = { ...p.direction, status: 'previewing' };
  });
  await Promise.all(directionIds.map((id) => runDirectionView(projectId, id)));
  // 期间用户已经选定的话不要改回「待选择」
  await updateProject(projectId, (p) => {
    if (p.direction?.status === 'previewing') p.direction.status = 'choosing';
  });
}

export function viewsFor(options = {}) {
  return VIEWS.filter((v) => v.group !== 'kv' || options.includeKv !== false);
}

export async function runPipeline(projectId, viewIds) {
  const selected = VIEWS.filter((v) => viewIds.includes(v.id));
  await updateProject(projectId, (p) => {
    p.images ||= {};
    for (const v of selected) {
      p.images[v.id] = { ...p.images[v.id], status: 'queued', phase: 'WAITING', error: null, startedAt: null, finishedAt: null };
    }
    p.pipeline = { status: 'running', startedAt: Date.now(), views: viewIds };
  });
  for (const stage of [1, 2, 3]) {
    await Promise.all(selected.filter((v) => v.stage === stage).map((v) => runView(projectId, v.id)));
  }
  await updateProject(projectId, (p) => {
    p.pipeline = { ...p.pipeline, status: 'done', finishedAt: Date.now() };
  });
}

// 服务重启后，把中断的任务标成失败，方便前端提示重绘
export async function recoverInterrupted(project) {
  const stale = Object.entries(project.images || {}).filter(([, img]) => img.status === 'running' || img.status === 'queued');
  const staleDirs = (project.directions || []).filter((d) => d.image?.status === 'running' || d.image?.status === 'queued');
  if (!stale.length && !staleDirs.length && project.pipeline?.status !== 'running' && project.direction?.status !== 'previewing') return;
  await updateProject(project.id, (p) => {
    for (const [id] of stale) p.images[id] = { ...p.images[id], status: 'error', phase: 'FAILED', error: '服务重启，任务中断，请重绘' };
    for (const d of p.directions || []) {
      if (d.image?.status === 'running' || d.image?.status === 'queued') d.image = { ...d.image, status: 'error', phase: 'FAILED', error: '服务重启，任务中断，请重试' };
    }
    if (p.direction?.status === 'previewing') p.direction.status = 'choosing';
    if (p.pipeline) p.pipeline.status = 'done';
  });
}
