import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { blankCanvasDataUri } from '../lib/fal.js';

// 生成的项目数据放在临时目录里，不碰用户真实的项目
const originalCwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-commerce-test-'));
process.chdir(temp);
const { createProject, getProject, updateProject, saveFile, localPathFromPublic } = await import('../lib/store.js');
// commerce.js 依赖 store.js，必须在 chdir 之后再载入，否则数据目录会指向真实项目
const { loadCommerceCatalog, eligibleScreens, shortlistSystems, candidatesFor, planCommerce } = await import('../lib/commerce.js');
const { buildCommerceInput, buildCommercePrompt, runCommerce, runCommerceSlot } = await import('../lib/commerce-render.js');
after(async () => { process.chdir(originalCwd); await fs.rm(temp, { recursive: true, force: true }); });

const DOC = '焕采精华液，30ml，细长按压泵瓶。核心成分：烟酰胺、透明质酸。适合肤色暗沉、缺水的人群。使用方法：洁面后取2泵，均匀涂抹全脸，轻拍至吸收。';
const brief = {
  product: { brand: '测试品牌', name: '焕采精华液', nameEn: 'Radiance Serum', category: '精华' },
  design: { style: '银白科技', palette: [{ name: '银白', hex: '#E9E9E8' }, { name: '橙金', hex: '#E8A33D' }] },
  outer: { structure: '单品折叠盒' }, inner: { structure: '细长泵瓶', unit: '30ml 精华泵瓶' },
};

const jev = (questions, pick) => Response.json({ model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => {
  const choice = pick(id, Object.keys(q.criteria));
  assert.ok(Object.hasOwn(q.criteria, choice), `${id}: ${choice} is not a criterion`);
  return [id, { type: 'choice', choice, confidence: 0.8, probabilities: Object.fromEntries(Object.keys(q.criteria).map((k) => [k, k === choice ? 1 : 0])) }];
})) });

const llmPlan = {
  summary: '先认清产品，再讲成分与用法',
  facts: {
    confirmed_benefits: ['提亮暗沉', '补水'],
    confirmed_ingredients_or_scent: ['烟酰胺', '透明质酸'],
    verified_mechanism: [], target_user_needs: ['肤色暗沉', '缺水'],
    confirmed_instructions: ['洁面后取2泵', '均匀涂抹全脸', '轻拍至吸收'],
    verified_specs_and_label: [{ label: '净含量', value: '30ml' }],
    confirmed_use_scenario: [], verified_faq: [],
  },
  detail: [
    { role: 'hero', title: '首屏', headline: '焕采精华液', copy: [], visual: '产品居中', images: [1, 2] },
    { role: 'usage', title: '使用方法', headline: '三步用好', copy: ['洁面后取2泵', '均匀涂抹全脸', '轻拍至吸收'], visual: '连续三格', images: [2] },
    { role: 'structure', title: '多角度', headline: '正面与侧面', copy: [], visual: '两个角度并排', images: [] },
    { role: 'faq', title: '问答', headline: '常见问题', copy: [], visual: '问答', images: [1] },
  ],
  skipped: [{ role: 'texture', reason: '资料里没有质地素材' }],
};

const png = Buffer.from(blankCanvasDataUri().split(',')[1], 'base64');
const realFetch = globalThis.fetch;

async function productDocument(ext, text) {
  if (ext === 'pdf') {
    const content = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf);
  }
  if (ext === 'docx' || ext === 'pptx') {
    const zip = new JSZip();
    if (ext === 'docx') {
      zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
    } else {
      zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>产品资料第一页</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
      zip.file('ppt/slides/slide2.xml', `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  }
  return Buffer.from(text);
}

async function fixture() {
  const project = await createProject({ brief: structuredClone(brief), docText: DOC, refs: [], images: {}, options: { quality: 'medium' } });
  const front = await saveFile(project.id, 'images', 'front.png', png);
  const side = await saveFile(project.id, 'images', 'side.png', Buffer.concat([png, Buffer.from('side')]));
  await updateProject(project.id, (p) => {
    p.images.outer_front = { status: 'done', file: front };
    p.images.outer_side = { status: 'done', file: side };
  });
  const identity = [
    { id: 'in1', source: 'generated', view: 'outer_front', label: '外包装 · 正视图', file: front },
    { id: 'in2', source: 'generated', view: 'outer_side', label: '外包装 · 侧视图', file: side },
  ];
  return { project: await getProject(project.id), identity };
}

function withNetwork(t, handlers) {
  const saved = Object.fromEntries(['JEV_API_KEY', 'LLM_API_KEY', 'FAL_KEY'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { JEV_API_KEY: 'test', LLM_API_KEY: 'test', FAL_KEY: 'test' });
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const calls = { jev: [], llm: [], fal: [] };
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1:')) return realFetch(url, init);
    if (u.includes('/systemone')) { const body = JSON.parse(init.body); calls.jev.push(body); return handlers.jev(body); }
    if (u.includes('chat/completions')) { const body = JSON.parse(init.body); calls.llm.push(body); return handlers.llm(body); }
    if (u.startsWith('https://queue.fal.run/')) { const body = JSON.parse(init.body); calls.fal.push(body); return Response.json({ status_url: `https://stub.invalid/status/${calls.fal.length}`, response_url: `https://stub.invalid/result/${calls.fal.length}` }); }
    if (u.startsWith('https://stub.invalid/status/')) return Response.json({ status: 'COMPLETED' });
    if (u.startsWith('https://stub.invalid/result/')) return Response.json({ images: [{ url: `https://stub.invalid/image-${u.split('/').pop()}.png` }] });
    if (u.startsWith('https://stub.invalid/image-')) return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected network call: ${u}`);
  });
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  return calls;
}

const defaultJev = (body) => jev(body.questions ?? {}, (id, keys) => {
  if (id === 'category') return '精华';
  if (id === 'form') return '细长泵瓶';
  if (id === 'system') return keys[0];
  return keys.at(-1); // 每一屏都挑最后一个候选，证明 JEV 的选择被采用
});
const { DETAIL_LAYOUTS, DETAIL_PROMPTS, DEFAULT_DETAIL_LAYOUT, normalizeDetailPlan } = await import('../lib/commerce-detail.js');
const { MAIN_LAYOUT, MAIN_PROMPTS, normalizeMainPlan } = await import('../lib/commerce-main.js');
const fixedRaw = (layoutId = DEFAULT_DETAIL_LAYOUT) => {
  const layout = DETAIL_LAYOUTS.find((l) => l.id === layoutId);
  return { ...structuredClone(llmPlan), product_info: {
    product_name: '焕采精华液', category: '精华', spec: '30ml', core_selling_points: ['提亮暗沉'],
    functions: ['补水'], ingredients: [{name: '烟酰胺', benefit: '提亮肤色'}, {name: '透明质酸', benefit: '补水'}],
    usage_method: ['洁面后取2泵', '均匀涂抹全脸', '轻拍至吸收'], effect_claims: [],
  }, main_layout_brief: { screen_count: 5, missing_evidence: ['缺少真实效果数据'], modules: MAIN_LAYOUT.modules.map((module_id) => ({
    module_id, headline: module_id === 'main_hero_selling_point' ? '提亮暗沉' : '补水护理',
    copy: module_id === 'main_ingredient' ? ['烟酰胺', '透明质酸', '美白提亮99%'] : ['30ml'],
    visual: '本屏独立构图', images: [1],
  })).reverse() }, detail_layout_brief: {layout_id: layout.id, screen_count: layout.modules.length,
    selected_auxiliary_effect: '补水', missing_evidence: ['缺少真人反馈和检测报告'],
    modules: layout.modules.map((module_id) => ({ module_id, headline: '补水护理', copy: ['清爽体验'], required_content: ['清爽体验'], visual: '本屏独立构图', images: [1] })),
  }};
};
const defaultLlm = (body) => {
  if (Array.isArray(body.messages.at(-1).content)) {
    return Response.json({ choices: [{ message: { content: JSON.stringify({ name: '焕采精华液', description: DOC }) } }] });
  }
  const prompt = body.messages.map((m) => m.content).join('\n');
  const layoutId = prompt.includes('detail_evidence_chain_16') ? 'detail_evidence_chain_16' : DEFAULT_DETAIL_LAYOUT;
  return Response.json({ choices: [{ message: { content: JSON.stringify(fixedRaw(layoutId)) } }] });
};

for (const layout of DETAIL_LAYOUTS) {
  test(`${layout.modules.length} screens: preserves the source order with sparse material and no matching reference`, async (t) => {
    const { project, identity } = await fixture();
    const calls = withNetwork(t, { jev: defaultJev, llm: defaultLlm });
    const plan = await planCommerce({ project, scope: 'both', identity, detailLayoutId: layout.id });
    const slots = plan.slots.filter((s) => s.kind === 'detail');
    assert.deepEqual(slots.map((s) => s.moduleId), layout.modules);
    assert.equal(plan.detailLayout.screenCount, layout.modules.length);
    assert.equal(plan.promptSource.revision, '42e2de6502ab9bbe40c806237f96735019318239');
    assert.deepEqual(plan.detailBrief.missingEvidence, ['缺少真人反馈和检测报告']);
    assert.ok(slots.some((s) => !s.reference), 'absence of proof/brand reference must not remove the screen');
    assert.ok(!plan.skipped.some((s) => s.kind === 'detail'));
    assert.ok(calls.llm[0].messages[1].content.includes(layout.id));
    assert.doesNotMatch(calls.llm[0].messages[1].content, /5-12|最多 12|成分详解另有/);
    assert.deepEqual(plan.slots.filter((s) => s.kind === 'main').map((s) => s.moduleId), MAIN_LAYOUT.modules);
    assert.equal(plan.mainLayout.screenCount, 5);
    assert.deepEqual(plan.slots[2].copy, ['烟酰胺', '透明质酸']);
    assert.equal(plan.slots[1].headline, '提亮暗沉');
    for (const s of slots.filter((s) => s.reference)) {
      for (const a of s.reference.assets) {
        const bytes = await fs.readFile(localPathFromPublic(a.file));
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), a.sha256);
      }
    }
  });

  test(`${layout.modules.length} screens: complete render payloads, persistent module prompts, edited redraw and versions`, async (t) => {
    const { project, identity } = await fixture();
    const calls = withNetwork(t, { jev: defaultJev, llm: defaultLlm });
    await updateProject(project.id, (p) => { p.commerce = { status: 'planning', scope: 'detail', detailLayoutId: layout.id, inputs: identity, rev: 0, images: {} }; });
    await runCommerce(project.id, { scope: 'detail', identity, detailLayoutId: layout.id });
    const done = await getProject(project.id);
    assert.equal(done.commerce.status, 'done', done.commerce.error);
    assert.equal(done.commerce.plan.slots.length, layout.modules.length);
    assert.equal(calls.fal.length, layout.modules.length);
    for (const [index, slot] of done.commerce.plan.slots.entries()) {
      const image = done.commerce.images[slot.id];
      assert.equal(image.status, 'done', image.error);
      assert.ok(image.file);
      const body = calls.fal.find((b) => b.prompt.includes(`- 当前模块：${slot.roleLabel}\n`));
      assert.ok(body, slot.moduleId);
      assert.deepEqual(body.image_size, { width: 1152, height: 2048 });
      assert.ok(body.prompt.includes(`第 ${index + 1}/${layout.modules.length} 张`));
      assert.match(body.prompt, /【详情页销售型生成策略】/);
      assert.match(body.prompt, /【产品身份锁定】/);
      assert.match(body.prompt, /【当前屏专属信息】/);
      assert.doesNotMatch(body.prompt, /\{\{|89%|86%|SCREEN:|Page task:|Product share of the frame/);
      assert.equal(body.image_urls.length, slot.identityInputs.length + (slot.reference?.assets.length || 0) + (index ? 1 : 0));
    }
    const disk = JSON.parse(await fs.readFile(path.join(temp, 'data/projects', project.id, 'project.json'), 'utf8'));
    assert.equal(disk.commerce.detailLayoutId, layout.id);
    assert.equal(disk.commerce.plan.slots.at(-1).moduleId, layout.modules.at(-1));
    await updateProject(project.id, (p) => { p.commerce.plan.slots.at(-1).headline = '用户修改标题'; p.commerce.plan.slots.at(-1).copy = ['用户新文案']; });
    const slotId = done.commerce.plan.slots.at(-1).id;
    await runCommerceSlot(project.id, slotId, { extra: '标题字号更大' });
    const latest = (await getProject(project.id)).commerce.images[slotId];
    assert.equal(latest.versions.length, 2);
    assert.match(latest.prompt, /用户修改标题/);
    assert.match(latest.prompt, /用户新文案/);
    assert.match(latest.prompt, /标题字号更大/);
    assert.match(latest.prompt, new RegExp(`第 ${layout.modules.length}/${layout.modules.length} 张`));
  });
}

test('fixed layouts reject missing, duplicate, foreign modules and wrong layout IDs', () => {
  const context = { layoutId: DEFAULT_DETAIL_LAYOUT, identity: [{ id: 'in1' }], productName: '测试' };
  for (const mutate of [
    (x) => x.detail_layout_brief.modules.pop(),
    (x) => { x.detail_layout_brief.modules[1] = x.detail_layout_brief.modules[0]; },
    (x) => { x.detail_layout_brief.modules[0].module_id = 'old_faq'; },
    (x) => { x.detail_layout_brief.layout_id = 'detail_evidence_chain_16'; },
    (x) => { x.detail_layout_brief.screen_count = 12; },
  ]) {
    const raw = fixedRaw(); mutate(raw);
    assert.throws(() => normalizeDetailPlan(raw, context), /详情规划|详情模块/);
  }
});

test('main layout rejects incomplete/duplicate/foreign modules and keeps source order and factual copy limits', () => {
  const context = { identity: [{ id: 'in1' }], productName: '精华', docText: DOC };
  for (const mutate of [
    (x) => x.main_layout_brief.modules.pop(),
    (x) => { x.main_layout_brief.modules[1] = x.main_layout_brief.modules[0]; },
    (x) => { x.main_layout_brief.modules[0].module_id = 'main_mechanism'; },
    (x) => { x.main_layout_brief.screen_count = 4; },
  ]) {
    const raw = fixedRaw(); mutate(raw);
    assert.throws(() => normalizeMainPlan(raw, context), /主图规划|主图模块/);
  }
  const raw = fixedRaw();
  raw.main_layout_brief.modules.find((m) => m.module_id === 'main_effect').copy = ['提亮99%', '售价128元', '数据待确认', '30ml', '补水'];
  const plan = normalizeMainPlan(raw, context);
  assert.deepEqual(plan.slots.map((s) => s.moduleId), MAIN_LAYOUT.modules);
  assert.equal(plan.slots[0].headline, '');
  assert.deepEqual(plan.slots[0].copy, []);
  assert.deepEqual(plan.slots[2].copy, ['烟酰胺', '透明质酸']);
  assert.deepEqual(plan.slots[3].copy, ['30ml']);
});

test('main structure stays at five images when no layout references are available', async (t) => {
  const { project, identity } = await fixture();
  const catalog = structuredClone(await loadCommerceCatalog());
  for (const product of catalog.products) { product.main = []; product.detail = []; }
  const root = path.join(temp, 'empty-layout-library');
  await fs.mkdir(path.join(root, 'agent-library'), { recursive: true });
  await fs.writeFile(path.join(root, 'agent-library/catalog.json'), JSON.stringify(catalog));
  const oldRoot = process.env.ECOMMERCE_LIBRARY_ROOT;
  process.env.ECOMMERCE_LIBRARY_ROOT = root;
  withNetwork(t, { jev: defaultJev, llm: defaultLlm });
  try {
    const plan = await planCommerce({ project, scope: 'main', identity });
    assert.deepEqual(plan.slots.map((s) => s.moduleId), MAIN_LAYOUT.modules);
    assert.ok(plan.slots.every((s) => s.reference === null));
    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.anchor, 'main_02');
    assert.deepEqual(plan.mainBrief.missingEvidence, ['缺少真实效果数据']);
    assert.equal(plan.promptSource.revision, MAIN_PROMPTS.source.revision);
  } finally {
    if (oldRoot === undefined) delete process.env.ECOMMERCE_LIBRARY_ROOT;
    else process.env.ECOMMERCE_LIBRARY_ROOT = oldRoot;
  }
});

test('fixed detail modules exclude invented numbers, prices and missing-evidence notes from printable copy', () => {
  const raw = fixedRaw();
  raw.detail_layout_brief.modules[0].headline = '提亮99%';
  raw.detail_layout_brief.modules[0].copy = ['测试数据待确认', '售价128元', '提亮99%', '30ml', '补水护理'];
  raw.product_info.effect_claims = [{ claim: '提亮', value: '99%', source_type: 'test' }];
  const plan = normalizeDetailPlan(raw, { layoutId: DEFAULT_DETAIL_LAYOUT, identity: [{ id: 'in1' }], productName: '测试', docText: '测试精华，30ml，补水护理' });
  assert.doesNotMatch(plan.slots[0].headline, /99/);
  assert.deepEqual(plan.slots[0].copy, ['30ml', '补水护理']);
  assert.deepEqual(plan.productInfo.effect_claims, []);
});

test('comparison rendering must not override confirmed copy with invented generic competitor weaknesses', () => {
  for (const layout of DETAIL_LAYOUTS) {
    const plan = { ...normalizeDetailPlan(fixedRaw(layout.id), { layoutId: layout.id, identity: [{ id: 'in1' }], productName: '精华' }), system: { style: [] } };
    const slot = plan.slots.find((s) => s.moduleId.includes('competitor_comparison'));
    slot.headline = '本品配方信息';
    slot.copy = ['烟酰胺：提亮肤色', '透明质酸：补水'];
    const prompt = buildCommercePrompt({ project: { brief, commerce: { plan } }, slot, identity: [{ label: '产品正面' }], refCount: 0, anchor: false });
    assert.doesNotMatch(prompt, /普通同类产品的常见痛点或不足|左侧视觉偏灰、暗|左侧呈现普通同类产品常见不足|承接普通同类产品的负面体验/);
    assert.match(prompt, /没有已确认的对方资料时，只呈现本品已知信息/);
    assert.match(prompt, /本品配方信息/);
    assert.match(prompt, /透明质酸：补水/);
  }
});

test('source prompts retain distinct product visibility, ingredient mechanism/proof and parameter text rules', () => {
  const prompt = (id) => DETAIL_PROMPTS.modules[id].prompt.join('\n');
  assert.match(prompt('hero'), /产品作为主视觉，占画面 35%-50%/);
  for (const id of ['brand_qualification', 'research_strength', 'pain_scene', 'product_info']) assert.match(prompt(id), /产品露出策略：不要出现产品瓶身/);
  assert.match(prompt('detail_ec_ingredient_1_mechanism'), /一张图只讲一个成分/);
  assert.match(prompt('detail_ec_ingredient_1_proof'), /不重复上一屏的机制解释/);
  assert.match(prompt('detail_ec_auxiliary_validation'), /不重复主效果对比页/);
  assert.match(prompt('product_info'), /产品介绍页允许生成清晰中文信息表/);
  assert.match(prompt('detail_ec_usage'), /3-4 步/);
  assert.doesNotMatch(prompt('effect_comparison'), /必须显示百分比|必须使用具体示意百分比/);
});

test('legacy adaptive detail plans are viewable data but cannot silently use the new prompt', () => {
  assert.throws(() => buildCommercePrompt({ project: { commerce: { plan: {} } }, slot: { kind: 'detail', role: 'hero' }, identity: [], refCount: 0 }), /旧结构/);
});

test('HTTP selection, validation, retry persistence, brief edits and ZIP export use the selected structure', async (t) => {
  const port = 41000 + Math.floor(Math.random() * 800);
  process.env.PORT = String(port);
  const calls = withNetwork(t, { jev: defaultJev, llm: defaultLlm });
  const { server } = await import('../server.js');
  t.after(() => { server.close(); server.closeAllConnections?.(); });
  const { project, identity } = await fixture();
  const base = `http://127.0.0.1:${port}/api/projects/${project.id}`;
  const request = async (suffix, options) => {
    const response = await fetch(base + suffix, options);
    return { status: response.status, data: await response.json() };
  };
  const form = (layout, reuse = false) => {
    const body = new FormData(); body.set('scope', 'detail');
    body.set('detailLayoutId', layout); body.set('views', '["outer_front"]');
    if (reuse) body.set('reuse', '1');
    return body;
  };
  const invalid = await request('/commerce', { method: 'POST', body: form('adaptive_12') });
  assert.equal(invalid.status, 400);
  assert.equal((await getProject(project.id)).commerce, undefined);
  const layoutId = 'detail_evidence_chain_16';
  const created = await request('/commerce', { method: 'POST', body: form(layoutId) });
  assert.equal(created.status, 200);
  assert.equal(created.data.commerce.detailLayoutId, layoutId);
  for (let i = 0; i < 150 && ['planning', 'rendering'].includes((await getProject(project.id)).commerce.status); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  const done = await getProject(project.id);
  assert.equal(done.commerce.status, 'done', done.commerce.error);
  assert.equal(done.commerce.plan.slots.length, 16);
  assert.equal(calls.fal.length, 16);
  const saved = await request('/commerce/plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: done.commerce.rev, slots: { detail_16: { headline: '正确使用', copy: ['取适量', '均匀涂抹'] } } }) });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.commerce.plan.slots.at(-1).headline, '正确使用');
  // ZIP's general packaging brief expects complete packaging faces.
  await updateProject(project.id, (p) => { p.brief = null; });
  const response = await fetch(base + '/zip');
  assert.equal(response.status, 200);
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const description = await zip.file('电商图方案.md').async('string');
  assert.match(description, /证据链长图结构 · 16 屏/);
  assert.match(description, /正确使用/);
  assert.equal(Object.keys(zip.files).filter((name) => name.startsWith('电商图/详情图/') && name.endsWith('.png')).length, 16);
  const stored = JSON.parse(await fs.readFile(path.join(temp, 'data/projects', project.id, 'project.json'), 'utf8'));
  assert.equal(stored.commerce.detailLayoutId, layoutId);

  const ten = normalizeDetailPlan(fixedRaw(), { layoutId: DEFAULT_DETAIL_LAYOUT, identity, productName: '测试' });
  await updateProject(project.id, (p) => { p.commerce.plan = { ...p.commerce.plan, ...ten }; });
  const copy = ['名称', '规格', '成分', '功效', '注意事项', '使用说明'];
  const edited = await request('/commerce/plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: stored.commerce.rev, slots: { detail_10: { copy } } }) });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.data.commerce.plan.slots.at(-1).copy, copy, 'parameter sheet must retain more than four rows');

  const origin = `http://127.0.0.1:${port}`;
  const directForm = (layout = DEFAULT_DETAIL_LAYOUT, text = '', scope = 'detail') => {
    const body = new FormData();
    body.set('scope', scope);
    body.set('detailLayoutId', layout);
    if (text) body.set('text', text);
    body.append('images', new Blob([png], { type: 'image/png' }), 'product.png');
    return body;
  };
  const directRequest = async (body) => {
    const response = await fetch(`${origin}/api/commerce-projects`, { method: 'POST', body });
    return { status: response.status, data: await response.json() };
  };
  const waitForCommerce = async (id) => {
    for (let i = 0; i < 200 && ['planning', 'rendering'].includes((await getProject(id)).commerce.status); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    const done = await getProject(id);
    assert.equal(done.commerce.status, 'done', done.commerce.error);
    return done;
  };
  await t.test('direct entry rejects missing images, invalid content and unknown layouts before creating a project', async () => {
    assert.equal((await directRequest(new FormData())).status, 400);
    assert.equal((await directRequest(directForm('adaptive_12'))).status, 400);
    assert.equal((await directRequest(directForm(DEFAULT_DETAIL_LAYOUT, '', ''))).status, 400);
    assert.equal((await directRequest(directForm(DEFAULT_DETAIL_LAYOUT, '', 'unknown'))).status, 400);
    const invalid = new FormData();
    invalid.append('images', new Blob(['bad'], { type: 'image/png' }), 'bad.png');
    assert.equal((await directRequest(invalid)).status, 400);
    const tooMany = directForm();
    for (let i = 0; i < 4; i++) tooMany.append('images', new Blob([png], { type: 'image/png' }), `${i}.png`);
    assert.equal((await directRequest(tooMany)).status, 400);
  });

  await t.test('invalid product documents fail before creating a project or replacing existing material', async () => {
    const before = await (await fetch(`${origin}/api/projects`)).json();
    for (const [filename, content] of [['bad.pdf', 'not a PDF'], ['empty.md', '  '], ['bad.docx', 'not a ZIP'], ['unknown.zip', 'binary']]) {
      const body = directForm(DEFAULT_DETAIL_LAYOUT, '', 'main');
      body.append('doc', new Blob([content]), filename);
      const response = await directRequest(body);
      assert.equal(response.status, 400, filename);
      assert.match(response.data.error, /无法读取/);
    }
    const two = directForm(DEFAULT_DETAIL_LAYOUT, '', 'main');
    two.append('doc', new Blob(['one']), 'one.md'); two.append('doc', new Blob(['two']), 'two.md');
    assert.equal((await directRequest(two)).status, 400);
    const after = await (await fetch(`${origin}/api/projects`)).json();
    assert.equal(after.length, before.length);
    const retry = form(layoutId, true);
    retry.delete('reuse');
    retry.append('doc', new Blob(['bad']), 'broken.pdf');
    const p = await createProject({ kind: 'commerce', source: { name: '原项目', excerpt: '原资料' }, commerce: { status: 'done' }, images: {}, refs: [] });
    const response = await fetch(`${origin}/api/projects/${p.id}/commerce`, { method: 'POST', body: retry });
    assert.equal(response.status, 400);
    assert.equal((await getProject(p.id)).source.excerpt, '原资料');
    assert.equal((await getProject(p.id)).commerce.status, 'done');
  });

  for (const ext of ['pdf', 'docx', 'pptx', 'md']) {
    await t.test(`${ext} product introduction reaches identification/planning and survives save, reuse, replacement and removal`, async () => {
      const marker = ext === 'pdf' ? 'DOCUMENT_ONLY: fragrance free serum 30ml' : `文档独有卖点：${ext} 配方温和，净含量30ml`;
      const body = directForm(DEFAULT_DETAIL_LAYOUT, '用户补充：适合夜间护理', 'main');
      body.append('doc', new Blob([await productDocument(ext, marker)]), `产品资料.${ext}`);
      if (ext === 'md') for (let i = 0; i < 3; i++) body.append('images', new Blob([png], { type: 'image/png' }), `product-${i}.png`);
      const previousLlm = calls.llm.length;
      const created = await directRequest(body);
      assert.equal(created.status, 200, created.data.error);
      const id = created.data.id;
      let done = await waitForCommerce(id);
      assert.equal(done.source.introText, '用户补充：适合夜间护理');
      assert.equal(done.source.document.name, `产品资料.${ext}`);
      assert.ok(done.source.document.text.includes(marker));
      assert.ok(done.source.excerpt.includes(marker));
      assert.ok(done.source.excerpt.indexOf('用户补充') < done.source.excerpt.indexOf(marker));
      assert.ok(calls.llm[previousLlm].messages.at(-1).content[0].text.includes(marker));
      assert.match(calls.llm[previousLlm].messages[0].content, /补充说明与产品文档或图片冲突时，以补充说明为准/);
      assert.ok(calls.llm[previousLlm + 1].messages.at(-1).content.includes(marker));
      assert.match(calls.llm[previousLlm + 1].messages[0].content, /补充说明优先/);
      assert.ok(done.docText.includes(marker));
      const stored = JSON.parse(await fs.readFile(path.join(temp, 'data/projects', id, 'project.json'), 'utf8'));
      assert.deepEqual(stored.source.document, done.source.document);
      const restored = await (await fetch(`${origin}/api/projects/${id}`)).json();
      assert.equal(restored.source.document.name, `产品资料.${ext}`);
      if (ext !== 'md') return;

      const requestAgain = async (form) => {
        const response = await fetch(`${origin}/api/projects/${id}/commerce`, { method: 'POST', body: form });
        assert.equal(response.status, 200, (await response.json()).error);
        return waitForCommerce(id);
      };
      const reuse = new FormData(); reuse.set('reuse', '1');
      done = await requestAgain(reuse);
      assert.ok(done.source.document.text.includes(marker));
      assert.ok(done.docText.includes(marker));
      const keep = directForm(DEFAULT_DETAIL_LAYOUT, '更新的补充说明', 'main'); keep.set('reuseDocument', '1');
      done = await requestAgain(keep);
      assert.equal(done.source.introText, '更新的补充说明');
      assert.ok(done.source.excerpt.includes(marker));
      const replace = directForm(DEFAULT_DETAIL_LAYOUT, '', 'main'); replace.append('doc', new Blob(['替换文档独有内容']), '新资料.txt');
      done = await requestAgain(replace);
      assert.equal(done.source.document.name, '新资料.txt');
      assert.ok(done.source.excerpt.includes('替换文档独有内容'));
      assert.ok(!done.source.excerpt.includes(marker));
      done = await requestAgain(directForm(DEFAULT_DETAIL_LAYOUT, '仅保留文字', 'main'));
      assert.equal(done.source.document, null);
      assert.equal(done.source.excerpt, '仅保留文字');
      assert.ok(!done.docText.includes('替换文档独有内容'));
    });
  }

  for (const layout of DETAIL_LAYOUTS) {
    await t.test(`direct product upload generates ${layout.modules.length} detail screens without a packaging brief`, async () => {
      const previousFal = calls.fal.length;
      const previousLlm = calls.llm.length;
      const text = layout.modules.length === 16 ? '补充：净含量30ml' : '';
      const created = await directRequest(directForm(layout.id, text));
      assert.equal(created.status, 200, created.data.error);
      const id = created.data.id;
      assert.equal(created.data.kind, 'commerce');
      assert.equal(created.data.brief, null);
      assert.equal(created.data.commerce.scope, 'detail');
      for (let i = 0; i < 150 && ['planning', 'rendering'].includes((await getProject(id)).commerce.status); i++) await new Promise((resolve) => setTimeout(resolve, 100));
      const done = await getProject(id);
      assert.equal(done.commerce.status, 'done', done.commerce.error);
      assert.equal(done.commerce.plan.slots.length, layout.modules.length);
      assert.equal(calls.fal.length - previousFal, layout.modules.length);
      assert.deepEqual(done.images, {});
      assert.equal(done.brief, null);
      assert.equal(done.source.name, '焕采精华液');
      assert.equal(done.source.excerpt, text);
      assert.ok(done.docText.includes(DOC));
      const reading = calls.llm[previousLlm].messages.at(-1).content;
      assert.equal(reading[0].type, 'text');
      assert.equal(reading[1].type, 'image_url');
      assert.ok(reading[1].image_url.url.startsWith('data:image/png;base64,'));
      assert.ok(calls.llm[previousLlm + 1].messages.at(-1).content.includes(DOC), 'planning must receive information extracted from the image');
      const stored = JSON.parse(await fs.readFile(path.join(temp, 'data/projects', id, 'project.json'), 'utf8'));
      assert.equal(stored.commerce.detailLayoutId, layout.id);
      const listing = await (await fetch(`${origin}/api/projects`)).json();
      const summary = listing.find((p) => p.id === id);
      assert.equal(summary.doneCount, layout.modules.length);
      assert.equal(summary.name, '焕采精华液');
      assert.ok(summary.cover);
      const restored = await (await fetch(`${origin}/api/projects/${id}`)).json();
      assert.equal(restored.kind, 'commerce');
      assert.equal(restored.commerce.inputs[0].source, 'upload');
      const downloaded = await fetch(`${origin}/api/projects/${id}/zip`);
      assert.equal(downloaded.status, 200);
      const zip = await JSZip.loadAsync(await downloaded.arrayBuffer());
      assert.ok(zip.file('电商图方案.md'));
      assert.equal(Object.keys(zip.files).filter((name) => name.endsWith('.png')).length, layout.modules.length);
      assert.equal(zip.file('设计简报.md'), null);

      const retry = new FormData(); retry.set('reuse', '1');
      const retried = await fetch(`${origin}/api/projects/${id}/commerce`, { method: 'POST', body: retry });
      assert.equal(retried.status, 200);
      for (let i = 0; i < 150 && ['planning', 'rendering'].includes((await getProject(id)).commerce.status); i++) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await getProject(id)).commerce.status, 'done');
      assert.equal((await getProject(id)).commerce.detailLayoutId, layout.id);
    });
  }
  for (const scope of ['main', 'both']) {
    await t.test(`direct product upload respects ${scope} selection and persists only the selected image types`, async () => {
      const previousFal = calls.fal.length;
      const created = await directRequest(directForm(DEFAULT_DETAIL_LAYOUT, '', scope));
      assert.equal(created.status, 200, created.data.error);
      const id = created.data.id;
      assert.equal(created.data.commerce.scope, scope);
      for (let i = 0; i < 150 && ['planning', 'rendering'].includes((await getProject(id)).commerce.status); i++) await new Promise((resolve) => setTimeout(resolve, 100));
      const done = await getProject(id);
      assert.equal(done.commerce.status, 'done', done.commerce.error);
      const main = done.commerce.plan.slots.filter((s) => s.kind === 'main');
      const detail = done.commerce.plan.slots.filter((s) => s.kind === 'detail');
      assert.deepEqual(main.map((s) => s.moduleId), MAIN_LAYOUT.modules);
      assert.equal(done.commerce.plan.anchor, 'main_02');
      assert.equal(detail.length, scope === 'both' ? 10 : 0);
      assert.equal(calls.fal.length - previousFal, main.length + detail.length);
      const stored = JSON.parse(await fs.readFile(path.join(temp, 'data/projects', id, 'project.json'), 'utf8'));
      assert.equal(stored.commerce.scope, scope);
      assert.deepEqual(stored.commerce.plan.mainLayout, { id: MAIN_LAYOUT.id, name: MAIN_LAYOUT.name, screenCount: 5 });
      const response = await fetch(`${origin}/api/projects/${id}/zip`);
      assert.equal(response.status, 200);
      const zip = await JSZip.loadAsync(await response.arrayBuffer());
      const files = Object.keys(zip.files).filter((name) => name.endsWith('.png'));
      assert.equal(files.filter((name) => name.startsWith('电商图/主图/')).length, main.length);
      assert.equal(files.filter((name) => name.startsWith('电商图/详情图/')).length, detail.length);
      const markdown = await zip.file('电商图方案.md').async('string');
      assert.match(markdown, /主图结构：标准主图结构 · 5 张/);
      assert.match(markdown, /白底图 → 首图 → 次图-成分 → 次图-效果 → 次图-使用场景/);
      assert.match(markdown, /42e2de6502ab9bbe40c806237f96735019318239/);
      const editResponse = await fetch(`${origin}/api/projects/${id}/commerce/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: done.commerce.rev, slots: { main_01: { headline: '禁止新增标题', copy: ['禁止新增标签'] }, main_02: { copy: ['甲', '乙', '丙'] } } }) });
      assert.equal(editResponse.status, 200);
      const edited = await editResponse.json();
      assert.equal(edited.commerce.plan.slots[0].headline, '');
      assert.deepEqual(edited.commerce.plan.slots[0].copy, []);
      assert.deepEqual(edited.commerce.plan.slots[1].copy, ['甲', '乙']);
    });
  }
});


test('the library exposes only screens that may ever be generated, and each product family keeps its own layouts first', async () => {
  const catalog = await loadCommerceCatalog();
  const rows = eligibleScreens(catalog);
  assert.ok(rows.length > 100);
  assert.ok(rows.every((r) => r.screen.eligibility !== 'excluded'));
  assert.ok(!rows.some((r) => ['promo', 'brand', 'proof', 'footnote'].includes(r.screen.role)));
  const shortlist = shortlistSystems(catalog.products, '美白精华 30ml 泵瓶', { category: '精华', form: '细长泵瓶' });
  assert.equal(shortlist.length, 5);
  assert.equal(shortlist[0].category, '精华');
  const system = shortlist[0];
  const cands = candidatesFor({ rows, system, shortlist, kind: 'main', role: 'hero' });
  assert.ok(cands.length && cands[0].product.id === system.id && cands[0].kind === 'main');
  assert.ok(cands.every((c) => c.screen.role === 'hero'));
});

test('a redraw carries the user note, keeps versions, and refuses a changed library snapshot', async (t) => {
  const { project, identity } = await fixture();
  const calls = withNetwork(t, { jev: defaultJev, llm: defaultLlm });
  await updateProject(project.id, (p) => { p.commerce = { status: 'planning', scope: 'main', inputs: identity, plan: null, images: {}, rev: 0 }; });
  await runCommerce(project.id, { scope: 'main', identity });
  const done = await getProject(project.id);
  assert.equal(done.commerce.status, 'done', done.commerce.error);
  assert.equal(calls.fal.length, 5);
  for (const [index, slot] of done.commerce.plan.slots.entries()) {
    const image = done.commerce.images[slot.id];
    assert.equal(image.status, 'done', image.error);
    const body = calls.fal.find((b) => b.prompt.includes(`- 当前模块：${slot.roleLabel}\n`));
    assert.ok(body, slot.moduleId);
    assert.equal(body.image_size, 'square_hd');
    assert.match(body.prompt, new RegExp(`第 ${index + 1}/5 张`));
    assert.doesNotMatch(body.prompt, /\{\{|必须使用具体示意百分比|SCREEN:|Page task:/);
    assert.equal(body.image_urls.length, slot.identityInputs.length + (slot.reference?.assets.length || 0) + (index > 1 ? 1 : 0));
    if (index === 0) {
      assert.equal(slot.reference, null);
      assert.match(body.prompt, /只删除原背景并替换为纯白色/);
      assert.doesNotMatch(body.prompt, /统一视觉风格|本套首图|参考库对标/);
    } else {
      assert.match(body.prompt, /【店铺主图点击率策略】/);
      assert.match(body.prompt, /【主图\/活动图元素预算约束】/);
      assert.match(body.prompt, /【当前屏专属信息】/);
    }
  }
  assert.match(done.commerce.images.main_03.prompt, /左右分栏/);
  assert.match(done.commerce.images.main_04.prompt, /上下分区/);
  assert.match(done.commerce.images.main_05.prompt, /场景化全幅构图/);
  await updateProject(project.id, (p) => { p.commerce.plan.slots[1].headline = '用户修改标题'; p.commerce.plan.slots[1].copy = ['用户新文案']; });
  const before = calls.fal.length;
  await runCommerceSlot(project.id, 'main_02', { extra: '背景换成更浅的银灰' });
  const img = (await getProject(project.id)).commerce.images.main_02;
  assert.equal(calls.fal.length, before + 1);
  assert.match(calls.fal.at(-1).prompt, /【用户本次重绘要求】\n背景换成更浅的银灰/);
  assert.match(img.prompt, /用户修改标题/);
  assert.match(img.prompt, /用户新文案/);
  assert.match(img.prompt, /第 2\/5 张/);
  assert.equal(img.versions.length, 2);
  assert.equal(img.extra, '背景换成更浅的银灰');

  const changed = await getProject(project.id);
  changed.commerce.plan.slots[1].reference.assets[0].sha256 = 'changed';
  await assert.rejects(buildCommerceInput(changed, 'main_02'), /参考图已变更/);
  await assert.rejects(buildCommerceInput(changed, 'main_99'), /不在当前方案/);
  changed.commerce.inputs = [];
  await assert.rejects(buildCommerceInput(changed, 'main_01'), /产品图已缺失/);
});
