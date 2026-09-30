import { exportBoard } from './board.js';

/* ───────────── 基础工具 ───────────── */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, val) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = val;
};
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function api(url, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.method ||= 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.json);
    delete init.json;
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `请求失败（${res.status}）`), { status: res.status, stale: data.stale });
  return data;
}

function toast(msg, type = 'info', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

/* ───────────── 选项配置 ───────────── */
const STYLES = [
  { id: 'auto', name: '参考库推荐', colors: ['#B3D1B6', '#22433A', '#D9C692'] },
  { id: 'oriental', name: '东方雅致', colors: ['#EAE4D6', '#3E5A4C', '#B19353'] },
  { id: 'natural', name: '极简自然', colors: ['#F1EFE8', '#A9BFA3', '#5C6B55'] },
  { id: 'luxury', name: '奢华典藏', colors: ['#1E2B26', '#C6A15B', '#F0E6D0'] },
  { id: 'tech', name: '未来科技', colors: ['#0F1A24', '#7FD6C2', '#C9D3DB'] },
  { id: 'guochao', name: '国潮插画', colors: ['#C8372D', '#1F6E5A', '#F2C14E'] },
  { id: 'vintage', name: '复古手作', colors: ['#C9A77C', '#6B4E31', '#EFE3CC'] },
];

const SHAPES = [
  { id: 'auto', name: 'AI 推荐', icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M6.3 17.7l2.4-2.4M15.3 8.7l2.4-2.4' },
  { id: 'lidbox', name: '天地盖礼盒', icon: 'M4.5 10h15v10h-15zM3 6.5h18V10H3z' },
  { id: 'drawer', name: '抽屉盒', icon: 'M3 7h14v11H3zM7 9.5h14v8.5H7M12 13.5h4' },
  { id: 'magnetic', name: '翻盖磁吸盒', icon: 'M4 11h16v9H4zM4 11l3-6h13l-3 6' },
  { id: 'tube', name: '圆筒纸罐', icon: 'M6 6c0-1.1 2.7-2 6-2s6 .9 6 2v12c0 1.1-2.7 2-6 2s-6-.9-6-2zM6 6c0 1.1 2.7 2 6 2s6-.9 6-2M6 10c0 1.1 2.7 2 6 2s6-.9 6-2' },
  { id: 'mailer', name: '折叠彩盒', icon: 'M3 8.5 12 5l9 3.5v9L12 21l-9-3.5zM3 8.5 12 12l9-3.5M12 12v9' },
  { id: 'pouch', name: '自立袋', icon: 'M7 3h10l1 4-1.2 14H7.2L6 7zM6 7h12M10 3v2' },
];

const LANGS = [
  { id: 'zh', name: '中文为主' },
  { id: 'bilingual', name: '中英双语' },
  { id: 'en', name: '英文为主' },
];

const QUALITIES = [
  { id: 'medium', name: '快速' },
  { id: 'high', name: '精致' },
  { id: 'xhigh', name: '极致' },
];

const PHASE_TEXT = {
  WAITING: '等待前序视图定稿',
  SUBMITTING: '正在提交任务',
  IN_QUEUE: '排队中',
  IN_PROGRESS: '精细渲染中',
  RETRYING: '网络波动，正在重试',
};

const ANALYZE_MSGS = [
  '正在通读文档…',
  '提炼核心卖点与规格…',
  'JEV 正在比较参考的设计语言与结构…',
  '揣摩品牌气质与目标人群…',
  '推敲设计概念…',
  '调配色彩系统…',
  '规划外包装结构与印刷工艺…',
  '设计适合产品的容器与配套外盒…',
  '撰写三视图版面文案…',
];

/* ───────────── 状态 ───────────── */
// 高级选项默认值：不展开高级选项时就用这一套（主视觉全家福默认关闭）
const DEFAULT_OPTIONS = { style: 'auto', shape: 'auto', lang: 'zh', quality: 'high', includeKv: false };

const state = {
  file: null,
  refs: [],
  options: { ...DEFAULT_OPTIONS },
  views: [],
  project: null,
  pollTimer: null,
  saveTimer: null,
  savePromise: null,
  galleryKey: '',
  lbView: null,
  lbDirection: null,
  choosing: null,
  dirKey: '',
  regenView: null,
  wasActive: false,
  analyzing: false,
};

/* ───────────── 选项渲染 ───────────── */
function renderChoices() {
  $('#styleChips').innerHTML = STYLES.map(
    (s) => `<button type="button" class="chip" data-opt="style" data-val="${s.id}" aria-pressed="${state.options.style === s.id}">
      <span class="swatch-trio">${s.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${s.name}</button>`,
  ).join('');
  $('#shapeChips').innerHTML = SHAPES.map(
    (s) => `<button type="button" class="chip" data-opt="shape" data-val="${s.id}" aria-pressed="${state.options.shape === s.id}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${s.icon}"/></svg>${s.name}</button>`,
  ).join('');
  const seg = (items, key) =>
    items.map((i) => `<button type="button" data-opt="${key}" data-val="${i.id}" aria-pressed="${state.options[key] === i.id}">${i.name}</button>`).join('');
  $('#langSeg').innerHTML = seg(LANGS, 'lang');
  $('#qualitySeg').innerHTML = seg(QUALITIES, 'quality');
  $('#kvToggle').checked = state.options.includeKv === true;
  updateAdvSummary();
}

// 折叠时的一行摘要 + 按钮上的「已自定义 N 项」角标
function updateAdvSummary() {
  const o = state.options;
  const name = (list, id) => list.find((x) => x.id === id)?.name || '';
  const changed = [
    o.style !== DEFAULT_OPTIONS.style,
    o.shape !== DEFAULT_OPTIONS.shape,
    o.lang !== DEFAULT_OPTIONS.lang,
    o.quality !== DEFAULT_OPTIONS.quality,
    (o.includeKv === true) !== DEFAULT_OPTIONS.includeKv,
    Boolean($('#extraInput').value.trim()),
  ].filter(Boolean).length;
  const parts = [
    `风格 ${name(STYLES, o.style)}`,
    `外形 ${name(SHAPES, o.shape)}`,
    name(LANGS, o.lang),
    `精度 ${name(QUALITIES, o.quality)}`,
    o.includeKv === true ? '含主视觉全家福' : '不含主视觉',
  ];
  if ($('#extraInput').value.trim()) parts.push('有设计师备注');
  $('#advSummary').textContent = `${changed ? `已自定义 ${changed} 项` : '默认设置'} · ${parts.join(' · ')}`;
  const badge = $('#advBadge');
  badge.hidden = !changed;
  badge.textContent = changed;
}

$('#advToggle').addEventListener('click', () => {
  const open = $('#advOptions').hidden;
  $('#advOptions').hidden = !open;
  $('#advToggle').setAttribute('aria-expanded', String(open));
});
$('#extraInput').addEventListener('input', updateAdvSummary);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-opt]');
  if (!btn) return;
  state.options[btn.dataset.opt] = btn.dataset.val;
  $$(`[data-opt="${btn.dataset.opt}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  updateAdvSummary();
});

$('#kvToggle').addEventListener('change', (e) => {
  state.options.includeKv = e.target.checked;
  updateAdvSummary();
});

/* ───────────── 文件上传 ───────────── */
const dropzone = $('#dropzone');

function setFile(file) {
  state.file = file;
  $('.dz-empty', dropzone).hidden = Boolean(file);
  $('.dz-file', dropzone).hidden = !file;
  if (file) {
    const ext = (file.name.split('.').pop() || 'DOC').slice(0, 4).toUpperCase();
    $('#fileExt').textContent = ext;
    $('#fileName').textContent = file.name;
    $('#fileSize').textContent = fmtSize(file.size);
  } else {
    $('#docInput').value = '';
  }
}

$('#docInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setFile(file);
});
$('#fileClear').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  setFile(null);
});
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('#docInput').click();
  }
});
['dragenter', 'dragover'].forEach((t) =>
  dropzone.addEventListener(t, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((t) =>
  dropzone.addEventListener(t, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (file.type.startsWith('image/')) return addRefs([file]);
  setFile(file);
});

function addRefs(files) {
  const room = 4 - state.refs.length;
  const accepted = [...files].filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type)).slice(0, room);
  if (files.length > room) toast('参考图最多 4 张');
  state.refs.push(...accepted.map((file) => ({ file, url: URL.createObjectURL(file) })));
  renderRefs();
}

function renderRefs() {
  const wrap = $('#refs');
  $$('.ref-item', wrap).forEach((n) => n.remove());
  const add = $('.ref-add', wrap);
  state.refs.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'ref-item';
    el.innerHTML = `<img src="${r.url}" alt="参考图 ${i + 1}" /><button type="button" aria-label="移除">×</button>`;
    $('button', el).addEventListener('click', () => {
      URL.revokeObjectURL(r.url);
      state.refs.splice(i, 1);
      renderRefs();
    });
    wrap.insertBefore(el, add);
  });
  add.hidden = state.refs.length >= 4;
}

$('#refInput').addEventListener('change', (e) => {
  addRefs(e.target.files);
  e.target.value = '';
});
$('.ref-add').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('#refInput').click();
  }
});

async function loadSample() {
  try {
    const name = '示例-青屿积雪草修护精华.md';
    const res = await fetch(`/sample/${encodeURIComponent(name)}`);
    const blob = await res.blob();
    setFile(new File([blob], name, { type: 'text/markdown' }));
  } catch {
    return toast('示例文档加载失败', 'error');
  }
  toast('示例文档已载入，点右下角「开始设计并出图」开始');
}

$$('[data-action="try-sample"]').forEach((b) => b.addEventListener('click', loadSample));

/* ───────────── 流程导轨 ───────────── */
function setRail(step) {
  $$('.rail li').forEach((li) => {
    const n = Number(li.dataset.rail);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
  });
}

function reveal(id) {
  const el = $(id);
  el.hidden = false;
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/* ───────────── 解析 ───────────── */
let msgTimer;
function showAnalyzing(on) {
  state.analyzing = on;
  $('#analyzeBtn').disabled = on;
  $('#reanalyzeBtn').disabled = on;
  $('#generateBtn').disabled = on;
  $('#analyzing').hidden = !on;
  $('#analyzeBtn').classList.toggle('is-busy', on);
  clearInterval(msgTimer);
  if (on) {
    let i = 0;
    const el = $('#analyzingMsg');
    el.textContent = ANALYZE_MSGS[0];
    msgTimer = setInterval(() => {
      i = (i + 1) % ANALYZE_MSGS.length;
      el.textContent = ANALYZE_MSGS[i];
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }, 2600);
  }
}

// 表单里的高级选项只用于「新设计」；已有项目的重构思 / 重绘沿用它自己保存的设置，
// 不会被表单（或另一个项目的设置）改写
function currentOptions() {
  return { ...state.options, extra: $('#extraInput').value };
}

function projectOptions(project = state.project) {
  const { style, shape, lang, quality, includeKv, extra } = { ...DEFAULT_OPTIONS, ...project?.options };
  return { style, shape, lang, quality, includeKv: includeKv === true, extra: extra || '' };
}

// 点「开始设计并出图」后一条龙：匹配参考 → 生成设计简报（内置，可随时打开修改）→ 出图（上传文档本身不会触发）
async function startDesign() {
  if (state.analyzing) return;
  if (isActive()) return toast('请等待当前渲染完成后再设计新产品', 'error');
  const text = $('#pasteInput').value.trim();
  if (!state.file && !text) {
    toast('请先上传产品文档，或粘贴产品介绍', 'error');
    dropzone.focus();
    return;
  }
  $('#step1').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showAnalyzing(true);
  setRail(2);
  let ready = false;
  try {
    await flushBrief();
    leaveProject();
    const fd = new FormData();
    if (state.file) fd.append('doc', state.file);
    if (text) fd.append('text', text);
    state.refs.forEach((r) => fd.append('refs', r.file));
    const created = await api('/api/projects', { method: 'POST', body: fd });
    setProject(created);
    const project = await api(`/api/projects/${created.id}/analyze`, { json: { options: currentOptions() } });
    setProject(project);
    state.galleryKey = '';
    renderBrief();
    ready = true;
  } catch (err) {
    setRail(1);
    toast(err.message, 'error', 6000);
  } finally {
    showAnalyzing(false);
  }
  if (!ready) return;
  if (pickingDirections()) return showDirections(`JEV 挑出了 ${state.project.directions.length} 个参考方向，正在同时出预览，约 1 分钟`);
  toast(`设计方向已定：「${state.project.brief.design.conceptName || state.project.brief.product.name}」，开始渲染包装`);
  await generate();
}

$('#analyzeBtn').addEventListener('click', startDesign);

// 离开当前项目，回到空白工作台（项目已自动保存，可在「作品集」找回）
function leaveProject() {
  stopPolling();
  closeBrief();
  state.project = null;
  state.galleryKey = '';
  $('#step3').hidden = true;
  history.replaceState(null, '', location.pathname);
}

// 新建项目：清空资料与高级选项，回到第 1 步
async function newProject() {
  if (state.analyzing) return toast('请等待本轮设计完成', 'error');
  if (isActive()) return toast('请等待当前渲染完成后再新建项目', 'error');
  await flushBrief();
  leaveProject();
  setFile(null);
  $('#pasteInput').value = '';
  state.refs.forEach((r) => URL.revokeObjectURL(r.url));
  state.refs = [];
  renderRefs();
  Object.assign(state.options, DEFAULT_OPTIONS);
  $('#extraInput').value = '';
  renderChoices();
  setRail(1);
  closeHistory();
  $('#step1').scrollIntoView({ behavior: 'smooth', block: 'start' });
  dropzone.focus({ preventScroll: true });
}

$('#newProject').addEventListener('click', newProject);

// 与界面同风格的确认框，返回 Promise<boolean>
function askConfirm({ eyebrow = 'Confirm', title, desc = '', ok = '确定' }) {
  const modal = $('#confirmModal');
  $('#confirmEyebrow').textContent = eyebrow;
  $('#confirmTitle').textContent = title;
  $('#confirmDesc').textContent = desc;
  $('#confirmOk').textContent = ok;
  modal.hidden = false;
  setTimeout(() => $('[data-confirm="yes"]', modal).focus(), 50);
  return new Promise((resolve) => {
    const done = (answer) => {
      modal.hidden = true;
      modal.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey, true);
      resolve(answer);
    };
    const onClick = (e) => {
      const act = e.target.closest('[data-confirm]')?.dataset.confirm;
      if (act) done(act === 'yes');
      else if (e.target === modal) done(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      done(false);
    };
    modal.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
  });
}

async function reanalyze() {
  if (!state.project || state.analyzing) return;
  if (isActive()) return toast('请等待当前渲染完成后再重新匹配', 'error');
  const rendered = Object.keys(state.project.images || {}).length > 0;
  const ok = await askConfirm({
    eyebrow: 'Rethink',
    title: '换一批设计方向？',
    desc: `将重新挑选最多 3 个设计参考，各写一份设计简报并同时出一张外包装正视图预览（约 1 分钟，会立即开始出图）。当前简报（包括你的修改）将被替换${rendered ? '，现在这套图会被新一轮方向取代' : ''}，选定方向后再补全其余视图。`,
    ok: '重新构思',
  });
  if (!ok) return;
  state.analyzing = true;
  $('#analyzeBtn').disabled = true;
  $('#generateBtn').disabled = true;
  const btn = $('#reanalyzeBtn');
  btn.classList.add('is-busy');
  btn.textContent = '构思中…';
  let picking = false;
  try {
    await flushBrief();
    const project = await api(`/api/projects/${state.project.id}/analyze`, { json: { options: projectOptions() } });
    setProject(project);
    state.galleryKey = '';
    renderBrief();
    picking = pickingDirections();
    if (!picking) toast('已换一个新的设计方向');
  } catch (err) {
    toast(err.message, 'error', 6000);
  } finally {
    state.analyzing = false;
    $('#analyzeBtn').disabled = false;
    $('#generateBtn').disabled = false;
    btn.classList.remove('is-busy');
    btn.textContent = '重新构思';
  }
  if (picking) {
    closeBrief();
    showDirections(`JEV 挑出了 ${state.project.directions.length} 个参考方向，正在同时出预览，约 1 分钟`);
  }
}

$('#reanalyzeBtn').addEventListener('click', reanalyze);

/* ───────────── 项目状态 ───────────── */
function setProject(project) {
  state.project = project;
  history.replaceState(null, '', `#p=${project.id}`);
}

/* ───────────── 设计简报 ───────────── */
const FACE_NAMES = {
  outer: { front: '正面', side: '侧面', back: '背面' },
  inner: { front: '正面', side: '侧面', back: '背面' },
};

const input = (path, value, cls = '', ph = '') =>
  `<input class="ghost-input ${cls}" data-path="${path}" value="${esc(value)}" placeholder="${esc(ph)}" />`;
const area = (path, value, cls = 'bf-input', rows = 2, ph = '') =>
  `<textarea class="${cls}" data-path="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(value)}</textarea>`;

function tagEditor(path, items, gold = false) {
  return `<div class="tag-editor" data-tags="${path}">
    ${items.map((t, i) => `<span class="tag ${gold ? 'gold' : ''}">${esc(t)}<button type="button" data-tag-del="${i}" aria-label="删除">×</button></span>`).join('')}
    <input class="tag-input" placeholder="＋ 添加后回车" />
  </div>`;
}

function paletteHtml(palette) {
  return `<div class="palette">
    ${palette
      .map(
        (c, i) => `<div class="swatch">
        <label class="swatch-color" style="background:${esc(c.hex)}"><input type="color" data-path="design.palette.${i}.hex" value="${esc(c.hex.toLowerCase())}" /></label>
        <button type="button" class="swatch-del" data-swatch-del="${i}" aria-label="删除颜色">×</button>
        <div class="swatch-meta">
          ${input(`design.palette.${i}.name`, c.name, '', '色名')}
          <div class="hex">${esc(c.hex)}</div>
          ${input(`design.palette.${i}.role`, c.role, 'role', '用途')}
        </div>
      </div>`,
      )
      .join('')}
    ${palette.length < 7 ? '<button type="button" class="swatch-add" data-swatch-add>＋ 添加颜色</button>' : ''}
  </div>`;
}

function facePanes(group, faces) {
  return `
    <div class="face-tabs" role="tablist">
      ${['front', 'side', 'back']
        .map((f, i) => `<button type="button" role="tab" data-face-tab="${group}:${f}" aria-selected="${i === 0}">${FACE_NAMES[group][f]}</button>`)
        .join('')}
    </div>
    ${['front', 'side', 'back']
      .map(
        (f, i) => `<div class="face-pane" data-face-pane="${group}:${f}" ${i ? 'hidden' : ''}>
        <label>版面构成</label>
        ${area(`${group}.faces.${f}.content`, faces[f].content, '', 3)}
        <label>印刷文字 <small>（每行一条，将原样出现在包装上）</small></label>
        <textarea class="copy-lines" data-path="${group}.faces.${f}.text" data-lines rows="4">${esc(faces[f].text.join('\n'))}</textarea>
        <details><summary>英文画面提示（高级）</summary>${area(`${group}.faces.${f}.promptEn`, faces[f].promptEn, '', 4)}</details>
      </div>`,
      )
      .join('')}`;
}

/* 设计简报弹层：默认内置，用户点「设计简报」按钮才打开 */
const sheet = $('#briefSheet');
const briefOpen = () => !sheet.hidden;

function syncGenerateLabel() {
  const rendered = Object.keys(state.project?.images || {}).length > 0;
  $('#generateBtn span').textContent = rendered ? '按此简报重新生成' : '开始渲染包装';
}

function openBrief() {
  if (!state.project?.brief) return;
  syncGenerateLabel();
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#briefBody').scrollTop = 0;
  requestAnimationFrame(() => $$('textarea', $('#briefBody')).forEach(autosize));
  $('#closeBrief').focus();
}

function closeBrief() {
  if (sheet.hidden) return;
  sheet.hidden = true;
  document.body.style.overflow = '';
  if (!$('#step3').hidden) $('#openBriefBtn').focus({ preventScroll: true });
}

$('#openBriefBtn').addEventListener('click', openBrief);
sheet.addEventListener('click', (e) => e.target.closest('[data-sheet="close"]') && closeBrief());

function renderBrief() {
  const b = state.project.brief;
  const { product: p, design: d, outer, inner, kv } = b;
  $('#briefBody').innerHTML = `
    <div class="brief-cover">
      <div class="cover-product">
        <div class="cover-brand">${input('product.brand', p.brand, '', '品牌')}<span class="reg-mark"></span>${input('product.brandEn', p.brandEn, '', 'Brand')}</div>
        ${input('product.name', p.name, 'cover-name', '产品名')}
        ${input('product.tagline', p.tagline, 'cover-tagline', '主标语')}
        <textarea class="ghost-input cover-summary" data-path="product.summary" rows="2">${esc(p.summary)}</textarea>
        <div class="cover-points">${tagEditor('product.sellingPoints', p.sellingPoints)}</div>
      </div>
      <div class="concept-card">
        <p class="eyebrow"><span class="reg-mark"></span>Design Concept</p>
        ${input('design.conceptName', d.conceptName, 'concept-name', '设计概念名')}
        ${input('design.style', d.style, 'concept-style', '风格方向')}
        <textarea class="concept-text" data-path="design.concept" rows="5">${esc(d.concept)}</textarea>
      </div>
    </div>

    <div class="brief-grid">
      <section class="bcard bcard-wide">
        <div class="bcard-head"><h4>色彩系统</h4><em>Palette</em><span class="bcard-tools"><small class="hint">点击色块可调色</small></span></div>
        <div data-palette>${paletteHtml(d.palette)}</div>
      </section>

      <section class="bcard">
        <div class="bcard-head"><h4>设计语言</h4><em>Language</em></div>
        <div class="bf-row"><span>关键词</span>${tagEditor('design.keywords', d.keywords)}</div>
        <div class="bf-row"><span>字体排版</span>${area('design.typography', d.typography)}</div>
        <div class="bf-row"><span>图形纹样</span>${area('design.motifs', d.motifs)}</div>
        <div class="bf-row"><span>渲染背景</span>${area('design.backdrop', d.backdrop)}</div>
      </section>

      <section class="bcard">
        <div class="bcard-head"><h4>结构与工艺</h4><em>Craft</em></div>
        <div class="bf-row"><span>外包装</span>${area('outer.structure', outer.structure)}</div>
        <div class="bf-row"><span>尺寸</span>${area('outer.dimensions', outer.dimensions, 'bf-input', 1, '宽 × 深 × 高 mm')}</div>
        <div class="bf-row"><span>材质</span>${area('design.materials', d.materials)}</div>
        <div class="bf-row"><span>印刷工艺</span>${tagEditor('design.finishes', d.finishes, true)}</div>
      </section>

      <section class="bcard bcard-wide">
        <div class="bcard-head"><h4>产品档案</h4><em>Profile</em><span class="bcard-tools"><button type="button" class="mini-btn" data-spec-add>＋ 规格</button></span></div>
        <div class="specs" data-specs>${specsHtml(p.specs)}</div>
        <div class="bf-row" style="margin-top:10px"><span>目标人群</span>${area('product.audience', p.audience)}</div>
        <div class="bf-row"><span>市场定位</span>${area('product.positioning', p.positioning)}</div>
      </section>
    </div>

    <div class="faces">
      <section class="face-card">
        <div class="bcard-head"><span class="group-badge">A</span><h4>外包装版面</h4><em>Outer Faces</em></div>
        ${facePanes('outer', outer.faces)}
      </section>
      <section class="face-card">
        <div class="bcard-head"><span class="group-badge">B</span><h4>内包装版面</h4><em>Inner Faces</em></div>
        <div class="face-struct">
          <div class="bf-row"><span>内包装</span>${area('inner.structure', inner.structure)}</div>
          <div class="bf-row"><span>内含物</span>${area('inner.items', inner.items)}</div>
          <div class="bf-row"><span>内装主体</span>${area('inner.unit', inner.unit || '', 'bf-input', 1, '如：30ml 磨砂玻璃滴管瓶')}</div>
          <div class="bf-row"><span>主体尺寸</span>${area('inner.dimensions', inner.dimensions || '', 'bf-input', 1, '宽 × 深 × 高 mm 或 Ø直径 × 高')}</div>
        </div>
        ${facePanes('inner', inner.faces)}
      </section>
      <section class="face-card bcard-wide" style="grid-column:1/-1">
        <div class="bcard-head"><span class="group-badge">C</span><h4>主视觉场景</h4><em>Key Visual</em></div>
        ${area('kv.content', kv.content, '', 2)}
        <div class="face-pane"><details><summary>英文场景提示（高级）</summary>${area('kv.sceneEn', kv.sceneEn, '', 3)}</details></div>
      </section>
    </div>`;
  setSaveState('synced');
  updatePlanNote();
  if (NEEDS_AUTOSIZE) requestAnimationFrame(() => $$('textarea', $('#briefBody')).forEach(autosize));
}

// 不支持 field-sizing 的浏览器用 JS 撑高文本框
const NEEDS_AUTOSIZE = !CSS.supports?.('field-sizing', 'content');
function autosize(el) {
  if (!NEEDS_AUTOSIZE || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

function specsHtml(specs) {
  return specs
    .map((s, i) => `<div class="spec">${input(`product.specs.${i}.label`, s.label, '', '项目')}${input(`product.specs.${i}.value`, s.value, '', '内容')}</div>`)
    .join('');
}

function updatePlanNote() {
  const el = $('#renderPlanNote');
  if (!el) return;
  const o = projectOptions();
  const kv = o.includeKv;
  const q = QUALITIES.find((x) => x.id === o.quality)?.name || '精致';
  el.textContent = `将渲染 ${kv ? 7 : 6} 张：外包装三视图 · 内包装三视图${kv ? ' · 主视觉全家福' : ''} ｜ 精度「${q}」 ｜ 预计 ${o.quality === 'medium' ? '2–3' : '3–6'} 分钟`;
}

// 简报编辑：统一委托
const briefBody = $('#briefBody');

briefBody.addEventListener('input', (e) => {
  const el = e.target;
  const path = el.dataset.path;
  if (!path || !state.project?.brief) return;
  let value = el.value;
  if (el.hasAttribute('data-lines')) value = value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (el.type === 'color') {
    value = value.toUpperCase();
    const swatch = el.closest('.swatch');
    el.parentElement.style.background = value;
    $('.hex', swatch).textContent = value;
  }
  setPath(state.project.brief, path, value);
  autosize(el);
  scheduleSave();
});

briefBody.addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('tag-input') || e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  const val = e.target.value.trim();
  if (!val) return;
  const editor = e.target.closest('[data-tags]');
  getPath(state.project.brief, editor.dataset.tags).push(val);
  rerenderTags(editor);
  $('.tag-input', briefBody.querySelector(`[data-tags="${editor.dataset.tags}"]`))?.focus();
  scheduleSave();
});

briefBody.addEventListener('click', (e) => {
  const b = state.project?.brief;
  if (!b) return;
  const del = e.target.closest('[data-tag-del]');
  if (del) {
    const editor = del.closest('[data-tags]');
    getPath(b, editor.dataset.tags).splice(Number(del.dataset.tagDel), 1);
    rerenderTags(editor);
    return scheduleSave();
  }
  const sDel = e.target.closest('[data-swatch-del]');
  if (sDel) {
    b.design.palette.splice(Number(sDel.dataset.swatchDel), 1);
    $('[data-palette]').innerHTML = paletteHtml(b.design.palette);
    return scheduleSave();
  }
  if (e.target.closest('[data-swatch-add]')) {
    b.design.palette.push({ name: '新颜色', hex: '#A9C9AE', role: '点缀' });
    $('[data-palette]').innerHTML = paletteHtml(b.design.palette);
    return scheduleSave();
  }
  if (e.target.closest('[data-spec-add]')) {
    b.product.specs.push({ label: '', value: '' });
    $('[data-specs]').innerHTML = specsHtml(b.product.specs);
    $$('[data-specs] .spec').at(-1)?.querySelector('input')?.focus();
    return;
  }
  const tab = e.target.closest('[data-face-tab]');
  if (tab) {
    const [group] = tab.dataset.faceTab.split(':');
    $$(`[data-face-tab^="${group}:"]`).forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    $$(`[data-face-pane^="${group}:"]`).forEach((p) => (p.hidden = p.dataset.facePane !== tab.dataset.faceTab));
  }
});

function rerenderTags(editor) {
  const path = editor.dataset.tags;
  const gold = !!editor.querySelector('.tag.gold') || path === 'design.finishes';
  editor.outerHTML = tagEditor(path, getPath(state.project.brief, path), gold);
}

function setSaveState(s) {
  const el = $('#saveState');
  el.classList.toggle('saving', s === 'saving');
  el.textContent = { saving: '保存中…', synced: '已同步', error: '保存失败，将在渲染时一并提交' }[s];
}

function scheduleSave() {
  setSaveState('saving');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveBrief, 700);
}

async function saveBrief() {
  clearTimeout(state.saveTimer);
  if (!state.project) return;
  // 串行保存，每次都带上当前版本号
  state.savePromise = (state.savePromise || Promise.resolve()).then(async () => {
    const { id, brief, briefRev = 0 } = state.project;
    try {
      const saved = await api(`/api/projects/${id}/brief`, { method: 'PUT', json: { brief, rev: briefRev } });
      if (state.project?.id === id) state.project.briefRev = saved.briefRev;
      setSaveState('synced');
    } catch (err) {
      if (err.stale) return reloadStale(err.message);
      setSaveState('error');
    }
  });
  return state.savePromise;
}

// 服务器上的简报比本地新（另一个窗口改过或重新解析过）
async function reloadStale(message) {
  clearTimeout(state.saveTimer);
  toast(message, 'error', 6000);
  if (state.project) await loadProject(state.project.id, { scroll: false });
}

// 渲染前先等本地修改落盘，版本号才对得上
async function flushBrief() {
  clearTimeout(state.saveTimer);
  await state.savePromise;
}

/* ───────────── 渲染 ───────────── */
function activeViews(project = state.project) {
  const includeKv = project.options?.includeKv !== false || project.images?.kv;
  return state.views.filter((v) => v.group !== 'kv' || includeKv);
}

async function generate() {
  if (!state.project?.brief || state.analyzing) return;
  if (pickingDirections()) return toast('请先选定一个设计方向');
  if (isActive()) return toast('渲染进行中，请等待完成后再重新生成');
  const btn = $('#generateBtn');
  btn.classList.add('is-busy');
  try {
    await flushBrief();
    const project = await api(`/api/projects/${state.project.id}/generate`, {
      json: { brief: state.project.brief, rev: state.project.briefRev ?? 0, options: (({ quality, includeKv }) => ({ quality, includeKv }))(projectOptions()) },
    });
    setProject(project);
    setSaveState('synced'); // 简报已随渲染请求一并保存
    state.galleryKey = '';
    closeBrief();
    renderGallery();
    setRail(2);
    reveal('#step3');
    startPolling();
  } catch (err) {
    if (err.stale) reloadStale(err.message);
    else toast(err.message, 'error', 6000);
    // 首次出图失败时也露出渲染区，用户可以从这里重试或打开设计简报
    if ($('#step3').hidden && state.project?.brief) {
      state.galleryKey = '';
      renderGallery();
      setRail(2);
      reveal('#step3');
    }
  } finally {
    btn.classList.remove('is-busy');
  }
}

$('#generateBtn').addEventListener('click', generate);
$('#rerunBtn').addEventListener('click', () => {
  if (isActive()) return toast('渲染进行中，请稍候');
  const fresh = !Object.keys(state.project?.images || {}).length;
  if (fresh || confirm('按当前简报重新渲染全部视图？（旧版本会保留在历史版本里）')) generate();
});

const ISO_SVG = `<svg class="iso" viewBox="0 0 80 80" aria-hidden="true"><path d="M14 28 40 15l26 13v26L40 67 14 54z"/><path d="M14 28l26 13 26-13M40 41v26"/></svg>`;
const ICONS = {
  zoom: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
};

function renderGallery() {
  const p = state.project;
  renderDirections();
  if (pickingDirections(p)) return;
  const views = activeViews(p);
  const key = `${p.id}:${views.map((v) => v.id).join(',')}`;
  if (state.galleryKey !== key) {
    state.galleryKey = key;
    const groups = [
      { id: 'outer', code: 'A', cn: '外包装三视图', en: 'Outer Packaging · Orthographic Set', meta: [p.brief.outer.structure, p.brief.outer.dimensions].filter(Boolean).join(' · ') },
      { id: 'inner', code: 'B', cn: '内包装三视图', en: 'Inner Packaging · Orthographic Set', meta: p.brief.inner.structure },
      { id: 'kv', code: 'C', cn: '主视觉全家福', en: 'Hero Key Visual', meta: '16 : 9 场景大片' },
    ];
    $('#gallery').innerHTML = groups
      .filter((g) => views.some((v) => v.group === g.id))
      .map(
        (g) => `<section class="gallery-group">
          <header class="group-head">
            <span class="group-code">${g.code}</span>
            <div><h3>${g.cn}</h3><span class="group-en">${g.en}</span></div>
            <span class="group-meta">${esc(g.meta || '')}</span>
          </header>
          <div class="gallery-row" ${g.id === 'kv' ? 'style="grid-template-columns:1fr"' : ''}>
            ${views
              .filter((v) => v.group === g.id)
              .map(
                (v) => `<figure class="shot ${v.group === 'kv' ? 'kv' : ''}" data-view="${v.id}">
                  <div class="shot-frame" tabindex="0">
                    <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
                    <img alt="${esc(v.label)}" />
                    <div class="shot-state">${ISO_SVG}<span class="shot-phase">待渲染</span><span class="shot-timer"></span><span class="shot-error"></span></div>
                    <div class="shot-tools">
                      <button type="button" class="tool" data-tool="zoom" title="查看大图">${ICONS.zoom}</button>
                      <a class="tool" data-tool="down" title="下载" download>${ICONS.down}</a>
                      <button type="button" class="tool" data-tool="redo" title="重绘">${ICONS.redo}</button>
                    </div>
                  </div>
                  <figcaption><span class="shot-code">${v.code}</span><span class="shot-label">${v.label.split(' · ')[1] || v.label}</span><span class="shot-en">${v.en.split(' · ')[1] || v.en}</span><span class="shot-ver" hidden></span></figcaption>
                </figure>`,
              )
              .join('')}
          </div>
        </section>`,
      )
      .join('');
  }
  updateGallery();
}

function updateGallery() {
  const p = state.project;
  if (pickingDirections(p)) return renderDirections();
  const views = activeViews(p);
  const now = Date.now();
  let done = 0;

  for (const v of views) {
    const card = $(`.shot[data-view="${v.id}"]`);
    if (!card) continue;
    const img = p.images?.[v.id] || {};
    const status = img.status || 'idle';
    card.className = `shot ${v.group === 'kv' ? 'kv' : ''} ${status}`;
    const phaseEl = $('.shot-phase', card);
    const timerEl = $('.shot-timer', card);
    const errEl = $('.shot-error', card);
    errEl.textContent = '';
    $('.shot-retry', card)?.remove();

    if (status === 'done') {
      done++;
      const imgEl = $('img', card);
      if (imgEl.dataset.src !== img.file) {
        imgEl.classList.remove('loaded');
        imgEl.onload = () => imgEl.classList.add('loaded');
        imgEl.dataset.src = img.file;
        imgEl.src = img.file;
      }
      const dl = $('[data-tool="down"]', card);
      dl.href = img.file;
      dl.setAttribute('download', `${v.code}-${v.label.replace(/\s|·/g, '')}${'.png'}`);
      const ver = $('.shot-ver', card);
      const n = img.versions?.length || 1;
      ver.hidden = n < 2;
      ver.textContent = `${n} 个版本`;
    } else {
      $('img', card).classList.remove('loaded');
    }

    if (status === 'running' || status === 'queued') {
      phaseEl.textContent = PHASE_TEXT[img.phase] || (status === 'queued' ? PHASE_TEXT.WAITING : '渲染中');
      timerEl.textContent = img.startedAt && status === 'running' ? fmtTime(now - img.startedAt) : '';
    } else if (status === 'error') {
      phaseEl.textContent = '渲染失败';
      timerEl.textContent = '';
      errEl.textContent = img.error || '';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-ghost btn-sm shot-retry';
      retry.textContent = '重新渲染';
      retry.dataset.retry = v.id;
      $('.shot-state', card).append(retry);
    } else if (status === 'idle') {
      phaseEl.textContent = '待渲染';
      timerEl.textContent = '';
    }
  }

  // 流水线节点
  for (const stage of [1, 2, 3]) {
    const sv = views.filter((v) => v.stage === stage);
    const sts = sv.map((v) => p.images?.[v.id]?.status || 'idle');
    const node = $(`.pipe-node[data-stage="${stage}"]`);
    const isDone = sts.length && sts.every((s) => s === 'done' || s === 'error');
    const isActive = sts.some((s) => s === 'running');
    node.classList.toggle('done', !!isDone && !isActive);
    node.classList.toggle('active', isActive);
    const line = node.nextElementSibling;
    if (line?.classList.contains('pipe-line')) line.classList.toggle('done', !!isDone);
  }
  $('#pipeCount').textContent = `${done} / ${views.length}`;
  const pl = p.pipeline;
  if (pl?.startedAt) $('#pipeTimer').textContent = fmtTime((pl.status === 'running' ? now : pl.finishedAt || now) - pl.startedAt);
  const rendered = Object.keys(p.images || {}).length > 0;
  $('#rerunBtn').textContent = rendered ? '全部重绘' : '开始渲染';
  $('#renderSubtitle').textContent = isActive()
    ? '渲染进行中 · 可以先打开「设计简报」修改，完成后再重新生成'
    : rendered
      ? `已完成 ${done} 张 · 点击图片查看大图、下载或重绘 · 想调整设计，打开「设计简报」修改后重新生成`
      : '设计简报已就绪 · 点击「开始渲染」出图，或先打开「设计简报」自定义';

  const deliver = $('#deliver');
  deliver.hidden = done === 0;
  $('#zipBtn').href = `/api/projects/${p.id}/zip`;
  if (done && !isActive()) setRail(3);
}

function isActive(project = state.project) {
  if (!project) return false;
  if (project.pipeline?.status === 'running' || project.direction?.status === 'previewing') return true;
  if ((project.directions || []).some((d) => d.image?.status === 'running' || d.image?.status === 'queued')) return true;
  return Object.values(project.images || {}).some((i) => i.status === 'running' || i.status === 'queued');
}

function startPolling() {
  stopPolling();
  state.wasActive = true;
  const tick = async () => {
    if (!state.project) return;
    try {
      const fresh = await api(`/api/projects/${state.project.id}`);
      // 保留本地未保存的简报修改（连同它对应的版本号）
      state.project = { ...fresh, brief: state.project.brief, briefRev: state.project.briefRev };
      renderGallery();
      if (lbOpen()) refreshLightbox();
      if (!isActive()) {
        stopPolling();
        if (state.wasActive && pickingDirections()) {
          const bad = state.project.directions.filter((d) => d.image?.status === 'error').length;
          toast(bad ? `预览出完了，有 ${bad} 个方向失败，可以点「重画」` : '预览已出 ✦ 选一个喜欢的方向', bad ? 'error' : 'info', 5000);
          state.wasActive = false;
        } else if (state.wasActive) {
          const failed = activeViews().filter((v) => state.project.images?.[v.id]?.status === 'error').length;
          toast(failed ? `渲染结束，有 ${failed} 张失败，可单独重试` : '全部渲染完成 ✦ 点击图片查看细节', failed ? 'error' : 'info', 5000);
          state.wasActive = false;
        }
        return;
      }
    } catch {}
    state.pollTimer = setTimeout(tick, 2000);
  };
  state.pollTimer = setTimeout(tick, 1200);
}

function stopPolling() {
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

// 每秒刷新计时器
setInterval(() => {
  if (state.project && !$('#step3').hidden && isActive()) updateGallery();
}, 1000);

$('#gallery').addEventListener('click', (e) => {
  const retry = e.target.closest('[data-retry]');
  if (retry) return regenerate(retry.dataset.retry, '');
  const card = e.target.closest('.shot');
  if (!card) return;
  const viewId = card.dataset.view;
  const tool = e.target.closest('[data-tool]');
  if (tool?.dataset.tool === 'down') return;
  if (tool?.dataset.tool === 'redo') return openRegen(viewId);
  if (card.classList.contains('done') && e.target.closest('.shot-frame')) openLightbox(viewId);
});

$('#gallery').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList.contains('shot-frame')) return;
  const card = e.target.closest('.shot');
  if (card.classList.contains('done')) openLightbox(card.dataset.view);
});

/* ───────────── 平行方向 ─────────────
   JEV 挑出的几个不同品牌的参考，各自写简报、各出一张外包装正视图；
   选定一个后，简报与参考成为项目设计，其余视图接着渲染。 */
function pickingDirections(project = state.project) {
  return ['previewing', 'choosing'].includes(project?.direction?.status);
}

const dirLetter = (i) => String.fromCharCode(65 + i);
const dirName = (d) => `${d.match.primary.brand} · ${d.match.primary.name}`;
const DIR_PHASE_TEXT = { ...PHASE_TEXT, WAITING: '准备中' };

function showDirections(message) {
  state.galleryKey = '';
  closeBrief();
  renderGallery();
  setRail(2);
  reveal('#step3');
  startPolling();
  toast(message);
}

function directionCardHtml(d, i) {
  const brief = d.brief;
  const reason = brief.referenceExplanation?.reason || '';
  const dots = (brief.design?.palette || []).slice(0, 5).map((c) => `<i style="background:${esc(c.hex)}" title="${esc(c.name || '')}"></i>`).join('');
  return `<article class="dir-card" data-dir="${d.id}">
    <figure class="shot">
      <div class="shot-frame" tabindex="0">
        <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
        <img alt="方向 ${dirLetter(i)} 外包装正视图" />
        <div class="shot-state">${ISO_SVG}<span class="shot-phase"></span><span class="shot-timer"></span><span class="shot-error"></span></div>
        <div class="shot-tools"><button type="button" class="tool" data-tool="zoom" title="查看大图">${ICONS.zoom}</button></div>
      </div>
    </figure>
    <div class="dir-info">
      <div class="dir-top"><span class="dir-code">方向 ${dirLetter(i)}</span></div>
      <h4 class="dir-ref">${esc(d.match.primary.brand)}<small>${esc(d.match.primary.name)}</small></h4>
      <p class="dir-concept">${esc(brief.design?.conceptName || brief.product.name)}</p>
      ${dots ? `<div class="dir-palette">${dots}</div>` : ''}
      ${reason ? `<p class="dir-why">${esc(reason)}</p>` : ''}
      <div class="dir-actions">
        <button type="button" class="btn btn-primary btn-sm" data-dir-choose disabled><span>选这个方向</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-dir-retry>重画</button>
      </div>
    </div>
  </article>`;
}

function directionStripHtml(dirs, chosen) {
  return `<span class="dir-strip-label">设计方向</span><div class="dir-strip-items">${dirs
    .map((d, i) => {
      const current = d.id === chosen;
      const usable = d.image?.status === 'done';
      return `<button type="button" class="dir-chip ${current ? 'current' : ''}" data-dir-switch="${d.id}" ${current ? 'aria-current="true"' : ''} ${current || usable ? '' : 'disabled'} title="${current ? '当前使用的方向' : usable ? '改用这个方向' : '这个方向没有出预览，不能选用'}">
        <span class="dir-chip-img">${d.image?.file ? `<img src="${esc(d.image.file)}" alt="" />` : ''}</span>
        <span class="dir-chip-txt"><b>方向 ${dirLetter(i)}${current ? ' · 当前' : ''}</b><small>${esc(dirName(d))}</small></span>
      </button>`;
    })
    .join('')}</div>`;
}

function renderDirections() {
  const p = state.project;
  const box = $('#directions');
  const dirs = p?.directions || [];
  const mode = pickingDirections(p) ? 'pick' : p?.direction?.status === 'chosen' ? 'chosen' : '';
  $('#step3').classList.toggle('is-picking', mode === 'pick' && dirs.length > 1);
  if (!mode || dirs.length < 2) {
    box.hidden = true;
    state.dirKey = '';
    return;
  }
  const key = [p.id, mode, p.direction.chosen, ...dirs.map((d) => `${d.id}|${d.match.primary.id}|${d.brief.design?.conceptName}`)].join(';');
  if (key !== state.dirKey) {
    state.dirKey = key;
    box.className = `directions ${mode}`;
    box.innerHTML = mode === 'pick' ? dirs.map(directionCardHtml).join('') : directionStripHtml(dirs, p.direction.chosen);
  }
  box.hidden = false;

  if (mode === 'chosen') {
    // 缩略图随预览重画而更新
    $$('.dir-chip', box).forEach((chip, i) => {
      const file = dirs[i].image?.file;
      const img = $('img', chip);
      if (img && img.getAttribute('src') !== file) img.src = file;
    });
    return;
  }

  const now = Date.now();
  const busy = dirs.some((d) => d.image?.status === 'running' || d.image?.status === 'queued');
  dirs.forEach((d) => {
    const card = $(`.dir-card[data-dir="${d.id}"]`, box);
    const img = d.image || {};
    const status = img.status || 'idle';
    const shot = $('.shot', card);
    shot.className = `shot ${status}`;
    const imgEl = $('img', card);
    if (status === 'done') {
      if (imgEl.dataset.src !== img.file) {
        imgEl.classList.remove('loaded');
        imgEl.onload = () => imgEl.classList.add('loaded');
        imgEl.dataset.src = img.file;
        imgEl.src = img.file;
      }
    } else {
      imgEl.classList.remove('loaded');
      delete imgEl.dataset.src;
    }
    const running = status === 'running' || status === 'queued';
    $('.shot-phase', card).textContent = running ? DIR_PHASE_TEXT[img.phase] || '渲染中' : status === 'error' ? '预览失败' : '待渲染';
    $('.shot-timer', card).textContent = status === 'running' && img.startedAt ? fmtTime(now - img.startedAt) : '';
    $('.shot-error', card).textContent = status === 'error' ? img.error || '' : '';
    $('[data-dir-choose]', card).disabled = status !== 'done' || !!state.choosing;
    const retry = $('[data-dir-retry]', card);
    retry.disabled = running;
    retry.textContent = status === 'error' ? '重试' : '重画';
  });
  const n = projectOptions().includeKv ? 6 : 5;
  $('#renderSubtitle').textContent = busy
    ? `JEV 挑出了 ${dirs.length} 个参考方向，正在同时出外包装正视图预览 · 约 1 分钟`
    : `选一个喜欢的方向 · 选定后会用它补全其余 ${n} 张（外包装侧视 · 背视 · 内包装三视图${n === 6 ? ' · 主视觉' : ''}）`;
}

async function chooseDirection(id) {
  if (state.analyzing || state.choosing) return;
  const d = state.project?.directions?.find((x) => x.id === id);
  if (!d) return;
  if (state.project.pipeline?.status === 'running') return toast('当前这套图还在渲染，请等待完成后再换方向', 'error');
  state.choosing = id;
  renderDirections();
  const letter = dirLetter(state.project.directions.indexOf(d));
  try {
    const { quality, includeKv } = projectOptions();
    const project = await api(`/api/projects/${state.project.id}/directions/${id}/choose`, { json: { options: { quality, includeKv } } });
    setProject(project);
    setSaveState('synced');
    renderBrief();
    state.galleryKey = '';
    renderGallery();
    setRail(2);
    startPolling();
    toast(`已选定方向 ${letter}，开始补全其余 ${includeKv ? 6 : 5} 张`);
  } catch (err) {
    toast(err.message, 'error', 6000);
  } finally {
    state.choosing = null;
    renderDirections();
  }
}

// 已经选定后改用另一个方向：会用新方向的设计重新渲染其余视图，当前这套图被取代
async function switchDirection(id) {
  const d = state.project.directions.find((x) => x.id === id);
  if (!d || state.choosing || state.analyzing) return;
  if (isActive()) return toast('请等待当前渲染完成后再换方向', 'error');
  const ok = await askConfirm({
    eyebrow: 'Direction',
    title: `改用「${dirName(d)}」？`,
    desc: `将采用这个方向的设计简报与参考，重新渲染其余 ${projectOptions().includeKv ? 6 : 5} 张。现在这套图会被取代，你在简报里做的修改也会被这个方向的简报替换。`,
    ok: '改用这个方向',
  });
  if (ok) chooseDirection(id);
}

async function retryDirection(id) {
  try {
    const project = await api(`/api/projects/${state.project.id}/directions/${id}/retry`, { json: {} });
    state.project = { ...project, brief: state.project.brief, briefRev: state.project.briefRev };
    renderGallery();
    startPolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#directions').addEventListener('click', (e) => {
  const card = e.target.closest('.dir-card');
  if (card && e.target.closest('[data-dir-choose]')) return chooseDirection(card.dataset.dir);
  if (card && e.target.closest('[data-dir-retry]')) return retryDirection(card.dataset.dir);
  const chip = e.target.closest('[data-dir-switch]');
  if (chip) return chip.classList.contains('current') ? undefined : switchDirection(chip.dataset.dirSwitch);
  if (card && card.querySelector('.shot.done') && e.target.closest('.shot-frame')) openDirectionLightbox(card.dataset.dir);
});

$('#directions').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList.contains('shot-frame')) return;
  const card = e.target.closest('.dir-card');
  if (card?.querySelector('.shot.done')) openDirectionLightbox(card.dataset.dir);
});

/* ───────────── 重绘 ───────────── */
function openRegen(viewId) {
  const v = state.views.find((x) => x.id === viewId);
  state.regenView = viewId;
  $('#regenTitle').textContent = `重绘 · ${v.label}`;
  $('#regenExtra').value = '';
  $('.modal-desc', $('#regenModal')).textContent =
    viewId === 'outer_front'
      ? '正视图是其余视角的一致性基准。重绘后如需同步其它视角，可点击「全部重绘」。修改意见会作为最高优先级执行。'
      : '写下修改意见会作为最高优先级执行；留空则按当前简报重新渲染一版。旧版本会保留。';
  $('#regenModal').hidden = false;
  setTimeout(() => $('#regenExtra').focus(), 50);
}

function closeRegen() {
  $('#regenModal').hidden = true;
  state.regenView = null;
}

async function regenerate(viewId, extra) {
  if (state.analyzing) return toast('请等待参考匹配完成', 'error');
  try {
    await flushBrief();
    const { brief, briefRev = 0 } = state.project;
    const project = await api(`/api/projects/${state.project.id}/views/${viewId}/regenerate`, { json: { extra, brief, rev: briefRev } });
    state.project = { ...project, brief };
    setSaveState('synced');
    renderGallery();
    startPolling();
    toast('已开始重绘');
  } catch (err) {
    if (err.stale) reloadStale(err.message);
    else toast(err.message, 'error');
  }
}

$('#regenModal').addEventListener('click', (e) => {
  const act = e.target.closest('[data-modal]')?.dataset.modal;
  if (e.target.id === 'regenModal' || act === 'cancel') return closeRegen();
  if (act === 'confirm') {
    const viewId = state.regenView;
    const extra = $('#regenExtra').value;
    closeRegen();
    if (lbOpen()) closeLightbox();
    regenerate(viewId, extra);
  }
});

/* ───────────── 大图查看 ───────────── */
const lb = $('#lightbox');
const lbOpen = () => !lb.hidden;
const doneViews = () => activeViews().filter((v) => state.project.images?.[v.id]?.status === 'done');

// 大图可以看整套里的某一张，也可以看平行方向的预览
function lbEntry() {
  const p = state.project;
  if (state.lbDirection) {
    const i = p.directions.findIndex((d) => d.id === state.lbDirection);
    const d = p.directions[i];
    return d && { code: `方向 ${dirLetter(i)}`, title: dirName(d), en: 'Direction Preview · Outer Front', img: d.image, direction: true, file: `方向${dirLetter(i)}-${d.match.primary.brand}.png` };
  }
  const v = state.views.find((x) => x.id === state.lbView);
  return v && { code: v.code, title: v.label, en: v.en, img: p.images?.[v.id], file: `${v.code}-${v.label.replace(/\s|·/g, '')}.png` };
}

function lbIds() {
  return state.lbDirection ? state.project.directions.filter((d) => d.image?.status === 'done').map((d) => d.id) : doneViews().map((v) => v.id);
}

function openLightbox(viewId) {
  state.lbView = viewId;
  state.lbDirection = null;
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
  refreshLightbox(true);
}

function openDirectionLightbox(id) {
  state.lbDirection = id;
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
  refreshLightbox(true);
}

function refreshLightbox(force = false) {
  const entry = lbEntry();
  const img = entry?.img;
  if (!img || img.status !== 'done') return;
  const lbImg = $('#lbImg');
  if (force || lbImg.dataset.src !== img.file) {
    lbImg.dataset.src = img.file;
    lbImg.src = img.file;
    lbImg.style.animation = 'none';
    void lbImg.offsetWidth;
    lbImg.style.animation = '';
  }
  $('#lbCode').textContent = entry.code;
  $('#lbTitle').textContent = entry.title;
  $('#lbEn').textContent = entry.en;
  $('#lbPrompt').textContent = img.prompt || '';
  const dl = $('#lbDownload');
  dl.href = img.file;
  dl.setAttribute('download', entry.file);
  $('[data-lb="regen"]', lb).hidden = !!entry.direction;
  const canChoose = !!entry.direction && pickingDirections();
  $('[data-lb="choose"]', lb).hidden = !canChoose;
  dl.classList.toggle('btn-primary', !canChoose);
  dl.classList.toggle('btn-ghost', canChoose);
  const versions = entry.direction ? [] : img.versions || [];
  $('#lbVersions').innerHTML =
    versions.length > 1
      ? versions
          .map((ver, i) => `<button type="button" data-ver="${i}" aria-current="${ver.file === img.file}" title="版本 ${i + 1}"><img src="${ver.file}" alt="版本 ${i + 1}" /></button>`)
          .join('')
      : '';
  const multi = lbIds().length > 1;
  $$('.lb-nav', lb).forEach((n) => (n.hidden = !multi));
}

function closeLightbox() {
  lb.hidden = true;
  state.lbDirection = null;
  document.body.style.overflow = '';
}

function stepLightbox(dir) {
  const list = lbIds();
  if (list.length < 2) return;
  const current = state.lbDirection || state.lbView;
  const next = list[(list.indexOf(current) + dir + list.length) % list.length];
  if (state.lbDirection) state.lbDirection = next;
  else state.lbView = next;
  refreshLightbox(true);
}

lb.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-lb]')?.dataset.lb;
  if (act === 'close' || e.target === lb || e.target.classList.contains('lb-figure')) return closeLightbox();
  if (act === 'prev') return stepLightbox(-1);
  if (act === 'next') return stepLightbox(1);
  if (act === 'regen') return openRegen(state.lbView);
  if (act === 'choose') {
    const id = state.lbDirection;
    closeLightbox();
    return chooseDirection(id);
  }
  const ver = e.target.closest('[data-ver]');
  if (ver) {
    try {
      const project = await api(`/api/projects/${state.project.id}/views/${state.lbView}/select`, { json: { index: Number(ver.dataset.ver) } });
      state.project = { ...project, brief: state.project.brief };
      refreshLightbox();
      renderGallery();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#regenModal').hidden) return closeRegen();
    if (lbOpen()) return closeLightbox();
    if (briefOpen()) return closeBrief();
    if ($('#historyDrawer').classList.contains('open')) return closeHistory();
  }
  if (lbOpen() && $('#regenModal').hidden) {
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  }
});

/* ───────────── 交付 ───────────── */
$('#boardBtn').addEventListener('click', async () => {
  const btn = $('#boardBtn');
  btn.classList.add('is-busy');
  btn.textContent = '排版中…';
  try {
    await exportBoard(state.project, activeViews());
    toast('提案板已导出');
  } catch (err) {
    toast(`导出失败：${err.message}`, 'error');
  } finally {
    btn.classList.remove('is-busy');
    btn.textContent = '导出提案板 PNG';
  }
});

/* ───────────── 作品集 ───────────── */
const drawer = $('#historyDrawer');

async function openHistory() {
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  $('#drawerMask').hidden = false;
  await renderHistory();
}

function closeHistory() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  $('#drawerMask').hidden = true;
}

async function renderHistory() {
  const list = $('#historyList');
  try {
    const items = await api('/api/projects');
    $('#historyCount').textContent = items.length || '';
    if (!items.length) {
      list.innerHTML = '<div class="empty"><b>还没有作品</b>上传第一份产品文档，开启你的包装设计。</div>';
      return;
    }
    list.innerHTML = items
      .map(
        (it) => `<div class="h-item" data-open="${it.id}">
          <div class="h-cover">${it.cover ? `<img src="${it.cover}" alt="" loading="lazy" />` : esc((it.name || '匣').slice(0, 1))}</div>
          <div style="min-width:0">
            <div class="h-name">${esc(it.brand ? `${it.brand} · ${it.name}` : it.name)}</div>
            <div class="h-sub">${esc(it.conceptName || '未完成解析')} · ${new Date(it.createdAt).toLocaleDateString('zh-CN')} · ${it.picking ? '待选方向' : `${it.doneCount} 张`}</div>
            <div class="h-dots">${it.palette.map((c) => `<i style="background:${esc(c.hex)}"></i>`).join('')}</div>
          </div>
          <button type="button" class="h-del" data-del="${it.id}" aria-label="删除">×</button>
        </div>`,
      )
      .join('');
  } catch (err) {
    list.innerHTML = `<div class="empty"><b>读取失败</b>${esc(err.message)}</div>`;
  }
}

$('#openHistory').addEventListener('click', openHistory);
$('#closeHistory').addEventListener('click', closeHistory);
$('#drawerMask').addEventListener('click', closeHistory);

$('#historyList').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    const ok = await askConfirm({ eyebrow: 'Delete', title: '删除这个作品？', desc: '简报、参考图与全部渲染图都会一并删除，且无法恢复。', ok: '删除' });
    if (!ok) return;
    try {
      await api(`/api/projects/${del.dataset.del}`, { method: 'DELETE' });
      if (state.project?.id === del.dataset.del) {
        state.project = null;
        history.replaceState(null, '', location.pathname);
        closeBrief();
        $('#step3').hidden = true;
        setRail(1);
      }
      renderHistory();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  const item = e.target.closest('[data-open]');
  if (item) {
    closeHistory();
    loadProject(item.dataset.open);
  }
});

async function loadProject(id, { scroll = true } = {}) {
  if (state.analyzing) return toast('请等待本轮参考匹配完成', 'error');
  try {
    const project = await api(`/api/projects/${id}`);
    if (state.analyzing) return;
    if (state.project?.id !== id) closeBrief(); // 只在切换项目时收起；同项目重载（简报过期）保持打开
    setProject(project);
    state.galleryKey = '';
    if (!project.brief) {
      $('#step3').hidden = true;
      setRail(1);
      toast('这个项目还没有完成解析');
      return;
    }
    renderBrief();
    // 有简报就展示渲染区：还没出过图的项目在这里点「开始渲染」
    $('#step3').hidden = false;
    setRail(2);
    renderGallery(); // 全部完成时会推进到第 3 步
    if (isActive(project)) startPolling();
    if (scroll) requestAnimationFrame(() => $('#step3').scrollIntoView({ behavior: 'smooth' }));
  } catch (err) {
    toast(err.message, 'error');
    history.replaceState(null, '', location.pathname);
  }
}

/* ───────────── 启动 ───────────── */
async function init() {
  renderChoices();
  updatePlanNote();
  try {
    state.views = await api('/api/views');
  } catch {
    toast('无法连接服务，请确认已运行 npm start', 'error', 8000);
  }
  api('/api/health')
    .then((h) => {
      const pill = $('#statusPill');
      const ok = h.llm && h.image && h.jev && h.referenceLibrary;
      pill.classList.add(ok ? 'ok' : 'bad');
      $('span', pill).textContent = ok ? '模型与参考库已就绪' : '模型或参考库未配置';
    })
    .catch(() => {
      $('#statusPill').classList.add('bad');
      $('#statusPill span').textContent = '服务未连接';
    });
  api('/api/projects')
    .then((items) => ($('#historyCount').textContent = items.length || ''))
    .catch(() => {});
  const m = location.hash.match(/p=([\w-]+)/);
  if (m) loadProject(m[1], { scroll: true });
}

// 在已打开的页面里粘贴作品链接时也能切换
window.addEventListener('hashchange', () => {
  const m = location.hash.match(/p=([\w-]+)/);
  if (m && m[1] !== state.project?.id) loadProject(m[1], { scroll: true });
});

init();
