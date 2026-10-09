import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { extractText } from './lib/parse.js';
import { analyzeDocument, designRequirements } from './lib/llm.js';
import { directionPicker, DIRECTION_COUNT, assetBytes, imageMime, loadCatalog } from './lib/references.js';
import { VIEWS, viewById } from './lib/prompts.js';
import { runPipeline, runView, runDirections, viewsFor, isRunning, isDirectionRunning, recoverInterrupted } from './lib/pipeline.js';
import { createProject, getProject, updateProject, deleteProject, listProjects, saveFile, localPathFromPublic, DATA_DIR } from './lib/store.js';
import { SCOPES, IDENTITY_MAX, KIND_LABEL, loadCommerceCatalog } from './lib/commerce.js';
import { DEFAULT_DETAIL_LAYOUT, detailLayout } from './lib/commerce-detail.js';
import { runCommerce, renderCommerce, runCommerceSlot, isCommerceRunning } from './lib/commerce-render.js';
import { PLAN_MODES, MODE_LABEL, claudePlannerReady, claudePlanModel } from './lib/commerce-claude.js';
import { imagePreview } from './lib/image-preview.js';
import { errorMessage, localizeErrors } from './public/js/errors.js';

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
app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url)), { extensions: ['html'], setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

// 只暴露参考图与渲染图，不暴露 project.json
app.get('/files/:id/:sub/:file', async (req, res) => {
  const local = localPathFromPublic(`/files/${req.params.id}/${req.params.sub}/${req.params.file}`);
  if (!local) return res.status(404).end();
  const file = req.query.preview === '1' ? await imagePreview(local).catch(() => local) : local;
  res.sendFile(file, { maxAge: '7d' }, (err) => err && !res.headersSent && res.status(404).end());
});

const fixName = (name) => (/[^\x00-\xff]/.test(name) ? name : Buffer.from(name, 'latin1').toString('utf8'));
const publicProject = ({ docText, ...rest }) => ({ ...localizeErrors(rest), running: VIEWS.filter((v) => isRunning(rest.id, v.id)).map((v) => v.id) });
const mutations = new Set();
const wrap = (fn) => async (req, res, next) => {
  const id = req.method !== 'GET' && req.params.id;
  if (id && mutations.has(id)) return res.status(409).json({ error: '项目操作正在处理中，请稍后再试' });
  if (id) mutations.add(id);
  try { await fn(req, res); } catch (err) { next(err); }
  finally { if (id) mutations.delete(id); }
};
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const checkAnalyzing = (id) => { if (analyzing.has(id)) throw httpError(409, '正在匹配参考并整理简报，请稍后再操作'); };
const imageBusy = (img) => ['queued', 'running'].includes(img?.status);
const packagingBusy = (p) => p.pipeline?.status === 'running' || p.direction?.status === 'previewing'
  || VIEWS.some((v) => isRunning(p.id, v.id) || imageBusy(p.images?.[v.id])) || previewRunning(p);

function checkBrief(brief) {
  const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const strings = (x) => Array.isArray(x) && x.every((v) => typeof v === 'string');
  if (!['product', 'design', 'outer', 'inner', 'kv'].every((k) => object(brief?.[k]))
    || !strings(brief.product.sellingPoints) || !strings(brief.design.keywords) || !strings(brief.design.finishes)
    || !Array.isArray(brief.product.specs) || !brief.product.specs.every((s) => object(s) && typeof s.label === 'string' && typeof s.value === 'string')
    || !Array.isArray(brief.design.palette) || !brief.design.palette.every((c) => object(c) && /^#[0-9a-f]{6}$/i.test(c.hex))
    || !['outer', 'inner'].every((k) => ['front', 'side', 'back'].every((f) => object(brief[k].faces?.[f]) && strings(brief[k].faces[f].text)))) {
    throw httpError(400, '简报格式不正确，请重新载入完整简报后修改');
  }
}

function checkImage(file) {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) throw httpError(400, '参考图只支持 PNG、JPG、WebP');
  try { imageMime(file.buffer); } catch { throw httpError(400, '图片内容无效，请上传有效的 PNG、JPG、WebP 图片'); }
}

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
  const commerceCatalog = await loadCommerceCatalog().catch(() => null);
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
    commerceLibrary: Boolean(commerceCatalog),
    claudePlanner: claudePlannerReady(),
    claudePlanModel: claudePlanModel(),
  });
}));

app.get('/api/views', (req, res) => res.json(VIEWS));

// 1) 上传文档 + 参考图 → 抽取文字，建立项目
app.post(
  '/api/projects',
  upload.fields([{ name: 'doc', maxCount: 1 }, { name: 'refs', maxCount: 4 }]),
  wrap(async (req, res) => {
    const docFile = req.files?.doc?.[0];
    const pasted = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const refFiles = req.files?.refs || [];
    refFiles.forEach(checkImage);
    if (!docFile && !pasted) throw httpError(400, '请上传产品文档，或粘贴产品介绍文字');

    let parsed;
    let sourceName;
    if (docFile) {
      sourceName = fixName(docFile.originalname);
      try {
        parsed = await extractText(docFile.buffer, sourceName);
      } catch (err) {
        throw httpError(400, errorMessage(err, '文档读取失败，请检查文件格式后重新上传'));
      }
      if (pasted) {
        const supplement = `\n\n【补充说明】\n${pasted}`;
        const combined = parsed.text + supplement;
        parsed = { text: combined.slice(0, 40000), chars: parsed.chars + supplement.length, truncated: parsed.truncated || combined.length > 40000 };
      }
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
    if (packagingBusy(project) || commerceBusy(project)) throw httpError(409, '渲染进行中，请完成后重新匹配');
    analyzing.add(project.id);
    try {
      await updateProject(project.id, (p) => { p.analysis = { status: 'running', startedAt: Date.now(), error: null }; });
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
        p.analysis = { ...p.analysis, status: 'done', finishedAt: Date.now() };
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
          p.images = {};
          p.pipeline = null;
        }
      });
      if (multi) runDirections(saved.id, saved.directions.map((d) => d.id)).catch((err) => console.error('directions', err));
      // 等状态写入后再返回，前端第一帧就能看到排队状态
      if (multi) await new Promise((r) => setTimeout(r, 150));
      res.json(publicProject(await getProject(saved.id)));
    } catch (err) {
      await updateProject(project.id, (p) => { p.analysis = { ...p.analysis, status: 'error', error: errorMessage(err, '设计分析失败，请稍后重试'), finishedAt: Date.now() }; }).catch(() => {});
      throw err;
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
    if (project.pipeline?.status === 'running' || VIEWS.some(v => isRunning(project.id, v.id) || imageBusy(project.images?.[v.id])) || commerceBusy(project)) throw httpError(409, '渲染进行中，请等待完成后再换方向');
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
    if (isDirectionRunning(project.id, direction.id) || imageBusy(direction.image)) throw httpError(409, '这个方向正在出图');
    runDirections(project.id, [direction.id]).catch((err) => console.error('directions', err));
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

app.put(
  '/api/projects/:id/brief',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    checkBrief(req.body.brief);
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
    if (packagingBusy(project)) throw httpError(409, '渲染正在进行中');
    if (req.body.brief !== undefined) { checkBrief(req.body.brief); checkBriefRev(project, req.body.rev); }
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
    if (!project.brief) throw httpError(400, '请先完成文档解析');
    checkAnalyzing(project.id);
    if (pickingDirection(project)) throw httpError(409, '请先选定一个设计方向');
    if (project.pipeline?.status === 'running' || isRunning(project.id, view.id) || imageBusy(project.images?.[view.id])) throw httpError(409, '这张图或整套视图正在生成中');
    if (view.deps.some((id) => project.images?.[id]?.status !== 'done' || !project.images[id].file)) throw httpError(409, '请先完成前序正视图，再重绘这个视角');
    if (req.body.brief !== undefined) {
      checkBrief(req.body.brief);
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
    checkAnalyzing(project.id);
    if (packagingBusy(project)) throw httpError(409, '渲染进行中，请完成后再切换版本');
    const img = project.images?.[req.params.viewId];
    const version = img?.versions?.[Number(req.body.index)];
    if (!version) throw httpError(404, '版本不存在');
    const saved = await updateProject(project.id, (p) => {
      Object.assign(p.images[req.params.viewId], { status: 'done', phase: 'COMPLETED', error: null, file: version.file, remoteUrl: version.remoteUrl, prompt: version.prompt, referenceInputs: version.referenceInputs || [], extra: version.extra });
    });
    res.json(publicProject(saved));
  }),
);

// ─── 电商主图 + 详情图 ───────────────────────────────────────────────
const commerceBusy = (project) => ['planning', 'rendering'].includes(project.commerce?.status)
  || (project.commerce?.plan?.slots || []).some((s) => isCommerceRunning(project.id, s.id) || imageBusy(project.commerce?.images?.[s.id]));
const IMAGE_EXT = { 'image/png': '.png', 'image/webp': '.webp', 'image/jpeg': '.jpg' };
const textField = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function commerceIntroduction(req, previous = {}, reuse = false) {
  if (reuse) return { introText: previous.introText ?? previous.excerpt ?? '', document: previous.document || null,
    excerpt: previous.excerpt || '', chars: previous.chars || 0, truncated: Boolean(previous.truncated) };
  const introText = textField(req.body.text, 12000);
  let document = null;
  const file = req.files?.doc?.[0];
  if (file) {
    const name = fixName(file.originalname);
    try { document = { name, ...await extractText(file.buffer, name) }; }
    catch (err) { throw httpError(400, `无法读取「${name}」：${errorMessage(err, '请检查文件格式后重新上传')}`); }
  } else if (req.body.reuseDocument === '1') {
    document = previous.document;
    if (!document?.text) throw httpError(400, '原产品文档已不可用，请重新上传');
  }
  const combined = document ? [introText ? `【补充说明】\n${introText}` : '', `【产品文档：${document.name}】\n${document.text}`].filter(Boolean).join('\n\n') : introText;
  return { introText, document, excerpt: combined.slice(0, 40000), chars: introText.length + (document?.chars || 0),
    truncated: Boolean(document?.truncated) || combined.length > 40000 };
}

function planModeOf(req) {
  const mode = req.body.planMode || 'claude';
  if (!PLAN_MODES.includes(mode)) throw httpError(400, '请选择参考库模式或 AI 规划模式');
  if (mode === 'claude' && !claudePlannerReady()) throw httpError(400, '未配置 AI 规划模型');
  return mode;
}

// 两种模式各留最近一套：换模式开新一套时，把另一种模式已有的那套收进 commerceAlt，便于对比
function startCommerce(p, fields) {
  const current = p.commerce;
  if (current?.plan && (current.mode || 'reference') !== fields.mode) p.commerceAlt = current;
  p.commerce = { status: 'planning', plan: null, images: {}, startedAt: Date.now(), finishedAt: null, error: null, ...fields };
}

// 首页直接上传产品图，无需先创建包装设计。
app.post(
  '/api/commerce-projects',
  upload.fields([{ name: 'images', maxCount: IDENTITY_MAX }, { name: 'doc', maxCount: 1 }]),
  wrap(async (req, res) => {
    const files = req.files?.images || [];
    if (!files.length) throw httpError(400, `请上传 1-${IDENTITY_MAX} 张同一件产品的图片`);
    files.forEach(checkImage);
    const scope = req.body.scope;
    if (!SCOPES.includes(scope)) throw httpError(400, '请至少选择主图或详情图，也可以两者都生成');
    const detailLayoutId = req.body.detailLayoutId || DEFAULT_DETAIL_LAYOUT;
    try { detailLayout(detailLayoutId); } catch (err) { throw httpError(400, err.message); }
    const mode = planModeOf(req);
    const introduction = await commerceIntroduction(req);
    const project = await createProject({
      kind: 'commerce',
      source: { name: '产品套图', ...introduction },
      docText: introduction.excerpt, refs: [], images: {}, brief: null,
    });
    const inputs = [];
    for (const [i, f] of files.entries()) {
      inputs.push({ id: `in${i + 1}`, source: 'upload', label: `上传：${fixName(f.originalname).slice(0, 40)}`,
        file: await saveFile(project.id, 'refs', `commerce-in-${i + 1}${IMAGE_EXT[f.mimetype] || '.jpg'}`, f.buffer) });
    }
    const saved = await updateProject(project.id, (p) => {
      startCommerce(p, { phase: 'IDENTIFY', scope, detailLayoutId, mode, inputs, rev: 0 });
    });
    runCommerce(project.id, { scope, identity: inputs, detailLayoutId, mode }).catch((err) => console.error('commerce', err));
    res.json(publicProject(saved));
  }),
);

// 开始：选定产品图（包装设计里已出的视角 + 上传的图片，同一件产品，最多 4 张）→ 规划每一屏 → 出图
app.post(
  '/api/projects/:id/commerce',
  upload.fields([{ name: 'images', maxCount: IDENTITY_MAX }, { name: 'doc', maxCount: 1 }]),
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    checkAnalyzing(project.id);
    if (!project.brief && project.kind !== 'commerce') throw httpError(400, '请先完成包装设计，再生成主图和详情图');
    if (packagingBusy(project) || pickingDirection(project)) throw httpError(409, '请先完成包装设计并选定方向');
    if (commerceBusy(project)) throw httpError(409, '主图与详情图正在生成中，请稍后再操作');
    const reuse = ['1', 'true'].includes(String(req.body.reuse));
    const scope = req.body.scope || (reuse && project.commerce?.scope);
    if (!SCOPES.includes(scope)) throw httpError(400, '请选择要生成主图、详情图，还是两者都生成');
    const detailLayoutId = req.body.detailLayoutId || (reuse && project.commerce?.detailLayoutId) || DEFAULT_DETAIL_LAYOUT;
    try { detailLayout(detailLayoutId); } catch (err) { throw httpError(400, err.message); }
    const mode = planModeOf(req);
    const introduction = project.kind === 'commerce' ? await commerceIntroduction(req, project.source, reuse) : null;

    let inputs;
    if (reuse) {
      inputs = project.commerce?.inputs;
      if (!inputs?.length) throw httpError(400, '没有可沿用的产品图，请重新选择');
    } else {
      let viewIds = [];
      try {
        viewIds = JSON.parse(req.body.views || '[]');
      } catch {
        throw httpError(400, '产品图选择格式不正确');
      }
      if (!Array.isArray(viewIds)) throw httpError(400, '产品图选择格式不正确');
      inputs = [];
      for (const id of [...new Set(viewIds)]) {
        const view = viewById(id);
        const img = project.images?.[id];
        if (!view || img?.status !== 'done' || !img.file) throw httpError(400, `「${view?.label || id}」还没有出图，不能作为产品图`);
        inputs.push({ source: 'generated', view: id, label: view.label, file: img.file });
      }
      const files = req.files?.images || [];
      if (!inputs.length && !files.length || inputs.length + files.length > IDENTITY_MAX) throw httpError(400, `请选择 1-${IDENTITY_MAX} 张同一件产品的图片`);
      files.forEach(checkImage);
      const stamp = Date.now();
      for (const [i, f] of files.entries()) {
        if (!IMAGE_EXT[f.mimetype]) throw httpError(400, '上传的产品图只支持 PNG、JPG、WebP');
        const name = fixName(f.originalname);
        inputs.push({ source: 'upload', label: `上传：${name.slice(0, 40)}`, file: await saveFile(project.id, 'refs', `commerce-in-${stamp}-${i + 1}${IMAGE_EXT[f.mimetype]}`, f.buffer) });
      }
      if (!inputs.length || inputs.length > IDENTITY_MAX) throw httpError(400, `请选择 1-${IDENTITY_MAX} 张同一件产品的图片`);
      inputs.forEach((input, i) => { input.id = `in${i + 1}`; });
    }

    await updateProject(project.id, (p) => {
      if (introduction) Object.assign(p.source, introduction);
      startCommerce(p, { phase: mode === 'claude' ? 'CLAUDE_PLAN' : 'CLASSIFY', scope, detailLayoutId, mode, inputs, rev: p.commerce?.rev || 0 });
    });
    runCommerce(project.id, { scope, identity: inputs, detailLayoutId, mode }).catch((err) => console.error('commerce', err));
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

// 在两种模式各自最近的一套之间切换查看；进行中的那套不能切走
app.post(
  '/api/projects/:id/commerce/switch',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    if (!project.commerceAlt?.plan) throw httpError(400, '另一种模式还没有生成过');
    if (commerceBusy(project)) throw httpError(409, '这一套正在生成中，完成后再切换');
    const saved = await updateProject(project.id, (p) => {
      [p.commerce, p.commerceAlt] = [p.commerceAlt, p.commerce];
      p.commerce.rev = (p.commerce.rev || 0) + 1;
    });
    res.json(publicProject(saved));
  }),
);

// 编辑方案：标题、主标题、辅助文字、构图设想；版本号防止别的窗口里的旧内容覆盖新内容
app.put(
  '/api/projects/:id/commerce/plan',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    if (!project.commerce?.plan) throw httpError(400, '还没有方案');
    if (project.commerce.status === 'planning') throw httpError(409, '正在规划，请稍后再修改');
    if (Number(req.body.rev) !== (project.commerce.rev || 0)) {
      throw Object.assign(httpError(409, '方案已在其他窗口更新，已为你载入最新版本'), { stale: true });
    }
    const edits = req.body.slots || {};
    const saved = await updateProject(project.id, (p) => {
      for (const slot of p.commerce.plan.slots) {
        const e = edits[slot.id];
        if (!e) continue;
        slot.title = textField(e.title, 16) || slot.title;
        if (typeof e.headline === 'string') slot.headline = textField(e.headline, slot.kind === 'detail' ? 40 : 24);
        if (Array.isArray(e.copy)) slot.copy = e.copy.map((t) => textField(t, slot.kind === 'detail' ? 100 : 30)).filter(Boolean).slice(0, slot.copyMax ?? (slot.kind === 'detail' ? (slot.moduleId === 'product_info' ? 10 : 5) : 4));
        if (slot.role === 'white') { slot.headline = ''; slot.copy = []; }
        if (typeof e.visual === 'string') slot.visual = textField(e.visual, slot.kind === 'detail' ? 600 : 300);
      }
      p.commerce.rev = (p.commerce.rev || 0) + 1;
    });
    res.json(publicProject(saved));
  }),
);

// 按当前方案重新出图（整套，或只出 slotIds 里的几屏）
app.post(
  '/api/projects/:id/commerce/generate',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    if (!project.commerce?.plan) throw httpError(400, '还没有方案');
    if (commerceBusy(project)) throw httpError(409, '主图与详情图正在生成中');
    const slotIds = Array.isArray(req.body.slotIds) ? req.body.slotIds : null;
    if (req.body.slotIds !== undefined && (!slotIds?.length || slotIds.some((id) => !project.commerce.plan.slots.some((s) => s.id === id)))) throw httpError(400, '请选择当前方案中有效的图片');
    if (project.commerce.plan.slots.some((s) => s.kind === 'detail' && !s.moduleId && (!slotIds?.length || slotIds.includes(s.id)))) throw httpError(400, '此方案使用旧详情结构，请重新选择 10 屏或 16 屏生成');
    renderCommerce(project.id, slotIds).catch((err) => console.error('commerce', err));
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

app.post(
  '/api/projects/:id/commerce/slots/:slotId/regenerate',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    const slot = project.commerce?.plan?.slots.find((s) => s.id === req.params.slotId);
    if (!slot) throw httpError(404, '这一屏不在当前方案里');
    if (slot.kind === 'detail' && !slot.moduleId) throw httpError(400, '此方案使用旧详情结构，请重新选择 10 屏或 16 屏生成');
    if (['planning', 'rendering'].includes(project.commerce.status)) throw httpError(409, '整套图片正在生成，请稍后再操作');
    if (isCommerceRunning(project.id, slot.id) || imageBusy(project.commerce.images?.[slot.id])) throw httpError(409, '这张图正在生成中');
    const anchorId = project.commerce.plan.anchor;
    const anchor = project.commerce.images?.[anchorId];
    if (anchorId && slot.id !== anchorId && slot.role !== 'white' && (anchor?.status !== 'done' || !anchor.file)) throw httpError(409, '请先完成首图，再重绘本屏');
    await updateProject(project.id, (p) => {
      p.commerce.images[slot.id] = { ...p.commerce.images[slot.id], status: 'queued', phase: 'WAITING', error: null };
    });
    runCommerceSlot(project.id, slot.id, { extra: textField(req.body.extra, 500) });
    await new Promise((r) => setTimeout(r, 150));
    res.json(publicProject(await getProject(project.id)));
  }),
);

app.post(
  '/api/projects/:id/commerce/slots/:slotId/select',
  wrap(async (req, res) => {
    const project = await requireProject(req.params.id);
    if (commerceBusy(project)) throw httpError(409, '渲染进行中，请完成后再切换版本');
    const img = project.commerce?.images?.[req.params.slotId];
    const version = img?.versions?.[Number(req.body.index)];
    if (!version) throw httpError(404, '版本不存在');
    const saved = await updateProject(project.id, (p) => {
      Object.assign(p.commerce.images[req.params.slotId], { status: 'done', phase: 'COMPLETED', error: null, file: version.file, remoteUrl: version.remoteUrl, prompt: version.prompt, referenceInputs: version.referenceInputs || [], extra: version.extra });
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
    if (packagingBusy(project) || commerceBusy(project)) throw httpError(409, '渲染进行中，暂不能删除');
    await deleteProject(project.id);
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

function commerceMarkdown(commerce) {
  const { plan, scope } = commerce;
  const factLine = (k, v) => `- ${k}：${v.map((x) => (typeof x === 'string' ? x : x.label ? `${x.label} ${x.value}` : `${x.q} → ${x.a}`)).join('；')}`;
  const names = { confirmed_benefits: '产品优势', confirmed_ingredients_or_scent: '成分或香调', verified_mechanism: '原理', target_user_needs: '目标人群与需求', confirmed_instructions: '使用方法', verified_specs_and_label: '规格', confirmed_use_scenario: '使用场景', verified_faq: '问答' };
  return `# 主图与详情图方案

${plan.summary || ''}

${plan.contentSource ? `信息结构参考：${plan.contentSource.repository} @ ${plan.contentSource.revision}；只参考每屏信息任务，构图与视觉由 AI 独立规划。\n` : ''}
- 范围：${{ main: '仅主图', detail: '仅详情图', both: '主图 + 详情图' }[scope]}
${plan.mainLayout ? `- 主图结构：${plan.mainLayout.name} · ${plan.mainLayout.screenCount} 张（1:1）\n- 主图顺序：${plan.slots.filter((s) => s.kind === 'main').map((s) => s.roleLabel).join(' → ')}\n` : ''}${plan.detailLayout ? `- 详情结构：${plan.detailLayout.name} · ${plan.detailLayout.screenCount} 屏（9:16）\n` : ''}${plan.promptSource ? `- 提示词来源：${plan.promptSource.repository} @ ${plan.promptSource.revision}\n` : ''}- 规划模式：${MODE_LABEL[plan.mode || 'reference']}
${plan.mode === 'claude' ? `- 规划模型：AI\n- 定位：${plan.claude.strategy.positioning}\n- 调性：${plan.claude.strategy.tone}\n- 色板：${plan.claude.palette.map((c) => `${c.name} ${c.hex}（${c.role}）`).join('；')}\n- 明暗节奏：${plan.claude.rhythm}` : `- 视觉系统：${plan.system.style.join('、')}（参考库 ${plan.system.category} · ${plan.system.form}）`}

## 取自产品资料的事实
${Object.entries(plan.facts).filter(([, v]) => v.length).map(([k, v]) => factLine(names[k] || k, v)).join('\n') || '- 资料里没有可用于宣传的事实，只出产品图与简单场景'}

## 每一屏
${plan.slots.map((s) => `### ${KIND_LABEL[s.kind]} ${s.id} · ${s.title}（${s.roleLabel}）\n${s.headline ? `- 主标题：${s.headline}\n` : ''}${s.copy.map((t) => `- ${t}`).join('\n')}${s.copy.length ? '\n' : ''}- 构图：${s.visual}\n${s.design ? `- 版式：${s.design.layout || '—'}\n- 色彩结构：${s.design.colors.map((c) => `${c.hex} ${c.share}% ${c.use}`).join('；')}` : `- 版式参考：${s.reference ? s.reference.title : s.role === 'white' ? '无（白底图只用产品图）' : '按本屏固定模块构图，沿用整套风格'}`}`).join('\n\n')}
${[...(plan.mainBrief?.missingEvidence || []), ...(plan.detailBrief?.missingEvidence || [])].length ? `\n## 资料待补充（不印在图片上）\n${[...new Set([...(plan.mainBrief?.missingEvidence || []), ...(plan.detailBrief?.missingEvidence || [])])].map((s) => `- ${s}`).join('\n')}\n` : ''}
${plan.skipped.length ? `\n## ${plan.contentSource ? '缺失依据与替代表达（屏数保留）' : '没有生成的屏'}\n${plan.skipped.map((s) => `- ${KIND_LABEL[s.kind]} · ${s.label}：${s.reason}`).join('\n')}\n` : ''}`;
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
    for (const slot of project.commerce?.plan?.slots || []) {
      const img = project.commerce.images?.[slot.id];
      const local = img?.status === 'done' && localPathFromPublic(img.file);
      if (local) zip.file(`电商图/${KIND_LABEL[slot.kind]}/${slot.id.replace('_', '-')}_${slot.title.replace(/[\s·/\\]/g, '')}.png`, await fs.readFile(local));
    }
    if (project.commerce?.plan) zip.file('电商图方案.md', commerceMarkdown(project.commerce));
    if (project.brief) {
      zip.file('设计简报.md', briefMarkdown(project.brief));
      zip.file('brief.json', JSON.stringify(project.brief, null, 2));
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const name = `${project.brief?.product?.name || project.source?.name || '包装设计'}-${project.id}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buffer);
  }),
);

// 上传与 JSON 解析错误也返回前端可以显示的错误信息。
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.statusCode || err.status || 500;
  let message = err.message || '服务器错误';
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 25 MB' : '上传文件数量、字段或文字长度不符合要求，请检查后重试';
  } else if (err.type === 'entity.parse.failed') message = '请求 JSON 格式不正确';
  else if (err.type === 'entity.too.large') message = '提交的内容过大，请减少文字后重试';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: errorMessage({ message, status, code: err.code }), ...(err.stale && { stale: true }) });
});

// 启动时修复上次中断的任务
await fs.mkdir(DATA_DIR, { recursive: true });
for (const summary of await listProjects()) {
  const project = await getProject(summary.id);
  if (project) await recoverInterrupted(project);
}

export const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  青匣 · 包装设计智能体已启动 → http://localhost:${PORT}\n`);
});
