import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installSso } from '../lib/sso.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-sso-'));
const originalCwd = process.cwd();
process.chdir(temp);
const tickets = new Map();
const users = new Map();
let exchangeCount = 0;
const main = express();
main.use(express.json());
main.post('/api/external-sso/chanpinsheji/exchange', (req, res) => {
  exchangeCount++;
  if (req.get('x-qycm-sso-client-secret') !== 'test-client-secret') return res.status(401).json({ success: false });
  const user = tickets.get(req.body.ticket);
  if (!user) return res.status(410).json({ success: false });
  tickets.delete(req.body.ticket);
  const token = `token-${user.id}`;
  users.set(token, user);
  res.json({ success: true, data: { token, expiresAt: Date.now() + 86400000, user, redirectPath: 'https://evil.example' } });
});
main.get('/api/sso/session', (req, res) => {
  const user = users.get(req.get('authorization')?.slice(7));
  res.status(user ? 200 : 401).json({ success: Boolean(user), data: { user } });
});
const mainServer = main.listen(0, '127.0.0.1');
await new Promise((resolve) => mainServer.once('listening', resolve));
process.env.MAIN_APP_URL = `http://127.0.0.1:${mainServer.address().port}`;
process.env.SSO_CLIENT_SECRET = 'test-client-secret';
process.env.PORT = String(45000 + Math.floor(Math.random() * 1000));
const { server } = await import('../server.js');
const { createProject, getProject, assignUnownedProjects, saveFile } = await import('../lib/store.js');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
const origin = `http://127.0.0.1:${process.env.PORT}`;
after(async () => {
  server.close(); server.closeAllConnections();
  mainServer.close(); mainServer.closeAllConnections();
  process.chdir(originalCwd);
  await fs.rm(temp, { recursive: true, force: true });
});
const cookie = (response) => response.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('qy_design_') && !c.endsWith('='));
async function login(id, role = 'user') {
  const start = await fetch(`${origin}/api/sso/start`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  tickets.set(id, { id, role, nickname: id, account: `${id}@example.test` });
  const response = await fetch(`${origin}/api/sso/callback?ticket=${id}&state=${state}`, {
    redirect: 'manual', headers: { Cookie: cookie(start) },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.ok(!cookie(response).includes(`token-${id}`));
  return { session: cookie(response), state };
}
async function request(path, session, options = {}) {
  return fetch(`${origin}${path}`, { redirect: 'manual', ...options, headers: { Cookie: session || '', ...options.headers } });
}

test('SSO denies anonymous data and rejects missing state before consuming a ticket', async () => {
  assert.equal((await request('/api/projects')).status, 401);
  assert.equal((await request('/API/projects')).status, 404);
  assert.equal((await request('/')).headers.get('location'), '/api/sso/start');
  assert.equal((await request('/index')).headers.get('location'), '/api/sso/start');
  const before = exchangeCount;
  assert.equal((await request('/api/sso/callback?ticket=forged')).status, 400);
  assert.equal(exchangeCount, before);
});

test('SSO isolates every account and migrates legacy work to its designated owner without changing content', async () => {
  const alice = await login('alice');
  const bob = await login('bob');
  const admin = await login('admin', 'admin');
  const otherAdmin = await login('other-admin', 'admin');
  const legacy = await createProject({ source: { name: 'legacy' }, images: {} });
  const legacyBefore = structuredClone(legacy);
  const legacyFile = await saveFile(legacy.id, 'refs', 'legacy.png', Buffer.from('legacy fixture'));
  const form = new FormData(); form.set('text', 'SSO 测试产品资料，不进行出图');
  const created = await request('/api/projects', alice.session, { method: 'POST', body: form });
  assert.equal(created.status, 200);
  const project = await created.json();
  assert.equal(project.ownerUserId, 'alice');
  assert.deepEqual(await (await request('/api/projects', admin.session)).json(), []);
  assert.equal((await request(`/api/projects/${legacy.id}`, admin.session)).status, 404);
  assert.equal(await assignUnownedProjects('admin'), 1);
  assert.deepEqual(await getProject(legacy.id), { ...legacyBefore, ownerUserId: 'admin' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(temp, 'data/projects', legacy.id, 'project.json'), 'utf8')), { ...legacyBefore, ownerUserId: 'admin' });
  assert.equal(await assignUnownedProjects('other-admin'), 0);
  assert.equal((await getProject(project.id)).ownerUserId, 'alice');
  assert.equal((await getProject(legacy.id)).ownerUserId, 'admin');
  assert.equal(await (await request(legacyFile, admin.session)).text(), 'legacy fixture');
  assert.equal((await request(legacyFile, bob.session)).status, 404);
  assert.equal((await request(legacyFile, otherAdmin.session)).status, 404);
  assert.equal((await request(`/api/projects/${legacy.id}`, otherAdmin.session)).status, 404);
  assert.deepEqual(await (await request('/api/projects', otherAdmin.session)).json(), []);
  assert.deepEqual((await (await request('/api/projects', alice.session)).json()).map((p) => p.id), [project.id]);
  assert.deepEqual(await (await request('/api/projects', bob.session)).json(), []);
  assert.deepEqual((await (await request('/api/projects', admin.session)).json()).map((p) => p.id), [legacy.id]);
  const file = await saveFile(project.id, 'refs', 'sample.png', Buffer.from('image fixture'));
  assert.equal((await request(file, alice.session)).status, 200);
  for (const [path, method] of [[`/api/projects/${project.id}`, 'GET'], [`/api/projects/${project.id}/zip`, 'GET'],
    [`/api/projects/${project.id}/generate`, 'POST'], [`/api/projects/${project.id}`, 'DELETE'], [file, 'GET']]) {
    assert.equal((await request(path, bob.session, { method })).status, 404);
  }
  assert.equal((await request(`/api/projects/${legacy.id}`, alice.session)).status, 404);
  assert.equal((await request(`/api/projects/${legacy.id}`, admin.session)).status, 200);
  assert.equal((await request('/api/session', alice.session)).status, 200);
  assert.equal((await request('/api/projects', alice.session, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/projects', alice.session.slice(0, -3) + 'bad')).status, 401);
  const replay = await request(`/api/sso/callback?ticket=alice&state=${alice.state}`, `qy_design_state=${alice.state}`);
  assert.equal(replay.status, 401);
  users.delete('token-alice');
  assert.equal((await request('/api/session', alice.session)).status, 401);
});

test('production fails closed when the SSO secret is missing', async () => {
  const app = express();
  installSso(app, { secret: '', secure: true });
  app.get('/api/projects', (_, res) => res.json(['private']));
  const instance = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => instance.once('listening', resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${instance.address().port}/api/projects`)).status, 503); }
  finally { instance.close(); instance.closeAllConnections(); }
});
