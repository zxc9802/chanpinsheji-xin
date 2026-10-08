import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blankCanvasDataUri } from '../lib/fal.js';

// 生成的项目数据放在临时目录里，不碰用户真实的项目
const originalCwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-claude-test-'));
process.chdir(temp);
const { createProject, getProject, updateProject, saveFile } = await import('../lib/store.js');
const { runCommerce } = await import('../lib/commerce-render.js');
const { normalizeClaudePlan, auditCopy, unsupportedClaims, dropViolations } = await import('../lib/commerce-claude.js');
after(async () => { process.chdir(originalCwd); await fs.rm(temp, { recursive: true, force: true }); });

const DOC = '焕采精华液，30ml，细长按压泵瓶。核心成分：烟酰胺、透明质酸。适合肤色暗沉、缺水的人群。使用方法：洁面后取2泵，均匀涂抹全脸，轻拍至吸收。资料没有提供敏感肌测试与临床数据。';
const brief = {
  product: { brand: '测试品牌', name: '焕采精华液', category: '精华' },
  design: { palette: [{ name: '银白', hex: '#E9E9E8' }] }, outer: { structure: '单品折叠盒' }, inner: { unit: '30ml 精华泵瓶' },
};
const png = Buffer.from(blankCanvasDataUri().split(',')[1], 'base64');
const realFetch = globalThis.fetch;

const zone = (kind, label, x, y, w, h, fill = '#22433A') => ({ kind, label, x, y, w, h, fill });
const screen = (name, extra = {}) => ({
  name, job: `${name}的任务`, copy: { headline: `${name}标题`, subline: '细长泵瓶', points: [], tags: [] },
  visual: `${name}的画面，产品居中`, light: '柔光', layout: '产品居中，标题在上', product_share: '40%', tone: 'light',
  colors: [{ hex: '#f3f6ef', use: '底色', share: 3 }, { hex: '#22433A', use: '标题', share: 1 }],
  zones: [zone('texture', '背景', 0, 0, 100, 100, '#F3F6EF'), zone('product', '精华瓶', 30, 30, 40, 50), zone('headline', `${name}标题`, 10, 5, 80, 10)],
  transition: '和上一屏拉开', avoid: ['不要堆图标'], ...extra,
});
const rawPlan = () => ({
  strategy: { positioning: '补水焕采精华', core_message: '补水焕采', selling_points: [{ point: '烟酰胺', source: '核心成分：烟酰胺', where: '主图2' }], tone: '银白清透', do_not: ['不写百分比'] },
  palette: [{ name: '银白', hex: '#E9E9E8', role: '场色', from: '瓶身' }, { name: '墨绿', hex: '#22433A', role: '文字', from: '标签' }],
  typography: [{ level: '主标题', font: '思源黑体 Bold', size_main: '60px', size_detail: '52px', note: '' }],
  rhythm: '浅-深-浅',
  main_images: [
    screen('首图', { role: 'hero', tone: 'dark', copy: { headline: '补水焕采', tags: ['敏感肌可用', '30ml'] } }),
    screen('成分图', { role: 'ingredient', visual: '烟酰胺卡片，旁边放礼盒' }),
    screen('质地图', { role: 'texture' }),
    screen('场景图', { role: 'scene' }),
    { role: 'white', name: '白底图', copy: { headline: '不该出现' } },
  ],
  detail_screens: [
    screen('详情首图', { replaces: '详情首图' }),
    screen('成分', { copy: { headline: '烟酰胺', points: ['温和不刺激'] } }),
    screen('用法', { copy: { headline: '三步用好', points: ['步骤1 洁面后取2泵', '步骤2 均匀涂抹全脸', '步骤3 轻拍至吸收'] } }),
    screen('质地'), screen('人群'), screen('产品信息'),
  ],
  skipped: [{ screen: '效果对比', missing: '没有实测数据', if_available: '做成对比屏' }],
  materials: [{ item: '瓶身实拍', for: '主图1', how: '实拍' }],
});

test('negated sentences in the document never count as support for a claim', () => {
  assert.deepEqual(unsupportedClaims('敏感肌可用', DOC), ['敏感肌', '敏感']);
  assert.deepEqual(unsupportedClaims('轻拍至吸收', DOC), []);
});

test('the plan keeps 5 main images with exactly one white shot and 6-12 detail screens', () => {
  const identity = [{ id: 'in1' }, { id: 'in2' }];
  const plan = normalizeClaudePlan(rawPlan(), { kinds: ['main', 'detail'], identity });
  assert.deepEqual(plan.slots.map((s) => s.id).slice(0, 6), ['main_01', 'main_02', 'main_03', 'main_04', 'main_05', 'detail_01']);
  const white = plan.slots[4];
  assert.equal(white.role, 'white');
  assert.equal(white.headline, '');
  assert.deepEqual(white.copy, []);
  assert.deepEqual(white.identityInputs, ['in1']);
  assert.deepEqual(plan.slots[0].design.colors.map((c) => c.share), [75, 25], 'shares are normalised to 100');
  assert.equal(plan.slots[0].design.colors[0].hex, '#F3F6EF');
  assert.equal(plan.skipped[0].label, '效果对比');
  const broken = rawPlan();
  broken.main_images[4].role = 'hero';
  assert.throws(() => normalizeClaudePlan(broken, { kinds: ['main'], identity }), /白底图/);
  const short = rawPlan();
  short.detail_screens.length = 3;
  assert.throws(() => normalizeClaudePlan(short, { kinds: ['detail'], identity }), /6–12/);
  const clamped = rawPlan();
  clamped.main_images[0].zones = [zone('product', '越界', 90, 95, 50, 50), zone('unknown', 'x', 0, 0, 1, 1)];
  const z = normalizeClaudePlan(clamped, { kinds: ['main'], identity }).slots[0].design.zones;
  assert.deepEqual(z.map((x) => [x.x, x.y, x.w, x.h]), [[90, 95, 10, 5]]);
});

test('the audit covers printed copy, picture descriptions and zone labels; step numbers are not data', () => {
  const plan = normalizeClaudePlan(rawPlan(), { kinds: ['main', 'detail'], identity: [{ id: 'in1' }] });
  const flagged = auditCopy(plan, DOC).map((v) => v.id);
  assert.ok(flagged.includes('main_01:c0'), '敏感肌可用');
  assert.ok(flagged.includes('main_02:v'), '礼盒 in the picture description');
  assert.ok(flagged.includes('detail_02:c0'), '温和不刺激');
  assert.ok(!flagged.some((id) => id.startsWith('detail_03:c')), 'step numbering and doc-backed wording pass');
  dropViolations(plan, DOC);
  assert.ok(!plan.slots[0].copy.includes('敏感肌可用'));
  assert.doesNotMatch(plan.slots[1].visual, /礼盒/);
  assert.equal(auditCopy(plan, DOC).length, 0);
});

// Claude 的规划走流式（SSE），文案自检走普通 JSON：两种返回格式都要能读
const sse = (text) => {
  const parts = text.match(/[\s\S]{1,400}/g).map((chunk) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } })}\n\n`);
  const body = [`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: {} } })}\n\n`, ...parts, `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
};

function withNetwork(t, { plan = rawPlan(), fixes = (ids) => ids.map((id) => ({ id, text: id.endsWith(':v') ? '烟酰胺卡片，产品在右侧' : '补水护理' })) } = {}) {
  const saved = Object.fromEntries(['JEV_API_KEY', 'LLM_API_KEY', 'FAL_KEY', 'CLAUDE_PLAN_KEY'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { JEV_API_KEY: 'test', LLM_API_KEY: 'test', FAL_KEY: 'test', CLAUDE_PLAN_KEY: 'test-claude' });
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const calls = { claude: [], identify: [], fal: [], other: [] };
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1:')) return realFetch(url, init);
    if (u.includes('chat/completions')) {
      const body = JSON.parse(init.body);
      if (body.messages[0].content.includes('识别用户上传的同一件产品')) {
        calls.identify.push(body);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ name: '焕采精华液', description: DOC, visual: { palette: [{ name: '银白', hex: '#E9E9E8', role: '瓶身' }], container: '细长按压泵瓶' } }) } }] });
      }
    }
    if (u.endsWith('/v1/messages')) {
      const body = JSON.parse(init.body);
      calls.claude.push({ body, headers: init.headers });
      const content = body.messages[0].content;
      if (Array.isArray(content)) return sse(JSON.stringify(plan));
      const ids = [...content.matchAll(/id=([^｜\s]+)｜/g)].map((m) => m[1]);
      return Response.json({ content: [{ type: 'text', text: JSON.stringify({ fixes: fixes(ids) }) }] });
    }
    if (u.startsWith('https://queue.fal.run/')) { const body = JSON.parse(init.body); calls.fal.push(body); return Response.json({ status_url: `https://stub.invalid/status/${calls.fal.length}`, response_url: `https://stub.invalid/result/${calls.fal.length}` }); }
    if (u.startsWith('https://stub.invalid/status/')) return Response.json({ status: 'COMPLETED' });
    if (u.startsWith('https://stub.invalid/result/')) return Response.json({ images: [{ url: `https://stub.invalid/image-${u.split('/').pop()}.png` }] });
    if (u.startsWith('https://stub.invalid/image-')) return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    calls.other.push(u);
    throw new Error(`Unexpected network call: ${u}`);
  });
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  return calls;
}

async function fixture() {
  const project = await createProject({ brief: structuredClone(brief), docText: DOC, refs: [], images: {}, options: { quality: 'medium' } });
  const front = await saveFile(project.id, 'images', 'front.png', png);
  await updateProject(project.id, (p) => { p.images.outer_front = { status: 'done', file: front }; });
  return { project: await getProject(project.id), identity: [{ id: 'in1', source: 'generated', view: 'outer_front', label: '外包装 · 正视图', file: front }] };
}

test('Claude mode plans, rewrites unsupported copy, and renders every screen from its own colour structure without the library', async (t) => {
  const { project, identity } = await fixture();
  const calls = withNetwork(t);
  await updateProject(project.id, (p) => { p.commerce = { status: 'planning', scope: 'both', mode: 'claude', inputs: identity, rev: 0, images: {} }; });
  await runCommerce(project.id, { scope: 'both', identity });
  const done = (await getProject(project.id)).commerce;
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.plan.mode, 'claude');
  assert.equal(done.plan.slots.length, 11);
  assert.equal(calls.other.length, 0, 'no JEV or chat-completions calls in Claude mode');
  assert.equal(calls.claude.length, 2, 'one plan + one copy check');
  const planCall = calls.claude[0];
  assert.equal(planCall.body.model, 'claude-opus-5-5');
  assert.equal(planCall.headers['x-api-key'], 'test-claude');
  assert.equal(planCall.body.messages[0].content[0].type, 'image');
  assert.match(planCall.body.messages[0].content.at(-1).text, /焕采精华液/);
  assert.ok(done.plan.claude.audit.flagged >= 3);
  assert.ok(done.plan.slots[0].copy.includes('补水护理'), 'the rewritten tag replaces the unsupported one');
  assert.ok(!JSON.stringify(done.plan.slots).includes('敏感肌可用'));
  assert.equal(done.plan.anchor, 'main_01');

  assert.equal(calls.fal.length, 11);
  const hero = calls.fal.find((b) => b.prompt.includes('「首图」'));
  assert.match(hero.prompt, /【色彩结构】这是一张深色屏/);
  assert.match(hero.prompt, /#F3F6EF 约 75%：底色/);
  assert.match(hero.prompt, /主标题：「补水焕采」/);
  assert.doesNotMatch(hero.prompt, /DESIGN TEMPLATE|参考库对标|敏感肌可用/);
  assert.equal(hero.image_urls.length, 1);
  const white = calls.fal.find((b) => b.prompt.includes('白底主图'));
  assert.doesNotMatch(white.prompt, /不该出现|【图上文字】/);
  const detail = calls.fal.find((b) => b.prompt.includes('「用法」'));
  assert.deepEqual(detail.image_size, { width: 1152, height: 2048 });
  assert.match(detail.prompt, /步骤1 洁面后取2泵/);
  assert.match(detail.prompt, /【整套锚点】/);
  assert.equal(detail.image_urls.length, 2, 'product + set anchor, no library images');
  assert.doesNotMatch(detail.prompt, /主标题「/, 'text zones carry only positions, not stale wording');
});

test('HTTP: AI is the default for new uploads and legacy retries, needs its key, and preserves existing sets', async (t) => {
  const port = 42000 + Math.floor(Math.random() * 800);
  process.env.PORT = String(port);
  const calls = withNetwork(t);
  const { server } = await import('../server.js');
  t.after(() => { server.close(); server.closeAllConnections?.(); });
  const { project, identity } = await fixture();
  const base = `http://127.0.0.1:${port}/api/projects/${project.id}`;
  const request = async (suffix, options) => {
    const response = await fetch(base + suffix, options);
    return { status: response.status, data: await response.json() };
  };
  const form = (mode) => {
    const body = new FormData();
    body.set('scope', 'main');
    body.set('views', '["outer_front"]');
    if (mode) body.set('planMode', mode);
    return body;
  };
  const wait = async (id = project.id) => {
    for (let i = 0; i < 150 && ['planning', 'rendering'].includes((await getProject(id)).commerce.status); i++) await new Promise((r) => setTimeout(r, 100));
    return getProject(id);
  };

  delete process.env.CLAUDE_PLAN_KEY;
  const unavailable = await request('/commerce', { method: 'POST', body: form() });
  assert.equal(unavailable.status, 400);
  assert.match(unavailable.data.error, /未配置 AI 规划模型/);
  assert.equal((await request('/commerce', { method: 'POST', body: form('claude') })).status, 400);
  assert.equal((await request('/commerce', { method: 'POST', body: form('nonsense') })).status, 400);
  process.env.CLAUDE_PLAN_KEY = 'test-claude';

  // 先放一套参考库模式的结果，再用 Claude 规划开新一套
  await updateProject(project.id, (p) => {
    p.commerce = { status: 'done', mode: 'reference', scope: 'main', inputs: identity, rev: 3, images: { main_01: { status: 'done', file: identity[0].file } },
      plan: { system: { style: ['参考'] }, slots: [{ id: 'main_01', kind: 'main', role: 'hero', title: '首图', roleLabel: '首图', headline: '参考', copy: [], visual: '', identityInputs: ['in1'] }], facts: {}, skipped: [] } };
  });
  assert.equal((await request('/commerce', { method: 'POST', body: form() })).status, 200);
  let stored = await wait();
  assert.equal(stored.commerce.status, 'done', stored.commerce.error);
  assert.equal(stored.commerce.mode, 'claude');
  assert.equal(stored.commerceAlt.mode, 'reference');
  assert.equal(stored.commerceAlt.plan.slots[0].headline, '参考');
  assert.equal(calls.fal.length, 5);

  const switched = await request('/commerce/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(switched.status, 200);
  assert.equal(switched.data.commerce.mode, 'reference');
  assert.equal(switched.data.commerceAlt.mode, 'claude');
  assert.equal(switched.data.commerce.rev, 4, 'rev moves so open editors reload');

  const retry = new FormData();
  retry.set('reuse', '1');
  assert.equal((await request('/commerce', { method: 'POST', body: retry })).status, 200);
  stored = await wait();
  assert.equal(stored.commerce.status, 'done', stored.commerce.error);
  assert.equal(stored.commerce.mode, 'claude', 'retrying a reference set defaults to AI');
  assert.equal(stored.commerceAlt.mode, 'reference');

  // 同一模式重出只替换自己那套，另一套保留
  assert.equal((await request('/commerce', { method: 'POST', body: form('reference') })).status, 200);
  stored = await getProject(project.id);
  assert.equal(stored.commerceAlt.mode, 'claude');
  await wait();

  const upload = new FormData();
  upload.set('scope', 'main');
  upload.set('text', DOC);
  upload.append('images', new Blob([png], { type: 'image/png' }), 'product.png');
  const response = await fetch(`http://127.0.0.1:${port}/api/commerce-projects`, { method: 'POST', body: upload });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.commerce.mode, 'claude', 'new uploads default to AI without planMode');
  const generated = await wait(created.id);
  assert.equal(generated.commerce.status, 'done', generated.commerce.error);
  assert.equal(generated.commerce.plan.mode, 'claude');
  assert.equal(generated.commerce.plan.slots.length, 5);
  assert.equal(calls.identify.length, 1);
});
