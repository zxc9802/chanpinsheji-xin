// 电商主图 + 详情图：入口弹窗、结果区、可编辑的设计简报。
// 主流程（项目状态、轮询、大图、重绘）仍在 app.js，这里通过 ctx 与它对接。
import { composeLong, canvasBlob } from './longimage.js';

const KINDS = {
  main: { label: '主图', code: 'M', cn: '电商主图', ratio: '1 : 1' },
  detail: { label: '详情图', code: 'D', cn: '商品详情图', ratio: '9 : 16 竖屏' },
};

const SCOPE_HINT = {
  main: '主图 5 张（1 : 1），含 1 张白底图，其余 4 张的岗位与顺序由 AI 规划。',
  detail: '详情页 6–12 屏（9 : 16 竖屏），屏数与每屏内容由 AI 按资料决定。',
  both: '主图 5 张（1 : 1，含白底图）+ 详情页 6–12 屏（9 : 16），全部由 AI 规划。',
};

const DETAIL_LAYOUTS = {
  detail_standard_conversion_10: { name: '标准详情 · 10 屏', hint: '适合常规上新、卖点比较集中的产品，用较短篇幅讲清卖点、成分、用法和规格。' },
  detail_evidence_chain_16: { name: '证据链详情 · 16 屏', hint: '适合成分或功效需要深入讲解，且有研发、测试、真人反馈等资料的产品，逐层说明原理与效果依据。' },
};
const MODES = {
  reference: { label: '参考库模式' },
  claude: { label: 'AI 规划' },
};
const modeOf = (c) => c?.mode || c?.plan?.mode || 'reference';
const TONE = { dark: '深色屏', light: '浅色屏', mid: '中间调' };

const PHASE_MSG = {
  IDENTIFY: '正在识别产品图中的信息…',
  CLASSIFY: 'JEV 正在判断品类与包装形态…',
  SYSTEM: 'JEV 正在从电商参考库里挑选视觉系统…',
  PLAN: '正在规划主图与详情图的每一屏…',
  REFERENCES: 'JEV 正在为每一屏挑选设计参考图…',
  CLAUDE_PLAN: 'AI 正在看产品图与资料，规划每一屏的信息、颜色结构与版式（约 3–6 分钟）…',
  CLAUDE_CHECK: 'AI 正在逐条核对图上文案是否都有资料依据…',
  RENDER: '规划完成，开始出图…',
};

const FACT_NAMES = {
  confirmed_benefits: '产品优势',
  confirmed_ingredients_or_scent: '成分 / 香调',
  verified_mechanism: '原理',
  target_user_needs: '人群与需求',
  confirmed_instructions: '使用方法',
  verified_specs_and_label: '规格',
  confirmed_use_scenario: '使用场景',
  verified_faq: '问答',
};

const MAX_INPUTS = 4;
const MAX_UPLOAD = 25 * 1024 * 1024;

export function initCommerce(ctx) {
  const { state, $, $$, esc, api, toast, askConfirm, fmtTime, paintShot, previewUrl, ISO_SVG, ICONS } = ctx;

  const commerceOf = (p = state.project) => p?.commerce || null;
  const slotsOf = (c) => c?.plan?.slots || [];
  const slotCode = (slot) => `${KINDS[slot.kind].code}-${slot.id.split('_')[1]}`;
  const slotTitle = (slot) => `${KINDS[slot.kind].label} · ${slot.title}`;
  const busyOf = (c) =>
    ['planning', 'rendering'].includes(c?.status) || Object.values(c?.images || {}).some((i) => i.status === 'running' || i.status === 'queued');
  const isActive = (p = state.project) => busyOf(commerceOf(p));

  /* ───────────── 结果区 ───────────── */
  function render() {
    const p = state.project;
    const c = commerceOf(p);
    const section = $('#commerce');
    section.hidden = !c;
    $('#commerceBtn').textContent = p?.kind === 'commerce' ? '更换产品图，生成套图' : c ? '重新生成主图 + 详情图' : '生成主图 + 详情图';
    $('#commerceTitle').textContent = p?.kind === 'commerce' ? '电商套图' : '电商主图 + 详情图';
    if (!c) {
      state.commerceKey = '';
      $('#commerceGallery').innerHTML = '';
      return;
    }
    const slots = slotsOf(c);
    const key = `${p.id}:${c.rev}:${c.startedAt}:${slots.map((s) => s.id).join(',')}`;
    if (state.commerceKey !== key) {
      state.commerceKey = key;
      $('#commerceGallery').innerHTML = ['main', 'detail']
        .filter((kind) => slots.some((s) => s.kind === kind))
        .map((kind) => {
          const list = slots.filter((s) => s.kind === kind);
          return `<section class="gallery-group commerce-group">
            <header class="group-head">
              <span class="group-code">${KINDS[kind].code}</span>
              <div><h3>${kind === 'detail' && c.plan.detailLayout ? esc(DETAIL_LAYOUTS[c.plan.detailLayout.id].name) : kind === 'detail' && modeOf(c) === 'claude' ? `AI 规划详情 · ${list.length} 屏` : KINDS[kind].cn}</h3><span class="group-en">${list.length} ${kind === 'main' ? 'images' : 'screens'} · ${KINDS[kind].ratio}</span></div>
              <span class="group-meta">${esc(c.plan.system.style.slice(0, 3).join(' · '))}</span>
            </header>
            <div class="gallery-row commerce-row ${kind}">
              ${list
                .map(
                  (s) => `<figure class="shot ${kind === 'detail' ? 'portrait' : ''}" data-slot="${s.id}">
                    <div class="shot-frame" tabindex="0">
                      <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
                      <img alt="${esc(slotTitle(s))}" />
                      <div class="shot-state">${ISO_SVG}<span class="shot-phase">待渲染</span><span class="shot-timer"></span><span class="shot-error"></span></div>
                      <div class="shot-tools">
                        <button type="button" class="tool" data-tool="zoom" title="查看大图">${ICONS.zoom}</button>
                        <a class="tool" data-tool="down" title="下载" download>${ICONS.down}</a>
                        <button type="button" class="tool" data-tool="redo" title="重绘">${ICONS.redo}</button>
                      </div>
                    </div>
                    <figcaption><span class="shot-code">${slotCode(s)}</span><span class="shot-label">${esc(s.title)}</span><span class="shot-en">${esc(s.roleLabel)}</span><span class="shot-ver" hidden></span></figcaption>
                  </figure>`,
                )
                .join('')}
            </div>
          </section>`;
        })
        .join('');
    }
    update();
  }

  function update() {
    const p = state.project;
    const c = commerceOf(p);
    if (!c || $('#commerce').hidden) return;
    const slots = slotsOf(c);
    const now = Date.now();
    let done = 0;
    for (const slot of slots) {
      const card = $(`.shot[data-slot="${slot.id}"]`);
      if (!card) continue;
      const img = c.images?.[slot.id] || {};
      if (paintShot(card, img, {
        baseClass: slot.kind === 'detail' ? 'portrait' : '',
        dlName: `${slotCode(slot)}-${slot.title}.png`,
        retry: ['cretry', slot.id],
        waiting: slot.id === c.plan.anchor || slot.role === 'white' ? '准备中' : '等待首图定稿',
        now,
      })) done++;
    }

    const planning = c.status === 'planning';
    const failed = c.status === 'error';
    $('#commerceStatus').hidden = !planning;
    $('#commerceMsg').textContent = PHASE_MSG[c.phase] || '正在规划…';
    const err = $('#commerceError');
    err.hidden = !failed;
    if (failed) {
      err.innerHTML = `<b>没能完成规划</b><span>${esc((c.error || '未知错误').replace(/claude/gi, 'AI'))}</span><button type="button" class="btn btn-ghost btn-sm" data-cact="retry">重试</button>`;
    }
    const skipped = c.plan?.skipped?.length || 0;
    const mode = modeOf(c);
    const scope = `${MODES[mode].label} · ${{ main: '仅主图', detail: '仅详情图', both: '主图 + 详情图' }[c.scope]}${mode === 'reference' && c.scope !== 'main' && c.detailLayoutId ? ` · ${DETAIL_LAYOUTS[c.detailLayoutId]?.name || ''}` : ''}`;
    const alt = p.commerceAlt?.plan ? p.commerceAlt : null;
    const switcher = $('#commerceMode');
    switcher.hidden = !alt;
    if (alt) {
      const count = (x) => `${(x.plan?.slots || []).filter((s) => x.images?.[s.id]?.status === 'done').length} 张`;
      const altMode = modeOf(alt);
      const html = [[mode, c, true], [altMode, alt, false]].sort((a) => (a[0] === 'reference' ? -1 : 1))
        .map(([m, x, on]) => `<button type="button" data-cmode="${on ? '' : 'switch'}" aria-pressed="${on}" ${!on && busyOf(c) ? 'disabled title="这一套生成完成后才能切换"' : ''}>${MODES[m].label} · ${count(x)}</button>`).join('');
      if (switcher.innerHTML !== html) switcher.innerHTML = html;
    }
    $('#commerceSub').textContent = planning
      ? `${scope} · 正在规划，请稍候`
      : failed
        ? `${scope} · 规划失败`
        : `${scope} · 已出 ${done} / ${slots.length} 张${skipped ? ` · ${skipped} 类备选屏未采用` : ''}${c.startedAt && c.status === 'rendering' ? ` · ${fmtTime(now - c.startedAt)}` : ''}`;
    $('#commerceBriefBtn').disabled = !c.plan;
    const detail = slots.filter((s) => s.kind === 'detail');
    const unfinished = detail.filter((s) => !(c.images?.[s.id]?.status === 'done' && c.images[s.id].file)).length;
    const longBtn = $('#commerceLongBtn');
    longBtn.hidden = !detail.length;
    longBtn.disabled = !c.plan || busyOf(c) || unfinished > 0;
    longBtn.title = longBtn.disabled && detail.length ? (unfinished ? `还有 ${unfinished} 屏没有出完，全部定稿后可以合成` : '生成结束后可以合成') : '把全部详情屏按顺序拼成一张长图';
    $('#commerceAgainBtn').disabled = busyOf(c);
    if (state.sheetOpen) syncSheetState();
  }

  // 结果区点击：单张操作 / 顶部按钮
  $('#commerce').addEventListener('click', (e) => {
    const act = e.target.closest('[data-cact]')?.dataset.cact;
    if (act === 'brief') return openSheet();
    if (act === 'again') return openModal();
    if (act === 'long') return openLong();
    if (act === 'retry') return start({ reuse: true });
    if (e.target.closest('[data-cmode="switch"]')) return switchMode();
    const retry = e.target.closest('[data-cretry]');
    if (retry) return ctx.retrySlot(retry.dataset.cretry);
    const card = e.target.closest('.shot');
    if (!card) return;
    const tool = e.target.closest('[data-tool]');
    if (tool?.dataset.tool === 'down') return;
    if (tool?.dataset.tool === 'redo') return ctx.regenSlot(card.dataset.slot);
    if (tool?.dataset.tool === 'zoom' && commerceOf()?.images?.[card.dataset.slot]?.file) return ctx.openSlotLightbox(card.dataset.slot);
    if (card.classList.contains('done') && e.target.closest('.shot-frame')) ctx.openSlotLightbox(card.dataset.slot);
  });
  $('#commerce').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('shot-frame')) return;
    const card = e.target.closest('.shot');
    if (card.classList.contains('done')) ctx.openSlotLightbox(card.dataset.slot);
  });

  /* ───────────── 入口弹窗 ───────────── */
  const modal = $('#commerceModal');
  const cm = { views: new Set(), files: [], document: null, savedDocument: null, scope: 'both', create: false, direct: false };
  const claudeReady = () => state.health?.claudePlanner !== false;

  async function switchMode() {
    const p = state.project;
    try {
      if (!(await save({ quiet: true })) || state.project?.id !== p.id) return;
      const project = await api(`/api/projects/${p.id}/commerce/switch`, { json: {} });
      if (state.project?.id !== p.id) return;
      state.project = { ...project, brief: state.project.brief, briefRev: state.project.briefRev };
      state.commerceKey = '';
      render();
      if (sheetOpen()) renderSheet();
      toast(`已切换到${MODES[modeOf(project.commerce)].label}的那一套`);
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  }

  const picked = () => cm.views.size + cm.files.length;
  const readyViews = () => !state.project || cm.direct ? [] : ctx.activeViews().filter((v) => state.project.images?.[v.id]?.status === 'done' && state.project.images[v.id].file);

  function renderModal() {
    $('#cmTitle').textContent = cm.direct ? '上传产品图，生成套图' : '生成主图 + 详情图';
    $('#cmDesc').textContent = cm.direct
      ? '拖入或上传同一件产品的 1–4 张图片，勾选主图、详情图或两者，即可开始生成。工作台会识别产品信息，由 AI 规划每一屏后出图。'
      : '选好产品图（同一件产品的一张或多个角度，最多 4 张），再选要生成的内容。点开始后 AI 会规划每一屏的信息、颜色结构与版式，然后直接出图，不需要再确认。';
    $('#cmGenerated').hidden = cm.direct;
    $('#cmUploadLabel').textContent = cm.direct ? '上传自己的产品图 · PNG / JPG / WebP · 单张不超过 25 MB' : '或上传自己的产品图';
    $('#cmProductInfoBlock').hidden = !cm.direct;
    const productDoc = cm.document || cm.savedDocument;
    $('#cmDocAdd').hidden = Boolean(productDoc);
    $('#cmDocSelected').hidden = !productDoc;
    $('#cmDocName').textContent = productDoc ? `${productDoc.name}${cm.savedDocument && !cm.document ? ' · 已保存，可沿用' : ''}` : '';
    const views = readyViews();
    $('#cmViews').innerHTML = views.length
      ? views
          .map((v) => {
            const on = cm.views.has(v.id);
            return `<button type="button" class="cm-tile" data-view="${v.id}" aria-pressed="${on}" title="${esc(v.label)}">
              <img src="${previewUrl(state.project.images[v.id].file)}" alt="${esc(v.label)}" loading="lazy" />
              <span>${esc(v.label.replace(' · ', ' '))}</span><i class="cm-check" aria-hidden="true">✓</i>
            </button>`;
          })
          .join('')
      : '<p class="cm-empty">这套包装还没有成图，可以直接上传自己的产品图。</p>';
    $$('.cm-file', $('#cmUploads')).forEach((n) => n.remove());
    const add = $('#cmAdd');
    const previews = $('#cmUploadPreviews');
    cm.files.forEach((f, i) => {
      const el = document.createElement('div');
      el.className = 'ref-item cm-file';
      el.innerHTML = `<img src="${f.url}" alt="${esc(f.file.name)}" title="${esc(f.file.name)}" /><button type="button" aria-label="移除" data-rm="${i}">×</button>`;
      previews.append(el);
    });
    previews.hidden = !cm.files.length;
    add.hidden = picked() >= MAX_INPUTS;
    $('#cmCount').textContent = `已选 ${picked()} / ${MAX_INPUTS}`;
    $$('#cmScope input').forEach((input) => { input.checked = cm.scope === 'both' || input.dataset.scope === cm.scope; });
    $('#cmScopeHint').textContent = SCOPE_HINT[cm.scope] || '请至少选择一种生成内容。';
    $('#cmStart').disabled = picked() === 0 || !cm.scope || !claudeReady();
    $('#cmStart').title = claudeReady() ? '' : '服务端未配置 AI 规划模型';
    const current = cm.create ? null : commerceOf();
    const sameMode = [current, cm.create ? null : state.project?.commerceAlt].find((x) => x?.plan && modeOf(x) === 'claude');
    const kept = current?.plan && modeOf(current) !== 'claude' ? current : null;
    const note = [
      sameMode && '这个项目已经有一套 AI 规划的主图与详情图，重新生成会替换它',
      kept && `${MODES[modeOf(kept)].label}的那套会保留，生成后可在结果区上方切换对比`,
    ].filter(Boolean).join('；');
    $('#cmReplace').hidden = !note;
    $('#cmReplace').textContent = note ? `${note}。` : '';
  }

  function openModal({ create = false } = {}) {
    const p = state.project;
    if (!create && !p?.brief && p?.kind !== 'commerce') return;
    if (state.analyzing) return toast('请等待本轮设计完成', 'error');
    if (ctx.isActive()) return toast('渲染进行中，请等待完成后再生成主图与详情图', 'error');
    cm.files.forEach((f) => URL.revokeObjectURL(f.url));
    cm.files = [];
    cm.create = create;
    cm.direct = create || p?.kind === 'commerce';
    cm.document = null;
    cm.savedDocument = create ? null : p?.source?.document || null;
    $('#cmProductInfo').value = create ? '' : p?.source?.introText ?? p?.source?.excerpt ?? '';
    const c = create ? null : commerceOf();
    const ready = readyViews().map((v) => v.id);
    const previous = (c?.inputs || []).filter((i) => i.source === 'generated' && ready.includes(i.view)).map((i) => i.view);
    cm.views = new Set(previous.length ? previous : ready.includes('outer_front') ? ['outer_front'] : ready.slice(0, 1));
    cm.scope = c?.scope || 'both';
    renderModal();
    modal.hidden = false;
    setTimeout(() => (cm.direct ? $('#cmAdd') : $('#cmStart')).focus(), 50);
  }

  function closeModal() {
    modal.hidden = true;
    $('#cmUploads').classList.remove('drag');
    $('#cmDocUploads').classList.remove('drag');
    cm.files.forEach((f) => URL.revokeObjectURL(f.url));
    cm.files = [];
    cm.document = null;
    cm.savedDocument = null;
    cm.create = false;
  }

  function addFiles(list) {
    const room = MAX_INPUTS - picked();
    const ok = [...list].filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
    if (ok.length < list.length) toast('只支持 PNG、JPG、WebP 图片');
    const small = ok.filter((f) => f.size <= MAX_UPLOAD);
    if (small.length < ok.length) toast('单张图片不能超过 25 MB');
    if (small.length > room) toast(`产品图最多 ${MAX_INPUTS} 张`);
    cm.files.push(...small.slice(0, Math.max(0, room)).map((file) => ({ file, url: URL.createObjectURL(file) })));
    renderModal();
  }

  $('#cmFile').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  function addDocument(files) {
    const file = files[0];
    if (!file) return;
    if (files.length > 1) return toast('产品介绍一次可上传 1 份文档');
    if (!/\.(pdf|docx|pptx|xlsx|md|markdown|txt|csv|json|html|htm)$/i.test(file.name)) return toast('支持 PDF、Word（DOCX）、PPT（PPTX）、Excel、Markdown、TXT 等文档', 'error');
    if (file.size > MAX_UPLOAD) return toast('单份文档不能超过 25 MB', 'error');
    cm.document = file;
    cm.savedDocument = null;
    renderModal();
  }
  $('#cmDocFile').addEventListener('change', (e) => {
    addDocument([...e.target.files]);
    e.target.value = '';
  });
  $('#cmDocRemove').addEventListener('click', () => {
    cm.document = null;
    cm.savedDocument = null;
    renderModal();
  });
  $('#cmDocAdd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#cmDocFile').click(); }
  });
  const docZone = $('#cmDocUploads');
  ['dragenter', 'dragover'].forEach((type) => docZone.addEventListener(type, (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    docZone.classList.add('drag');
  }));
  docZone.addEventListener('dragleave', (e) => { if (!docZone.contains(e.relatedTarget)) docZone.classList.remove('drag'); });
  docZone.addEventListener('drop', (e) => {
    e.preventDefault();
    docZone.classList.remove('drag');
    addDocument([...e.dataTransfer.files]);
  });
  const uploadZone = $('#cmUploads');
  ['dragenter', 'dragover'].forEach((type) => uploadZone.addEventListener(type, (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    uploadZone.classList.add('drag');
  }));
  uploadZone.addEventListener('dragleave', (e) => {
    if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag');
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag');
    addFiles(e.dataTransfer.files);
  });
  $('#cmScope').addEventListener('change', () => {
    const selected = $$('#cmScope input:checked').map((input) => input.dataset.scope);
    cm.scope = selected.length === 2 ? 'both' : selected[0] || '';
    renderModal();
  });
  $('#cmAdd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('#cmFile').click();
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-cm="cancel"]')) return closeModal();
    const tile = e.target.closest('.cm-tile');
    if (tile) {
      const id = tile.dataset.view;
      if (cm.views.has(id)) cm.views.delete(id);
      else if (picked() >= MAX_INPUTS) toast(`产品图最多 ${MAX_INPUTS} 张`);
      else cm.views.add(id);
      return renderModal();
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const [gone] = cm.files.splice(Number(rm.dataset.rm), 1);
      URL.revokeObjectURL(gone.url);
      return renderModal();
    }
    if (e.target.closest('[data-cm="start"]')) start();
  });

  async function start({ reuse = false } = {}) {
    const p = state.project;
    const creating = !reuse && cm.create;
    if (!p && !creating) return;
    if (!reuse && (!picked() || !cm.scope)) return;
    if (!claudeReady()) return toast('服务端未配置 AI 规划模型', 'error');
    const btn = $('#cmStart');
    const body = new FormData();
    body.set('planMode', 'claude');
    if (reuse) {
      body.set('reuse', '1');
      body.set('scope', commerceOf(p)?.scope || 'both');
    } else {
      body.set('scope', cm.scope);
      body.set('views', JSON.stringify([...cm.views]));
      cm.files.forEach((f) => body.append('images', f.file));
      if (cm.direct) {
        body.set('text', $('#cmProductInfo').value.trim());
        if (cm.document) body.append('doc', cm.document);
        else if (cm.savedDocument) body.set('reuseDocument', '1');
      }
    }
    btn.classList.add('is-busy');
    btn.disabled = true;
    try {
      if (!(await ctx.flushBrief()) || (creating && !(await save({ quiet: true }))) || state.project?.id !== p?.id) return;
      const project = await api(creating ? '/api/commerce-projects' : `/api/projects/${p.id}/commerce`, { method: 'POST', body });
      if (state.project?.id !== p?.id) return;
      if (!modal.hidden) closeModal();
      if (creating) ctx.openCreated(project);
      else state.project = { ...project, brief: p.brief, briefRev: p.briefRev };
      dirty = false;
      await closeSheet();
      ctx.renderGallery();
      ctx.startPolling();
      toast('已开始：先规划每一屏，再直接出图');
      requestAnimationFrame(() => $('#commerce').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      btn.classList.remove('is-busy');
      btn.disabled = picked() === 0 || !cm.scope;
    }
  }

  /* ───────────── 详情长图 ───────────── */
  const longModal = $('#longModal');
  const long = { canvas: null, jpg: null, url: '', token: 0 };
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  const fileBase = () => `${(state.project?.brief?.product?.name || state.project?.source?.name || '商品').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30) || '商品'}-详情长图`;

  function closeLong() {
    long.token++;
    longModal.hidden = true;
    if (long.url) URL.revokeObjectURL(long.url);
    Object.assign(long, { canvas: null, jpg: null, url: '' });
    $('#longImg').hidden = true;
    $('#longImg').removeAttribute('src');
  }

  async function openLong() {
    const c = commerceOf();
    const list = slotsOf(c).filter((s) => s.kind === 'detail');
    const urls = list.map((s) => c.images?.[s.id]?.file).filter(Boolean);
    if (!list.length || list.some((s) => c.images?.[s.id]?.status !== 'done') || urls.length !== list.length || busyOf(c)) return toast('详情图还没有全部出完', 'error');
    const token = ++long.token;
    $('#longMeta').textContent = `正在把 ${list.length} 屏拼成长图…`;
    $('#longPng').disabled = true;
    $('#longJpg').disabled = true;
    $('#longImg').hidden = true;
    longModal.hidden = false;
    try {
      const made = await composeLong(urls);
      const jpg = await canvasBlob(made.canvas, 'image/jpeg', 0.95);
      if (token !== long.token) return;
      if (long.url) URL.revokeObjectURL(long.url);
      Object.assign(long, { canvas: made.canvas, jpg, url: URL.createObjectURL(jpg) });
      const img = $('#longImg');
      img.src = long.url;
      img.hidden = false;
      $('#longScroll').scrollTop = 0;
      $('#longMeta').textContent = `${made.count} 屏，按详情页的先后顺序无缝拼接 · ${made.width} × ${made.height} px · JPG ${mb(jpg.size)} MB`;
      $('#longPng').disabled = false;
      $('#longJpg').disabled = false;
    } catch (err) {
      if (token !== long.token) return;
      closeLong();
      toast(err.message, 'error', 6000);
    }
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  longModal.addEventListener('click', async (e) => {
    if (e.target === longModal || e.target.closest('[data-long="close"]')) return closeLong();
    const kind = e.target.closest('[data-long]')?.dataset.long;
    if (kind === 'jpg' && long.jpg) return saveBlob(long.jpg, `${fileBase()}.jpg`);
    if (kind === 'png' && long.canvas) {
      const btn = $('#longPng');
      btn.disabled = true;
      try {
        saveBlob(await canvasBlob(long.canvas, 'image/png'), `${fileBase()}.png`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }
  });

  /* ───────────── 设计简报（可编辑） ───────────── */
  const sheet = $('#commerceSheet');
  let dirty = false;
  let editVersion = 0;
  let sheetRev = 0;
  let savePromise = Promise.resolve(true);
  const sheetOpen = () => !sheet.hidden;

  const factText = (key, v) => (typeof v === 'string' ? v : key === 'verified_specs_and_label' ? `${v.label} ${v.value}` : `${v.q} → ${v.a}`);

  // Claude 规划模式：每屏的版式线框、颜色面积条与版式说明（颜色均为服务端校验过的 HEX）
  const wireframe = (slot) => {
    const d = slot.design;
    const zones = d.zones.map((z, i) => `<i class="wf-zone wf-${z.kind}" style="left:${z.x}%;top:${z.y}%;width:${z.w}%;height:${z.h}%;z-index:${i};${z.fill ? `--fill:${z.fill}` : ''}" title="${esc(z.label)}"></i>`).join('');
    return `<div class="wf ${slot.kind}" style="background:${slot.role === 'white' ? '#FFFFFF' : d.colors[0]?.hex || '#FFFFFF'}">${zones}</div>`;
  };
  const colorBar = (colors) => `<div class="cbar">${colors.map((x) => `<i style="flex:${x.share} 0 0;background:${x.hex}" title="${esc(`${x.hex} · ${x.share}% · ${x.use}`)}"></i>`).join('')}</div>
    <ul class="cbar-legend">${colors.map((x) => `<li><i style="background:${x.hex}"></i><span><b>${x.share}%</b> ${esc(x.use)}</span></li>`).join('')}</ul>`;
  const designBlock = (slot) => {
    const d = slot.design;
    if (slot.role === 'white') return '<p class="cs-meta">白底图：纯白背景，只放产品，不加文字和道具。</p>';
    return `<div class="cs-design">
        ${wireframe(slot)}
        <div class="cs-design-info">
          <p class="cs-tone"><b>${TONE[d.tone] || ''}</b>${d.productShare ? ` · 产品约 ${esc(d.productShare)}` : ''}</p>
          ${d.replaces ? `<p class="cs-replaces">${esc(d.replaces)}</p>` : ''}
          ${colorBar(d.colors)}
        </div>
      </div>
      ${d.layout ? `<p class="cs-using"><b>版式</b>${esc(d.layout)}</p>` : ''}
      ${d.light ? `<p class="cs-using"><b>光线与材质</b>${esc(d.light)}</p>` : ''}
      ${d.transition ? `<p class="cs-using"><b>与上一屏</b>${esc(d.transition)}</p>` : ''}`;
  };

  function claudeTop(plan) {
    const cl = plan.claude;
    const st = cl.strategy;
    return `<div class="cs-top">
        <section class="face-card cs-system">
          <div class="bcard-head"><span class="group-badge">S</span><h4>规划策略</h4><em>AI 规划</em></div>
          <p class="cs-summary">${esc(st.coreMessage || st.positioning)}</p>
          <p class="cs-meta">${esc(st.positioning)}${st.tone ? `<br />调性：${esc(st.tone)}` : ''}</p>
          ${st.sellingPoints.map((x) => `<p class="cs-point"><b>${esc(x.point)}</b><span>${esc(x.source)}</span>${x.where ? `<small>${esc(x.where)}</small>` : ''}</p>`).join('')}
          <p class="cs-meta">规划用时 ${fmtTime(cl.ms || 0)} · 文案自检发现 ${cl.audit?.flagged || 0} 处资料不支持的说法并改写${cl.audit?.dropped ? `，仍不合规的 ${cl.audit.dropped} 处已删除` : ''}</p>
        </section>
        <section class="face-card">
          <div class="bcard-head"><span class="group-badge">C</span><h4>色板与字体</h4><em>Palette</em></div>
          <div class="cs-swatches">${cl.palette.map((x) => `<div class="cs-sw"><i style="background:${x.hex}"></i><b>${esc(x.name)}</b><code>${x.hex}</code><small>${esc(x.role)}</small></div>`).join('')}</div>
          <ul class="cs-type">${cl.typography.map((t) => `<li><b>${esc(t.level)}</b><span>${esc(t.font)}</span><small>主图 ${esc(t.main)} · 详情 ${esc(t.detail)}</small></li>`).join('')}</ul>
          ${cl.rhythm ? `<p class="cs-meta"><b>明暗节奏</b> ${esc(cl.rhythm)}</p>` : ''}
        </section>
      </div>
      <section class="face-card cs-strip-card">
        <div class="bcard-head"><span class="group-badge">R</span><h4>整套节奏</h4><em>每屏的底色与版式</em></div>
        ${['main', 'detail'].filter((k) => plan.slots.some((x) => x.kind === k)).map((k) => `<div class="cs-strip">${plan.slots.filter((x) => x.kind === k).map((x) => `<figure>${wireframe(x)}<figcaption>${esc(slotCode(x))}<br />${esc(x.title)}</figcaption></figure>`).join('')}</div>`).join('')}
      </section>`;
  }

  function slotCard(slot, c) {
    const ref = slot.reference;
    const copyLimit = slot.copyMax ?? (slot.kind === 'detail' ? (slot.moduleId === 'product_info' ? 10 : 5) : 4);
    const plain = slot.role === 'white'; // 白底图没有文字
    const inputs = slot.identityInputs.map((id) => (c.inputs || []).find((i) => i.id === id)).filter(Boolean);
    return `<section class="face-card cs-slot" data-slot="${slot.id}" data-copy-limit="${copyLimit}">
      <div class="bcard-head"><span class="group-badge">${slotCode(slot)}</span><h4>${esc(slot.title)}</h4><em>${esc(slot.roleLabel)}</em></div>
      <label class="cs-field"><span>屏名</span><input class="bf-input" data-f="title" maxlength="16" value="${esc(slot.title)}" /></label>
      ${plain ? '' : `<label class="cs-field"><span>主标题</span><input class="bf-input" data-f="headline" maxlength="${slot.kind === 'detail' ? 40 : 24}" value="${esc(slot.headline)}" /></label>
      <label class="cs-field"><span>辅助文字 <small>一行一条 · 最多 ${copyLimit} 条</small></span><textarea class="bf-input" data-f="copy" rows="2">${esc(slot.copy.join('\n'))}</textarea></label>`}
      <label class="cs-field"><span>构图设想</span><textarea class="bf-input" data-f="visual" rows="3">${esc(slot.visual)}</textarea></label>
      ${slot.design ? designBlock(slot) : ref ? `<div class="cs-ref">
        <div class="cs-ref-imgs">${ref.assets.map((a) => `<img src="${a.file}" alt="设计参考" loading="lazy" />`).join('')}</div>
        <p><b>设计参考</b>${esc(ref.title)}${ref.crossSystem ? ' <em>（借自另一套系统）</em>' : ''}<br /><small>${esc(ref.observed)}</small></p>
      </div>` : `<p class="cs-meta">${plain ? '白底图只用产品图，不用参考图，图上不放文字。' : '本屏按固定模块提示词构图，沿用整套视觉风格。'}</p>`}
      <p class="cs-using"><b>产品图</b>${inputs.map((i) => esc(i.label)).join('、')}</p>
    </section>`;
  }

  function renderSheet() {
    const c = commerceOf();
    const plan = c?.plan;
    if (!plan) return;
    const sys = plan.system;
    const facts = Object.entries(plan.facts || {}).filter(([, v]) => v.length);
    const claude = modeOf(c) === 'claude';
    $('#commerceBody').innerHTML = claude ? `${claudeTop(plan)}
      <div class="cs-slots">${plan.slots.map((s) => slotCard(s, c)).join('')}</div>
      ${plan.skipped.length ? `<section class="face-card cs-skipped">
        <div class="bcard-head"><span class="group-badge">X</span><h4>没有做的屏</h4><em>Skipped</em></div>
        <ul>${plan.skipped.map((s) => `<li><b>${esc(s.label)}</b><span>${esc(s.reason)}</span></li>`).join('')}</ul>
        <p class="cs-meta">资料不支持的屏不编造，补齐资料后可重新规划。</p>
      </section>` : ''}
      ${plan.claude.materials?.length ? `<section class="face-card cs-skipped">
        <div class="bcard-head"><span class="group-badge">M</span><h4>需要准备的素材</h4><em>Materials</em></div>
        <ul>${plan.claude.materials.map((m) => `<li><b>${esc(m.item)}</b><span>${esc(m.for)}${m.how ? ` · ${esc(m.how)}` : ''}</span></li>`).join('')}</ul>
      </section>` : ''}` : `
      <div class="cs-top">
        <section class="face-card cs-system">
          <div class="bcard-head"><span class="group-badge">S</span><h4>视觉系统</h4><em>JEV 挑选</em></div>
          <p class="cs-summary">${plan.mainLayout ? '主图 · 固定 5 张 · ' : ''}${plan.detailLayout ? `${esc(DETAIL_LAYOUTS[plan.detailLayout.id].name)} · ` : ''}${esc(plan.summary || '')}</p>
          <div class="tags-static">${sys.style.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
          <p class="cs-meta">参考 <b>${esc(sys.brand)} · ${esc(sys.name)}</b>（${esc(sys.category)} · ${esc(sys.form)}）的视觉风格。主图与详情页按各自固定结构推进，每屏参考图辅助版式、配色和光影，来源品牌、文案与数字不会带入。
          ${sys.confidence != null ? `<br />JEV 置信度 ${Math.round(sys.confidence * 100)}%${sys.alternatives?.length ? ` · 备选：${sys.alternatives.map((a) => esc(`${a.brand}·${a.name}`)).join('、')}` : ''}` : ''}</p>
        </section>
        <section class="face-card cs-facts">
          <div class="bcard-head"><span class="group-badge">F</span><h4>取自产品资料的事实</h4><em>Facts</em></div>
          ${facts.length
            ? facts.map(([k, v]) => `<p class="cs-fact"><b>${FACT_NAMES[k] || k}</b>${v.map((x) => `<span class="tag">${esc(factText(k, x))}</span>`).join('')}</p>`).join('')
            : '<p class="cs-meta">资料中的已知信息用于各屏文案，其余只作示意表达。</p>'}
          <p class="cs-meta">图上的文字只用这些事实；资料里没有的功效、数据、认证、价格与赠品不会出现。</p>
        </section>
      </div>
      ${plan.detailBrief?.missingEvidence?.length ? `<section class="face-card"><h4>资料待补充</h4><p class="cs-meta">以下信息仅用于完善方案，不会印在图片上。</p><ul>${plan.detailBrief.missingEvidence.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}
      <div class="cs-slots">${plan.slots.map((s) => slotCard(s, c)).join('')}</div>
      <section class="face-card cs-skipped">
        <div class="bcard-head"><span class="group-badge">X</span><h4>没有生成的屏</h4><em>Skipped</em></div>
        ${plan.skipped.length ? `<ul>${plan.skipped.map((s) => `<li><b>${esc(KINDS[s.kind]?.label || '')} · ${esc(s.label)}</b><span>${esc(s.reason)}</span></li>`).join('')}</ul>` : ''}
        <p class="cs-meta">详情页始终保留所选结构的完整屏数；资料不足时减少文案或采用示意表达，不自动添加测试数据和真实用户证言。</p>
      </section>`;
    $('#csSub').textContent = claude
      ? 'AI 规划 · 每一屏的信息、颜色结构与版式；文字与构图都可以修改，改完点击「按此方案重新生成」'
      : '按你的产品资料规划 · 每一屏的文字与构图都可以修改，改完点击「按此方案重新生成」';
    dirty = false;
    sheetRev = c.rev || 0;
    syncSheetState();
  }

  function syncSheetState() {
    const c = commerceOf();
    const busy = busyOf(c);
    const total = slotsOf(c).length;
    const finished = slotsOf(c).filter((s) => ['done', 'error'].includes(c?.images?.[s.id]?.status)).length;
    const wait = c?.status === 'planning' ? '正在规划，完成后才能重新生成' : `正在出图 ${finished} / ${total}，全部出完后才能重新生成`;
    $('#csGenerate').disabled = busy;
    $('#csReplan').disabled = busy;
    $('#csGenerate').title = busy ? wait : '';
    $('#csReplan').title = busy ? wait : '';
    $('#csNote').textContent = busy ? `${wait}；现在可以先修改文字，改动会保存` : `按当前方案重新出图，旧图会保留在每张图的历史版本里 · 共 ${total} 张`;
  }

  function openSheet() {
    const c = commerceOf();
    if (!c?.plan) return toast('还在规划中，规划完成后可以打开设计简报');
    if (!dirty) renderSheet();
    sheet.hidden = false;
    state.sheetOpen = true;
    document.body.style.overflow = 'hidden';
    $('#commerceBody').scrollTop = 0;
    $('.icon-btn', sheet).focus();
  }

  async function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    state.sheetOpen = false;
    document.body.style.overflow = '';
    if (dirty) await save({ quiet: true });
  }

  $('#commerceBody').addEventListener('input', () => { dirty = true; editVersion++; });
  sheet.addEventListener('click', (e) => e.target.closest('[data-csheet="close"]') && closeSheet());

  const collect = () => Object.fromEntries($$('.cs-slot', $('#commerceBody')).map((card) => {
    const f = (name) => $(`[data-f="${name}"]`, card)?.value; // 白底图没有主标题与辅助文字
    const edit = { title: f('title'), visual: f('visual') };
    if (f('headline') != null) edit.headline = f('headline');
    if (f('copy') != null) edit.copy = f('copy').split('\n').map((t) => t.trim()).filter(Boolean).slice(0, Number(card.dataset.copyLimit));
    return [card.dataset.slot, edit];
  }));

  async function save({ quiet = false } = {}) {
    const p = state.project;
    const c = commerceOf(p);
    if (!c?.plan) return true;
    const edits = dirty ? collect() : null;
    const version = editVersion;
    savePromise = savePromise.then(async () => {
      if (!dirty || !edits) return true;
      if (state.project?.id !== p.id) return false;
      try {
        const project = await api(`/api/projects/${p.id}/commerce/plan`, { method: 'PUT', json: { rev: sheetRev, slots: edits } });
        if (state.project?.id !== p.id) return false;
        state.project = { ...project, brief: state.project.brief, briefRev: state.project.briefRev };
        sheetRev = project.commerce.rev;
        if (version === editVersion) dirty = false;
        state.commerceKey = '';
        render();
        if (!quiet) toast('方案已保存');
        return true;
      } catch (err) {
        if (state.project?.id !== p.id) return false;
        toast(err.message, 'error', 6000);
        if (err.stale) {
          dirty = false;
          await ctx.reload();
          renderSheet();
        }
        return false;
      }
    });
    return savePromise;
  }

  $('#csGenerate').addEventListener('click', async () => {
    const p = state.project;
    const btn = $('#csGenerate');
    btn.classList.add('is-busy');
    try {
      if (!(await save({ quiet: true }))) return;
      if (state.project?.id !== p.id) return;
      const project = await api(`/api/projects/${p.id}/commerce/generate`, { json: {} });
      if (state.project?.id !== p.id) return;
      state.project = { ...project, brief: state.project.brief, briefRev: state.project.briefRev };
      state.commerceKey = '';
      await closeSheet();
      ctx.renderGallery();
      ctx.startPolling();
      toast('已按当前方案重新出图');
      requestAnimationFrame(() => $('#commerce').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      btn.classList.remove('is-busy');
    }
  });

  $('#csReplan').addEventListener('click', async () => {
    const ok = await askConfirm({
      eyebrow: 'Replan',
      title: '重新规划？',
      desc: '沿用当前选的产品图和范围，让 AI 重新规划每一屏的信息、颜色结构与版式，并立即出图。已有 AI 规划方案的文字修改和图片会被替换。',
      ok: '重新规划',
    });
    if (ok) start({ reuse: true });
  });

  // 调用方在切换项目前先 flush，避免把上一个项目的表单写入新项目。
  function reset() {
    if (!modal.hidden) closeModal();
    if (!longModal.hidden) closeLong();
    if (!sheet.hidden) {
      sheet.hidden = true;
      state.sheetOpen = false;
      document.body.style.overflow = '';
    }
    dirty = false;
    editVersion++;
    state.commerceKey = '';
  }

  return { render, update, reset, flush: () => save({ quiet: true }), openModal, closeModal, closeLong, longOpen: () => !longModal.hidden, closeSheet, sheetOpen, isActive, slotsOf, slotCode, slotTitle, commerceOf };
}
