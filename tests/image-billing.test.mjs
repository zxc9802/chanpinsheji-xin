import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blankCanvasDataUri } from '../lib/fal.js';

const cwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'image-billing-'));
process.chdir(temp);
process.env.FAL_KEY = 'test';
process.env.SSO_CLIENT_SECRET = 'test-only-client-secret';
process.env.MAIN_APP_URL = 'https://main.invalid';
const { createProject, getProject } = await import('../lib/store.js');
const { runView } = await import('../lib/pipeline.js');
const { reconcileProjectBilling } = await import('../lib/image-billing.js');
after(async () => { process.chdir(cwd); await fs.rm(temp, { recursive: true, force: true }); });
const face = { content: '测试', text: ['产品'], promptEn: 'product' };
const brief = { product: { brand: '品牌', name: '产品', specs: [] }, design: { palette: [], finishes: [] }, outer: { faces: { front: face, side: face, back: face } }, inner: { faces: { front: face, side: face, back: face } }, kv: {} };
const png = Buffer.from(blankCanvasDataUri().split(',')[1], 'base64');

function network(t, { insufficient = false, failImage = false, loseSettlement = false } = {}) {
  const state = { calls: [], submitted: 0, consumed: new Set(), balance: 90 };
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).startsWith('https://main.invalid')) {
      const body = JSON.parse(init.body);
      assert.equal(body.userId, 'owner');
      assert.equal(init.headers['x-qycm-sso-client-secret'], 'test-only-client-secret');
      assert.equal(Object.hasOwn(body, 'amount'), false);
      state.calls.push(body);
      if (body.action === 'reserve' && insufficient) return Response.json({ error: '积分不足，本次生成需要 30 积分。', code: 'INSUFFICIENT_CREDITS' }, { status: 402 });
      if (body.action === 'settle') {
        if (!state.consumed.has(body.requestId)) { state.consumed.add(body.requestId); state.balance -= 30; }
        if (loseSettlement) throw new Error('fetch failed');
      }
      return Response.json({ success: true, data: { chargeRequired: true, requiredPoints: 30, chargedPoints: body.action === 'settle' ? 30 : 0, pointsBalance: state.balance } });
    }
    if (String(url).includes('queue.fal.run')) {
      state.submitted++;
      if (failImage) return Response.json({ error: 'invalid image' }, { status: 422 });
      return Response.json({ status_url: 'https://stub.invalid/status', response_url: 'https://stub.invalid/result' });
    }
    if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (url.endsWith('/result')) return Response.json({ images: [{ url: 'https://stub.invalid/image' }] });
    if (url.endsWith('/image')) return new Response(png);
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return state;
}

test('successful saved image consumes 30 points; a redraw creates one new charge', async t => {
  const p = await createProject({ ownerUserId: 'owner', brief, refs: [], images: {} });
  const n = network(t);
  await runView(p.id, 'outer_front');
  await runView(p.id, 'outer_front');
  assert.equal(n.balance, 30);
  assert.equal(n.consumed.size, 2);
  assert.equal(n.submitted, 2);
  const image = (await getProject(p.id)).images.outer_front;
  assert.equal(image.status, 'done');
  assert.equal(image.versions.length, 2);
  assert.deepEqual(image.versions.map(v => v.billing.chargedPoints), [30, 30]);
});

test('insufficient points never submit an image request and preserve the useful error', async t => {
  const p = await createProject({ ownerUserId: 'owner', brief, refs: [], images: {} });
  const n = network(t, { insufficient: true });
  await runView(p.id, 'outer_front');
  assert.equal(n.submitted, 0);
  assert.equal(n.balance, 90);
  assert.match((await getProject(p.id)).images.outer_front.error, /积分不足.*30/);
});

test('failed image releases its original reservation without consumption', async t => {
  const p = await createProject({ ownerUserId: 'owner', brief, refs: [], images: {} });
  const n = network(t, { failImage: true });
  await runView(p.id, 'outer_front');
  assert.deepEqual(n.calls.map(c => c.action), ['reserve', 'release']);
  assert.equal(n.calls[0].requestId, n.calls[1].requestId);
  assert.equal(n.balance, 90);
  assert.equal((await getProject(p.id)).images.outer_front.billing.state, 'released');
});

test('lost settlement response retains the saved image and recovery settles the same bill exactly once', async t => {
  const p = await createProject({ ownerUserId: 'owner', brief, refs: [], images: {} });
  const n = network(t, { loseSettlement: true });
  await runView(p.id, 'outer_front');
  assert.equal(n.balance, 60);
  assert.equal(p.images.outer_front.billing.state, 'settle_pending');
  assert.ok(p.images.outer_front.billing.pendingResult.file);
  assert.ok(!n.calls.some(c => c.action === 'release'));
  t.mock.restoreAll();
  const recovery = network(t);
  recovery.balance = n.balance;
  recovery.consumed = n.consumed;
  await reconcileProjectBilling(p, { interrupted: true });
  await reconcileProjectBilling(p, { interrupted: true });
  assert.equal(recovery.balance, 60);
  assert.equal(p.images.outer_front.status, 'done');
  assert.equal(p.images.outer_front.versions.length, 1);
  assert.equal(recovery.calls.length, 1);
  assert.equal(recovery.calls[0].requestId, n.calls[0].requestId);
});

test('restart releases a pending reservation without submitting or charging', async t => {
  const p = await createProject({ ownerUserId: 'owner', images: { outer_front: { status: 'running', billing: { userId: 'owner', requestId: 'interrupted', state: 'reserve_pending' } } } });
  const n = network(t);
  await reconcileProjectBilling(p, { interrupted: true });
  assert.equal(n.submitted, 0);
  assert.equal(n.balance, 90);
  assert.equal(p.images.outer_front.billing.state, 'released');
});
