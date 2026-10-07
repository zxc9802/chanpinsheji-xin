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
test('an HTTP 200 HTML image download must not become a completed PNG', async (t) => {
  const p = await createProject({ brief, refs: [], images: {} });
  network(t, { image: Buffer.from('<html>service unavailable</html>') });
  await runView(p.id, 'outer_front');
  assert.equal((await getProject(p.id)).images.outer_front.status, 'error');
});
test('terminal image job errors are reported without polling a dead task', async (t) => {
  let polls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('queue.fal.run')) return Response.json({ status_url: 'https://stub.invalid/status', response_url: 'https://stub.invalid/result' });
    polls++;
    if (polls > 1) return new Response('polled after terminal failure', { status: 400 });
    return Response.json({ status: 'FAILED', error: 'render rejected' });
  });
  await assert.rejects(generateImage({ prompt: 'test', imageUrls: [] }), /render rejected/);
  assert.equal(polls, 1);
});
