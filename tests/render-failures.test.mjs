import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blankCanvasDataUri, generateImage } from '../lib/fal.js';

const cwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-render-bugs-'));
process.chdir(temp);
process.env.FAL_KEY = 'test';
const { createProject, getProject, updateProject, saveFile } = await import('../lib/store.js');
const { runPipeline, runView } = await import('../lib/pipeline.js');
const { renderCommerce } = await import('../lib/commerce-render.js');
after(async () => { process.chdir(cwd); await fs.rm(temp, { recursive: true, force: true }); });
const face = { content: '版面', text: ['产品'], promptEn: 'product label' };
const brief = { product: { brand: '品牌', name: '原始产品', specs: [] }, design: { palette: [], finishes: [] }, outer: { faces: { front: face, side: face, back: face } }, inner: { faces: { front: face, side: face, back: face } }, kv: {} };
const png = Buffer.from(blankCanvasDataUri().split(',')[1], 'base64');
function network(t, { fail = false, onSubmit = () => {}, image = png } = {}) {
  const calls = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).includes('queue.fal.run')) {
      calls.push(JSON.parse(init.body));
      await onSubmit(calls);
      if (fail) return new Response('bad request', { status: 400 });
      return Response.json({ status_url: 'https://stub.invalid/status', response_url: 'https://stub.invalid/result' });
    }
    if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (url.endsWith('/result')) return Response.json({ images: [{ url: 'https://stub.invalid/image' }] });
    if (url.endsWith('/image')) return new Response(image);
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return calls;
}
test('a failed packaging anchor stops dependent submissions and reports failed batch', async (t) => {
  const p = await createProject({ brief, refs: [], images: {} });
  const calls = network(t, { fail: true });
  await runPipeline(p.id, ['outer_front', 'outer_side', 'inner_front', 'inner_side']);
  assert.equal(calls.length, 1);
  const done = await getProject(p.id);
  assert.equal(done.pipeline.status, 'error');
  assert.match(done.images.outer_side.error, /前序/);
});
test('a failed commerce anchor skips dependent screens but keeps the independent white shot', async (t) => {
  const p = await createProject({ brief, refs: [], images: {} });
  const file = await saveFile(p.id, 'images', 'input.png', png);
  await updateProject(p.id, (p) => { p.commerce = { status: 'done', inputs: [{ id: 'in1', label: '产品', file }], images: {}, plan: {
    system: { style: [] }, anchor: 'main_01', slots: ['hero', 'ingredient', 'white'].map((role, i) => ({ id: `main_0${i + 1}`, kind: 'main', role, roleLabel: role, headline: '', copy: [], identityInputs: ['in1'] })),
  } }; });
  const calls = network(t, { fail: true });
  await renderCommerce(p.id);
  assert.equal(calls.length, 2);
  assert.equal((await getProject(p.id)).commerce.images.main_02.status, 'error');
});
test('editing a brief during a batch cannot mix two briefs into one set', async (t) => {
  const p = await createProject({ brief: structuredClone(brief), refs: [], images: {} });
  const calls = network(t, { onSubmit: async (calls) => {
    if (calls.length === 1) await updateProject(p.id, (p) => { p.brief.product.name = '中途修改产品'; });
  } });
  await runPipeline(p.id, ['outer_front', 'outer_side']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.prompt.includes('原始产品')));
  assert.ok(calls.every((c) => !c.prompt.includes('中途修改产品')));
  assert.equal((await getProject(p.id)).brief.product.name, '中途修改产品');
});
test('new renders and redraws use neutral product language and save the submitted prompt', async (t) => {
  const b = structuredClone(brief);
  b.design.visualStyleEn = 'sexy styling';
  b.outer.faces.front.text = ['性感度假系列', '敏感肌适用'];
  const p = await createProject({ brief: b, refs: [], images: {} });
  const calls = network(t);
  await runView(p.id, 'outer_front', { extra: '性冷淡风，突出身体曲线，保留露腰、V领和开衩设计' });
  await runView(p.id, 'outer_front', { extra: '性感露肤风格，改成清新少女感配色' });
  assert.equal(calls.length, 2);
  for (const input of calls) {
    assert.match(input.prompt, /【商品表达】/);
    assert.doesNotMatch(input.prompt, /性冷淡|性感露肤|不额外强化身体局部或姿态/);
    assert.match(input.prompt, /sexy styling/);
    assert.match(input.prompt, /性感度假系列/);
    assert.match(input.prompt, /敏感肌适用/);
    assert.ok(!Object.hasOwn(input, 'literalText'));
  }
  assert.match(calls[0].prompt, /露腰、V领和开衩设计/);
  assert.match(calls[0].prompt, /身体曲线/);
  assert.match(calls[1].prompt, /少女感配色/);
  const image = (await getProject(p.id)).images.outer_front;
  assert.deepEqual(image.versions.map((v) => v.prompt), calls.map((input) => input.prompt));
  assert.equal(image.prompt, calls[1].prompt);
});
test('an HTTP 200 HTML image download must not become a completed PNG', async (t) => {
  const p = await createProject({ brief, refs: [], images: {} });
  network(t, { image: Buffer.from('<html>service unavailable</html>') });
  await runView(p.id, 'outer_front');
  assert.equal((await getProject(p.id)).images.outer_front.status, 'error');
});
test('terminal image job errors are reported in Chinese without polling a dead task', async (t) => {
  let polls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('queue.fal.run')) return Response.json({ status_url: 'https://stub.invalid/status', response_url: 'https://stub.invalid/result' });
    polls++;
    if (polls > 1) return new Response('polled after terminal failure', { status: 400 });
    return Response.json({ status: 'FAILED', error: 'render rejected' });
  });
  await assert.rejects(generateImage({ prompt: 'test', imageUrls: [] }), /图片生成失败/);
  assert.equal(polls, 1);
});
test('content moderation failures are Chinese and remain non-retryable in stored images', async (t) => {
  const p = await createProject({ brief, refs: [], images: {} });
  let calls = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ detail: [{ loc: ['body', 'prompt'], msg: 'The content could not be processed because it contained material flagged by a content checker.', type: 'content_policy_violation' }] }, { status: 422 });
  });
  await runView(p.id, 'outer_front');
  const image = (await getProject(p.id)).images.outer_front;
  assert.equal(calls, 1);
  assert.equal(image.status, 'error');
  assert.match(image.error, /内容审核/);
  assert.doesNotMatch(image.error, /content_policy|body|prompt|flagged|\{/);
});
