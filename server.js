import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { extractText } from './lib/parse.js';
import { analyzeDocument, designRequirements } from './lib/llm.js';
import { directionPicker, DIRECTION_COUNT, assetBytes, imageMime, loadCatalog } from './lib/references.js';
import { VIEWS, viewById } from './lib/prompts.js';
import { runPipeline, runView, runDirections, viewsFor, isRunning, isDirectionRunning, recoverInterrupted } from './lib/pipeline.js';
import { createProject, getProject, updateProject, listProjects, saveFile, localPathFromPublic, DATA_DIR } from './lib/store.js';

try {
  process.loadEnvFile('.env');
} catch {
  console.warn('未找到 .env，将只读取系统环境变量');
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 6 } });
const PORT = Number(process.env.PORT) || 3789;
const analyzing = new Set();

app.use(express.json({ limit: '2mb' }));
// 前端资源每次都校验更新，改完代码刷新即生效
app.use(express.static('public', { extensions: ['html'], setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

// 只暴露参考图与渲染图，不暴露 project.json
app.get('/files/:id/:sub/:file', async (req, res) => {
  const local = localPathFromPublic(`/files/${req.params.id}/${req.params.sub}/${req.params.file}`);
  if (!local) return res.status(404).end();
  res.sendFile(local, { maxAge: '7d' }, (err) => err && !res.headersSent && res.status(404).end());
});

const fixName = (name) => (/[^\x00-\xff]/.test(name) ? name : Buffer.from(name, 'latin1').toString('utf8'));
const publicProject = ({ docText, ...rest }) => ({ ...rest, running: VIEWS.filter((v) => isRunning(rest.id, v.id)).map((v) => v.id) });
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || '服务器错误', ...(err.stale && { stale: true }) });
  });
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const checkAnalyzing = (id) => { if (analyzing.has(id)) throw httpError(409, '正在匹配参考并整理简报，请稍后再操作'); };

// 简报带版本号：别的窗口里过期的简报不能覆盖新内容
function checkBriefRev(project, rev) {
  if (Number(rev) !== (project.briefRev || 0)) {
    throw Object.assign(httpError(409, '简报已在其他窗口更新，已为你载入最新版本'), { stale: true });
  }
}

async function requireProject(id) {
  const project = await getProject(id);
  if (!project) throw httpError(404, '项目不存在');
  return project;
}

app.get('/api/health', wrap(async (req, res) => {
  const catalog = await loadCatalog().catch(() => null);
  res.json({
    llm: Boolean(process.env.LLM_API_KEY),
    image: Boolean(process.env.FAL_KEY),
    llmModel: process.env.LLM_MODEL || 'gpt-6-luna',
    llmFallbackModel: process.env.LLM_FALLBACK_MODEL || 'deepseek-v4.1-flash',
    imageModel: process.env.IMAGE_MODEL,
    jev: Boolean(process.env.JEV_API_KEY),
    jevModel: process.env.JEV_MODEL || 'jev-1.13.0',
    referenceLibrary: Boolean(catalog),
    referenceProducts: catalog?.products.length || 0,
  });
}));

app.get('/api/views', (req, res) => res.json(VIEWS));

// 1) 上传文档 + 参考图 → 抽取文字，建立项目
app.post(
  '/api/projects',
  upload.fields([{ name: 'doc', maxCount: 1 }, { name: 'refs', maxCount: 4 }]),
  wrap(async (req, res) => {
    const docFile = req.files?.doc?.[0];
    const pasted = (req.body.text || '').trim();
    if (!docFile && !pasted) throw httpError(400, '请上传产品文档，或粘贴产品介绍文字');

    let parsed;
    let sourceName;
    if (docFile) {
      sourceName = fixName(docFile.originalname);
      try {
        parsed = await extractText(docFile.buffer, sourceName);
      } catch (err) {
        throw httpError(400, err.message);
      }
      if (pasted) parsed.text = `${parsed.text}\n\n【补充说明】\n${pasted}`.slice(0, 40000);
    } else {
      sourceName = '粘贴的文字';
      parsed = { text: pasted.slice(0, 40000), truncated: pasted.length > 40000, chars: pasted.length };
    }

    const project = await createProject({
      source: { name: sourceName, chars: parsed.chars, truncated: parsed.truncated, excerpt: parsed.text.slice(0, 600) },
      docText: parsed.text,
      refs: [],
      images: {},
      brief: null,
    });

    const refFiles = (req.files?.refs || []).filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.mimetype));
    const refs = [];
    for (const [i, f] of refFiles.entries()) {
      const ext = { 'image/png': '.png', 'image/webp': '.webp' }[f.mimetype] || '.jpg';
      refs.push({ name: fixName(f.originalname), file: await saveFile(project.id, 'refs', `ref-${i + 1}${ext}`, f.buffer) });
    }
    const saved = await updateProject(project.id, (p) => (p.refs = refs));
    res.json(publicProject(saved));
  }),
);

// 把库里的参考图落成项目自己的快照，历史渲染永远对得上当时用的参考
async function snapshotReferences(projectId, match) {
  const snapshot = crypto.randomUUID();
  for (const [i, asset] of match.images.entries()) {
    const bytes = await assetBytes(asset.productId, asset.index);
    const mime = imageMime(bytes);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
    asset.file = await saveFile(projectId, 'refs', `library-${snapshot}-${i}.${ext}`, bytes);
    asset.url = asset.file;
    asset.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  }
}

// 某个方向出错时，最多再换几个品牌顶上
const DIRECTION_REPLACEMENTS = 3;
const pickingDirection = (project) => ['previewing', 'choosing'].includes(project.direction?.status);
const previewRunning = (project) => (project.directions || []).some((d) => isDirectionRunning(project.id, d.id));

// 2) JEV 选出最多 3 个不同的参考方向 → 每个方向各写一份设计简报；多于 1 个方向时并行出正视图预览供选择
app.post(
  '/api/projects/:id/analyze',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    checkAnalyzing(project.id);
    if (project.pipeline?.status === 'running' || VIEWS.some(v => isRunning(project.id, v.id)) || project.direction?.status === 'previewing' || previewRunning(project)) throw httpError(409, '渲染进行中，请完成后重新匹配');
    analyzing.add(project.id);
    try {
      const options = { ...project.options, ...(req.body.options || {}), refCount: project.refs?.length || 0 };
      const requirements = designRequirements(options);
      const picker = await directionPicker(project.docText, requirements);
      if (picker.noMatch) throw httpError(422, '已扩大检索同类和相近设计，仍未找到可合理借鉴的参考。请检查产品资料与明确限制，或补充该类产品参考。');
      // 每个方向用自己的参考写简报，方向之间才有真正的设计差异。
      // 任何一个方向出错（简报写不出来、参考图用不了等），就换下一个品牌顶上；换品牌的总次数有上限，避免服务整体故障时无限尝试。
      let replacements = DIRECTION_REPLACEMENTS;
      const buildDirection = async () => {
        let lastError;
        for (;;) {
          const match = await picker.next();
          if (!match) throw lastError || new Error('没有更多可用的参考品牌');
          try {
            match.designRequirements = requirements;
            const brief = await analyzeDocument({ docText: project.docText, options, reference: match });
            await snapshotReferences(project.id, match);
            return { match, brief };
          } catch (err) {
            lastError = err;
            console.warn(`[directions] ${match.primary.brand} 未能生成方向：${err.message}${replacements > 0 ? '，换一个品牌' : ''}`);
            if (replacements-- <= 0) throw err;
          }
        }
      };
      const settled = await Promise.allSettled(Array.from({ length: DIRECTION_COUNT }, buildDirection));
      const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value).sort((a, b) => a.match.rank - b.match.rank);
      if (!ok.length) throw settled[0].reason;
      const multi = ok.length > 1;
      const saved = await updateProject(project.id, (p) => {
        p.brief = ok[0].brief;
        p.referenceMatch = ok[0].match;
        p.briefRev = (p.briefRev || 0) + 1;
        p.options = options;
        if (multi) {
          p.directions = ok.map(({ match, brief }, i) => ({ id: `d${i + 1}`, rank: match.rank, match, brief, image: null }));
          p.direction = { status: 'previewing', chosen: null };
          // 新一轮方向：上一轮选定方向的整套图不再对应当前简报
          p.images = {};
          p.pipeline = null;
        } else {
          p.directions = [];
          p.direction = null;
        }
      });
      if (multi) runDirections(saved.id, saved.directions.map((d) => d.id)).catch((err) => console.error('directions', err));
      // 等状态写入后再返回，前端第一帧就能看到排队状态
      if (multi) await new Promise((r) => setTimeout(r, 150));
      res.json(publicProject(await getProject(saved.id)));
    } finally {
      analyzing.delete(project.id);
    }
  }),
);

// 选定一个方向：它的简报和参考成为项目的设计，已出的正视图直接沿用，其余视图接着渲染
app.post(
  '/api/projects/:id/directions/:did/choose',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    checkAnalyzing(project.id);
    if (project.pipeline?.status === 'running' || VIEWS.some(v => isRunning(project.id, v.id))) throw httpError(409, '渲染进行中，请等待完成后再换方向');
    const direction = project.directions?.find((d) => d.id === req.params.did);
    if (!direction) throw httpError(404, '设计方向不存在');
    if (direction.image?.status !== 'done' || !direction.image.file) throw httpError(409, '这个方向的正视图还没有出图');
    const options = { ...project.options, ...req.body.options };
    const viewIds = viewsFor(options).map((v) => v.id).filter((id) => id !== 'outer_front');
    await updateProject(project.id, (p) => {
      p.options = options;
      p.brief = structuredClone(direction.brief);
      p.referenceMatch = structuredClone(direction.match);
      p.briefRev = (p.briefRev || 0) + 1;
      p.images = { outer_front: structuredClone(direction.image) };
      p.direction = { status: 'chosen', chosen: direction.id };
    });
    runPipeline(project.id, viewIds).catch((err) => console.error('pipeline', err));
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

// 某个方向预览失败时单独重试
app.post(
  '/api/projects/:id/directions/:did/retry',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    checkAnalyzing(project.id);
    if (!pickingDirection(project)) throw httpError(409, '已经选定方向，请在下方单张重绘');
    const direction = project.directions?.find((d) => d.id === req.params.did);
    if (!direction) throw httpError(404, '设计方向不存在');
    if (isDirectionRunning(project.id, direction.id)) throw httpError(409, '这个方向正在出图');
    runDirections(project.id, [direction.id]).catch((err) => console.error('directions', err));
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

app.put(
  '/api/projects/:id/brief',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    if (!req.body.brief?.product) throw httpError(400, '简报格式不正确');
    checkAnalyzing(project.id);
    checkBriefRev(project, req.body.rev);
    const saved = await updateProject(project.id, (p) => {
      p.brief = req.body.brief;
      p.briefRev = (p.briefRev || 0) + 1;
    });
    res.json(publicProject(saved));
  }),
);

// 3) 启动整套渲染（后台执行，前端轮询）
app.post(
  '/api/projects/:id/generate',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    if (!project.brief) throw httpError(400, '请先完成文档解析');
    checkAnalyzing(project.id);
    if (pickingDirection(project)) throw httpError(409, '请先选定一个设计方向');
    if (project.pipeline?.status === 'running') throw httpError(409, '渲染正在进行中');
    if (req.body.brief?.product) checkBriefRev(project, req.body.rev);
    const options = { ...project.options, ...req.body.options };
    const viewIds = viewsFor(options).map((v) => v.id);
    await updateProject(project.id, (p) => {
      p.options = options;
      if (req.body.brief?.product) {
        p.brief = req.body.brief;
        p.briefRev = (p.briefRev || 0) + 1;
      }
    });
    runPipeline(project.id, viewIds).catch((err) => console.error('pipeline', err));
    // 等状态写入后再返回，前端第一帧就能看到排队状态
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

// 单张重绘，可附加修改意见
app.post(
  '/api/projects/:id/views/:viewId/regenerate',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    const view = viewById(req.params.viewId);
    if (!view) throw httpError(404, '视角不存在');
    checkAnalyzing(project.id);
    if (pickingDirection(project)) throw httpError(409, '请先选定一个设计方向');
    if (isRunning(project.id, view.id)) throw httpError(409, '这张图正在生成中');
    if (req.body.brief?.product) {
      checkBriefRev(project, req.body.rev);
      await updateProject(project.id, (p) => {
        p.brief = req.body.brief;
        p.briefRev = (p.briefRev || 0) + 1;
      });
    }
    await updateProject(project.id, (p) => {
      p.images[view.id] = { ...p.images[view.id], status: 'queued', phase: 'WAITING', error: null };
    });
    runView(project.id, view.id, { extra: req.body.extra || '' });
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

// 切换某个视角的历史版本
app.post(
  '/api/projects/:id/views/:viewId/select',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    const img = project.images?.[req.params.viewId];
    const version = img?.versions?.[Number(req.body.index)];
    if (!version) throw httpError(404, '版本不存在');
    const saved = await updateProject(project.id, (p) => {
      Object.assign(p.images[req.params.viewId], { file: version.file, remoteUrl: version.remoteUrl, prompt: version.prompt, referenceInputs: version.referenceInputs || [], extra: version.extra });
    });
    res.json(publicProject(saved));
  }),
);

app.get('/api/projects', wrap(async (req, res) => res.json(await listProjects())));

app.get(
  '/api/projects/:id',
  wrap(async (req, res) => res.json(publicProject(await requireProject(req.params.id)))),
);

app.delete(
  '/api/projects/:id',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    checkAnalyzing(project.id);
    if (project.pipeline?.status === 'running' || project.direction?.status === 'previewing' || previewRunning(project)) throw httpError(409, '渲染进行中，暂不能删除');
    await fs.rm(path.join(DATA_DIR, project.id), { recursive: true, force: true });
    res.json({ ok: true });
  }),
);

function briefMarkdown(brief) {
  const { product: p, design: d, outer, inner, kv } = brief;
  const faceMd = (label, f) => `#### ${label}\n${f.content}\n\n${f.text.map((t) => `- ${t}`).join('\n')}\n`;
  return `# ${p.brand} ${p.name}

> ${p.tagline}

${p.summary}

## 产品信息
- 品类：${p.category}
- 目标人群：${p.audience}
- 定位：${p.positioning}
- 卖点：${p.sellingPoints.join('、')}
${p.specs.map((s) => `- ${s.label}：${s.value}`).join('\n')}

## 设计概念 · ${d.conceptName}
${d.concept}

- 风格：${d.style}
- 关键词：${d.keywords.join('、')}
- 字体：${d.typography}
- 图形：${d.motifs}
- 材质：${d.materials}
- 工艺：${d.finishes.join('、')}

### 色彩系统
${d.palette.map((c) => `- ${c.name} \`${c.hex}\` · ${c.role}`).join('\n')}

## 外包装 · ${outer.structure}
尺寸：${outer.dimensions}

${faceMd('正面', outer.faces.front)}
${faceMd('侧面', outer.faces.side)}
${faceMd('背面', outer.faces.back)}

## 内包装 · ${inner.structure}
内含：${inner.items}
${inner.unit ? `内装主体：${inner.unit}${inner.dimensions ? `（${inner.dimensions}）` : ''}\n` : ''}
${faceMd('正面', inner.faces.front)}
${faceMd('侧面', inner.faces.side)}
${faceMd('背面', inner.faces.back)}

## 主视觉
${kv.content}
`;
}

app.get(
  '/api/projects/:id/zip',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    const zip = new JSZip();
    for (const view of VIEWS) {
      const img = project.images?.[view.id];
      const local = img?.status === 'done' && localPathFromPublic(img.file);
      if (local) zip.file(`${view.code}_${view.label.replace(/\s|·/g, '')}.png`, await fs.readFile(local));
    }
    if (project.brief) {
      zip.file('设计简报.md', briefMarkdown(project.brief));
      zip.file('brief.json', JSON.stringify(project.brief, null, 2));
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const name = `${project.brief?.product?.name || '包装设计'}-${project.id}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buffer);
  }),
);

// 启动时修复上次中断的任务
await fs.mkdir(DATA_DIR, { recursive: true });
for (const summary of await listProjects()) {
  const project = await getProject(summary.id);
  if (project) await recoverInterrupted(project);
}

export const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  青匣 · 包装设计智能体已启动 → http://localhost:${PORT}\n`);
});
