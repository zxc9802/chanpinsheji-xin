// 平行出图的整条服务端流程：JEV 选方向 → 各写简报 → 并行出正视图 → 选定 → 补全其余视图
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blankCanvasDataUri } from '../lib/fal.js';

const originalCwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-directions-test-'));
process.chdir(temp);
const PORT = 39000 + Math.floor(Math.random() * 900);
Object.assign(process.env, {
  PORT: String(PORT), FAL_KEY: 'test', LLM_API_KEY: 'test', LLM_MODEL: 'test-model', JEV_API_KEY: 'test',
  LLM_BASE_URL: 'https://llm.invalid/v1/chat/completions', JEV_BASE_URL: 'https://jev.invalid/v1/systemone',
});
delete process.env.LLM_FALLBACK_MODEL;

const realFetch = globalThis.fetch;
const origin = `http://127.0.0.1:${PORT}`;
const { server } = await import('../server.js');
const { loadCatalog } = await import('../lib/references.js');
after(async () => {
  server.close();
  server.closeAllConnections?.();
  process.chdir(originalCwd);
  await fs.rm(temp, { recursive: true, force: true });
});

const face = { content: '主标题与规格分层', text: ['燕麦蛋白护发膜', '200g'], promptEn: 'clear product heading and a small net-content line' };
const briefFor = name => ({
  product: { brand: '测试品牌', name, nameEn: 'Oat Protein Hair Mask', category: '发膜', specs: [{ label: '净含量', value: '200g' }] },
  design: { palette: [{ name: '乳白', hex: '#EEEBDC' }], finishes: ['哑光'], motifs: '燕麦线描', typography: '层级清晰', materials: '建议PP', backdropEn: 'neutral studio' },
  outer: { structure: '单品折叠盒', dimensions: '90 × 90 × 70 mm', faces: { front: face, side: face, back: face } },
  inner: { structure: '广口矮罐', unit: '200g发膜罐', dimensions: 'Ø80 × 60 mm', faces: { front: face, side: face, back: face } },
  kv: { content: '纸盒与产品罐并排', sceneEn: 'new carton beside the jar' },
});

const { products } = await loadCatalog();
const brandOf = id => products.find(p => p.id === id).brand_id;
const png = Buffer.from(blankCanvasDataUri().split(',')[1], 'base64');
const nameOf = product => `方案·${product.id}`;

// 外部服务全部替换；只有发往本服务的请求走真实网络
const submissions = [];
let failNext = false;
let jevThird, failThirdBrief = false, failAllBriefs = false;
const briefCalls = new Set();
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith(origin)) return realFetch(url, init);
  if (url === 'https://jev.invalid/v1/systemone') {
    const { questions } = JSON.parse(init.body);
    const answers = {};
    for (const [id, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria);
      let probs, choice;
      if (id === 'reference') {
        const ids = keys.filter(k => k !== 'none');
        const distinct = [];
        for (const k of ids) if (!distinct.some(d => brandOf(d) === brandOf(k))) distinct.push(k);
        [choice] = distinct;
        jevThird = distinct[2];
        probs = { [distinct[0]]: .5, [distinct[1]]: .25, [distinct[2]]: .2, none: .05 };
      } else {
        choice = id === 'category' ? '发膜' : 'unknown';
        probs = Object.fromEntries(keys.map(k => [k, k === choice ? 1 : 0]));
      }
      answers[id] = { type: 'choice', choice, confidence: .85, probabilities: Object.fromEntries(keys.map(k => [k, probs[k] ?? 0])) };
    }
    return Response.json({ model: 'jev-1.13.0', answers });
  }
  if (url === 'https://llm.invalid/v1/chat/completions') {
    const { messages } = JSON.parse(init.body);
    const product = products.find(p => p.id === messages[1].content.match(/"primary":\{"id":"([^"]+)"/)?.[1]);
    assert.ok(product, 'the brief model must receive the design profile of its own direction');
    briefCalls.add(product.id);
    if (failAllBriefs || failThirdBrief && product.id === jevThird) return new Response('upstream error', { status: 500 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(briefFor(nameOf(product))) } }] });
  }
  if (url.startsWith('https://queue.fal.run/')) {
    const body = JSON.parse(init.body);
    submissions.push(body);
    if (failNext) {
      failNext = false;
      return new Response('bad request', { status: 400 });
    }
    return Response.json({ status_url: 'https://stub.invalid/status', response_url: 'https://stub.invalid/result' });
  }
  if (url === 'https://stub.invalid/status') return Response.json({ status: 'COMPLETED' });
  if (url === 'https://stub.invalid/result') return Response.json({ images: [{ url: 'https://stub.invalid/image.png' }] });
  if (url === 'https://stub.invalid/image.png') return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  throw new Error(`Unexpected network call: ${init.method || 'GET'} ${url}`);
};
console.error = () => {};
console.warn = () => {};

const api = async (method, route, body) => {
  const res = await realFetch(`${origin}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const until = async (id, done, timeout = 40_000) => {
  const started = Date.now();
  for (;;) {
    const { body } = await api('GET', `/api/projects/${id}`);
    if (done(body)) return body;
    if (Date.now() - started > timeout) throw new Error(`timed out; state: ${JSON.stringify({ direction: body.direction, pipeline: body.pipeline })}`);
    await new Promise(r => setTimeout(r, 200));
  }
};

test('documents fan out into distinct-brand directions, each with its own brief, previewed in parallel and then chosen', async () => {
  const form = new FormData();
  form.set('text', '燕麦蛋白护发膜，200g，浓稠膏霜，洗发后涂抹发梢并冲洗。');
  const created = await (await realFetch(`${origin}/api/projects`, { method: 'POST', body: form })).json();
  const id = created.id;

  const analyzed = await api('POST', `/api/projects/${id}/analyze`, { options: { includeKv: false, quality: 'medium' } });
  assert.equal(analyzed.status, 200);
  const p = analyzed.body;
  assert.equal(p.directions.length, 3);
  assert.equal(new Set(p.directions.map(d => d.match.primary.brand)).size, 3);
  assert.deepEqual(p.directions.map(d => d.rank), [0, 1, 2]);
  for (const d of p.directions) {
    assert.equal(d.brief.product.name, nameOf(products.find(x => x.id === d.match.primary.id)), 'each direction carries the brief written for its own reference');
    assert.ok(d.match.images.length && d.match.images.every(a => a.file && a.sha256), 'reference images are snapshotted per direction');
  }
  assert.equal(p.direction.status, 'previewing');
  assert.equal(p.brief.product.name, p.directions[0].brief.product.name);
  assert.deepEqual(p.images, {});

  // 预览进行中：不能整套生成、不能选、不能重复匹配、不能删除
  const [d1, d2, d3] = p.directions;
  for (const [method, route] of [
    ['POST', `/api/projects/${id}/generate`], ['POST', `/api/projects/${id}/directions/${d1.id}/choose`],
    ['POST', `/api/projects/${id}/views/outer_side/regenerate`], ['POST', `/api/projects/${id}/analyze`], ['DELETE', `/api/projects/${id}`],
  ]) assert.equal((await api(method, route, {})).status, 409, `${method} ${route}`);

  const choosing = await until(id, x => x.direction.status === 'choosing');
  assert.deepEqual(choosing.directions.map(d => d.image.status), ['done', 'done', 'done']);
  assert.equal(new Set(choosing.directions.map(d => d.image.file)).size, 3);
  assert.equal(submissions.length, 3, 'only the outer front is previewed per direction');
  for (const s of submissions) assert.equal(s.image_urls.length, 1, 'preview sees the direction\'s library image only');
  for (const d of choosing.directions) assert.equal(submissions.filter(s => s.prompt.includes(d.brief.product.name)).length, 1);

  // 选定前：gallery 里还没有任何视图
  assert.deepEqual(choosing.images, {});
  assert.equal((await api('POST', `/api/projects/${id}/generate`, {})).status, 409);
  assert.equal((await api('POST', `/api/projects/${id}/directions/nope/choose`, {})).status, 404);

  submissions.length = 0;
  const chosen = await api('POST', `/api/projects/${id}/directions/${d2.id}/choose`, { options: { includeKv: false, quality: 'medium' } });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.direction.status, 'chosen');
  assert.equal(chosen.body.direction.chosen, d2.id);
  assert.equal(chosen.body.brief.product.name, d2.brief.product.name);
  assert.equal(chosen.body.referenceMatch.primary.id, d2.match.primary.id);
  assert.equal(chosen.body.images.outer_front.file, choosing.directions[1].image.file, 'the previewed front is reused as-is');
  assert.equal((await api('POST', `/api/projects/${id}/directions/${d3.id}/retry`, {})).status, 409, 'no retry after choosing');

  const done = await until(id, x => x.pipeline?.status === 'done');
  assert.deepEqual(Object.keys(done.images).sort(), ['inner_back', 'inner_front', 'inner_side', 'outer_back', 'outer_front', 'outer_side']);
  assert.ok(Object.values(done.images).every(img => img.status === 'done'));
  assert.equal(submissions.length, 5, 'outer front is not rendered again; KV is off');
  assert.ok(submissions.every(s => s.prompt.includes(d2.brief.product.name)));
  assert.ok(submissions.every(s => !s.prompt.includes(d1.brief.product.name) && !s.prompt.includes(d3.brief.product.name)));
  const summary = (await api('GET', '/api/projects')).body.find(x => x.id === id);
  assert.ok(summary.cover);
});

test('re-analysing starts a fresh round, and one failed preview can be retried without redoing the others', async () => {
  const form = new FormData();
  form.set('text', '燕麦蛋白护发膜，200g，浓稠膏霜。');
  const { id } = await (await realFetch(`${origin}/api/projects`, { method: 'POST', body: form })).json();
  submissions.length = 0;
  failNext = true;
  const first = (await api('POST', `/api/projects/${id}/analyze`, { options: { includeKv: false } })).body;
  assert.equal(first.directions.length, 3);
  const settled = await until(id, x => x.direction.status === 'choosing');
  const [failed, ...others] = [...settled.directions].sort((a, b) => (a.image.status === 'error' ? -1 : 0) - (b.image.status === 'error' ? -1 : 0));
  assert.equal(failed.image.status, 'error');
  assert.match(failed.image.error, /400|bad request|请求/i);
  assert.ok(others.every(d => d.image.status === 'done'));
  const doomed = failed;
  assert.equal((await api('POST', `/api/projects/${id}/directions/${doomed.id}/choose`, {})).status, 409, 'cannot choose a direction without a preview');

  submissions.length = 0;
  const retry = await api('POST', `/api/projects/${id}/directions/${doomed.id}/retry`, {});
  assert.equal(retry.status, 200);
  const healed = await until(id, x => x.direction.status === 'choosing' && x.directions.every(d => d.image.status === 'done'));
  assert.equal(submissions.length, 1, 'only the failed direction is re-rendered');
  assert.equal(healed.directions.find(d => d.id === doomed.id).image.versions.length, 1);
});

test('a direction whose brief cannot be written is replaced by the next brand, so there are still three different brands', async () => {
  const form = new FormData();
  form.set('text', '燕麦蛋白护发膜，200g，浓稠膏霜。');
  const { id } = await (await realFetch(`${origin}/api/projects`, { method: 'POST', body: form })).json();
  failThirdBrief = true;
  try {
    const res = await api('POST', `/api/projects/${id}/analyze`, { options: { includeKv: false } });
    assert.equal(res.status, 200);
    const { directions } = res.body;
    assert.equal(directions.length, 3);
    assert.equal(new Set(directions.map(d => d.match.primary.brand)).size, 3);
    const failedBrand = brandOf(jevThird);
    assert.ok(directions.every(d => d.match.primary.id !== jevThird && brandOf(d.match.primary.id) !== failedBrand), 'the failed brand is not used again');
    assert.deepEqual(directions.map(d => d.rank), [0, 1, 3], 'the replacement is the next JEV-ranked brand after the failed one');
    assert.equal(directions.length, new Set(directions.map(d => d.brief.product.name)).size);
    await until(id, x => x.direction.status === 'choosing');
  } finally {
    failThirdBrief = false;
  }
});

test('replacing brands is bounded: when every brief fails the analysis stops after a few brands', async () => {
  const form = new FormData();
  form.set('text', '燕麦蛋白护发膜，200g，浓稠膏霜。');
  const { id } = await (await realFetch(`${origin}/api/projects`, { method: 'POST', body: form })).json();
  briefCalls.clear();
  failAllBriefs = true;
  try {
    const res = await api('POST', `/api/projects/${id}/analyze`, { options: { includeKv: false } });
    assert.ok(res.status >= 400);
    assert.ok(briefCalls.size > 3 && briefCalls.size <= 6, `tried ${briefCalls.size} brands`);
    assert.equal((await api('GET', `/api/projects/${id}`)).body.directions?.length || 0, 0);
  } finally {
    failAllBriefs = false;
  }
});
