import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { extractText } from '../lib/parse.js';

const cwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-bugs-'));
process.chdir(temp);
process.env.PORT = String(43000 + Math.floor(Math.random() * 1000));
delete process.env.FAL_KEY;
const { server } = await import('../server.js');
const { createProject, getProject, updateProject, saveFile, localPathFromPublic } = await import('../lib/store.js');
const { recoverInterrupted } = await import('../lib/pipeline.js');
after(async () => {
  server.close(); server.closeAllConnections?.();
  process.chdir(cwd);
  await fs.rm(temp, { recursive: true, force: true });
});
const origin = `http://127.0.0.1:${process.env.PORT}`;
const request = async (url, method = 'GET', body) => {
  const response = await fetch(origin + url, {
    method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
};
const face = { content: '文字', text: ['测试产品'], promptEn: 'product label' };
const brief = {
  product: { brand: '测试', name: '精华', specs: [], sellingPoints: [] },
  design: { palette: [], keywords: [], finishes: [] },
  outer: { structure: '纸盒', faces: { front: face, side: face, back: face } },
  inner: { structure: '泵瓶', faces: { front: face, side: face, back: face } }, kv: { content: '' },
};
const fixture = (extra = {}) => createProject({ brief: structuredClone(brief), briefRev: 0, refs: [], images: {}, ...extra });

test('deleted projects disappear from reads and cannot be edited from another window', async () => {
  const p = await fixture();
  assert.equal((await request(`/api/projects/${p.id}`, 'DELETE')).status, 200);
  assert.equal((await request(`/api/projects/${p.id}`)).status, 404);
  assert.equal((await request(`/api/projects/${p.id}/brief`, 'PUT', { brief, rev: 0 })).status, 404);
});

test('a brief cannot be replaced with a partial object that breaks the editor and export', async () => {
  const p = await fixture();
  assert.equal((await request(`/api/projects/${p.id}/brief`, 'PUT', { brief: { product: { name: 'bad' } }, rev: 0 })).status, 400);
  assert.deepEqual((await getProject(p.id)).brief, brief);
});

test('single redraw requires a brief before queueing work', async () => {
  const p = await fixture({ brief: null });
  assert.equal((await request(`/api/projects/${p.id}/views/outer_front/regenerate`, 'POST', {})).status, 400);
});

test('dependent retries wait until the required anchor has a usable image', async () => {
  const p = await fixture({ commerce: { status: 'done', plan: { anchor: 'main_01', slots: [{ id: 'main_02', kind: 'main' }] }, images: {} } });
  assert.equal((await request(`/api/projects/${p.id}/views/outer_side/regenerate`, 'POST', {})).status, 409);
  assert.equal((await request(`/api/projects/${p.id}/commerce/slots/main_02/regenerate`, 'POST', {})).status, 409);
});

test('a queued batch blocks manual redraw and version changes until the batch finishes', async () => {
  const p = await fixture({ pipeline: { status: 'running' }, images: {
    outer_front: { status: 'done', file: '/old.png', versions: [{ file: '/old.png' }] },
    outer_side: { status: 'queued' },
  } });
  for (const [route, body] of [['views/outer_side/regenerate', {}], ['views/outer_front/select', { index: 0 }]]) {
    assert.equal((await request(`/api/projects/${p.id}/${route}`, 'POST', body)).status, 409, route);
  }
});

test('queued single redraw blocks a new batch and deletion', async () => {
  const p = await fixture({ images: { outer_front: { status: 'queued' } } });
  assert.equal((await request(`/api/projects/${p.id}/generate`, 'POST', {})).status, 409);
  assert.equal((await request(`/api/projects/${p.id}`, 'DELETE')).status, 409);
});

test('commerce batch blocks redraws of queued slots and switching its anchor', async () => {
  const p = await fixture({ commerce: { status: 'rendering', plan: { slots: [{ id: 'main_01', kind: 'main' }] }, images: {
    main_01: { status: 'queued', versions: [{ file: '/old.png' }] },
  } } });
  for (const [route, body] of [['regenerate', {}], ['select', { index: 0 }]]) {
    assert.equal((await request(`/api/projects/${p.id}/commerce/slots/main_01/${route}`, 'POST', body)).status, 409);
  }
});

test('commerce plan supports removing a headline', async () => {
  const p = await fixture({ commerce: { status: 'done', rev: 0, images: {}, plan: { slots: [{ id: 'main_01', kind: 'main', headline: 'old', copy: [] }] } } });
  assert.equal((await request(`/api/projects/${p.id}/commerce/plan`, 'PUT', { rev: 0, slots: { main_01: { headline: '' } } })).status, 200);
  assert.equal((await getProject(p.id)).commerce.plan.slots[0].headline, '');
});

test('unknown slot selections do not start a commerce job', async () => {
  const p = await fixture({ commerce: { status: 'done', plan: { slots: [{ id: 'main_01', kind: 'main' }] }, images: {} } });
  assert.equal((await request(`/api/projects/${p.id}/commerce/generate`, 'POST', { slotIds: ['missing'] })).status, 400);
  assert.equal((await getProject(p.id)).commerce.status, 'done');
});

test('multipart errors return a readable JSON validation error', async () => {
  const form = new FormData();
  form.set('text', '测试');
  form.set('unexpected', new Blob(['hello']), 'test.txt');
  const response = await fetch(origin + '/api/projects', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /json/);
  assert.ok((await response.json()).error);
});

test('fake reference images are rejected before a project is created', async () => {
  const form = new FormData();
  form.set('text', '测试');
  form.set('refs', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  const response = await fetch(origin + '/api/projects', { method: 'POST', body: form });
  assert.equal(response.status, 400);
});

test('XLSX extraction reads cell order, numeric values, shared and inline strings', async () => {
  const zip = new JSZip();
  zip.file('xl/sharedStrings.xml', '<sst><si><t>净含量</t></si><si><t>无关旧值</t></si><si><t>ml</t></si></sst>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>30</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>产品&#x540D;</t></is></c><c r="B2" t="inlineStr"><is><t>测试精华</t></is></c></row></sheetData></worksheet>');
  const result = await extractText(await zip.generateAsync({ type: 'nodebuffer' }), '产品.xlsx');
  assert.match(result.text, /净含量\s+30\s+ml/);
  assert.match(result.text, /产品名\s+测试精华/);
  assert.doesNotMatch(result.text, /无关旧值/);
});

test('XLSX files containing only inline strings are supported', async () => {
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row><c t="inlineStr"><is><t>产品说明</t></is></c></row></sheetData></worksheet>');
  const result = await extractText(await zip.generateAsync({ type: 'nodebuffer' }), '产品.xlsx');
  assert.match(result.text, /产品说明/);
});

test('unsupported binary documents are rejected instead of decoded as product text', async () => {
  await assert.rejects(extractText(Buffer.from([0, 1, 2, 255]), '产品.zip'), /不支持/);
});

test('public file paths cannot escape an image directory', () => {
  for (const file of ['..', '.', '..\\project.json']) assert.equal(localPathFromPublic(`/files/123456/images/${file}`), null);
});

test('static workbench loads when the server is imported outside the repo working directory', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /包装与电商图工作台/);
});

test('failed disk writes do not publish unsaved data or advance its revision in the cache', async (t) => {
  const p = await fixture();
  t.mock.method(fs, 'rename', async () => { throw new Error('disk full'); });
  await assert.rejects(updateProject(p.id, (p) => { p.brief.product.name = '未保存'; p.briefRev++; }), /disk full/);
  assert.equal((await getProject(p.id)).brief.product.name, '精华');
  assert.equal((await getProject(p.id)).briefRev, 0);
});

test('simultaneous edits retain all independent changes', async () => {
  const p = await fixture();
  await Promise.all(Array.from({ length: 12 }, (_, i) => updateProject(p.id, (p) => { p.images[`view_${i}`] = { status: 'done' }; })));
  const saved = JSON.parse(await fs.readFile(path.join(temp, 'data/projects', p.id, 'project.json'), 'utf8'));
  assert.equal(Object.keys(saved.images).length, 12);
});

test('concurrent requests cannot both overwrite the same brief revision', async () => {
  const p = await fixture();
  const responses = await Promise.all(['first', 'second'].map((name) => request(`/api/projects/${p.id}/brief`, 'PUT', { rev: 0, brief: { ...brief, product: { ...brief.product, name } } })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await getProject(p.id)).briefRev, 1);
});

test('a failed redraw can restore a previous version as a usable image', async () => {
  const p = await fixture({ images: { outer_front: { status: 'error', error: 'failed', versions: [{ file: '/old.png' }] } } });
  assert.equal((await request(`/api/projects/${p.id}/views/outer_front/select`, 'POST', { index: 0 })).status, 200);
  const img = (await getProject(p.id)).images.outer_front;
  assert.equal(img.status, 'done');
  assert.equal(img.error, null);
});

test('restart recovery stops the interrupted batch clock and reports failure', async () => {
  const p = await fixture({ pipeline: { status: 'running', startedAt: 1 }, images: { outer_front: { status: 'running' } } });
  await recoverInterrupted(p);
  assert.equal(p.pipeline.status, 'error');
  assert.ok(p.pipeline.finishedAt > 1);
  assert.ok(p.images.outer_front.finishedAt > 1);
});

test('analysis progress and failure remain visible to a reloaded page', async (t) => {
  const p = await fixture({ brief: null, docText: '测试精华产品' });
  const fetchReal = globalThis.fetch;
  const previousKey = process.env.JEV_API_KEY;
  process.env.JEV_API_KEY = 'test';
  t.after(() => { if (previousKey === undefined) delete process.env.JEV_API_KEY; else process.env.JEV_API_KEY = previousKey; });
  let release;
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const response = new Promise((resolve) => { release = resolve; });
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', (url, init) => {
    if (String(url).startsWith(origin)) return fetchReal(url, init);
    started();
    return response;
  });
  const pending = request(`/api/projects/${p.id}/analyze`, 'POST', {});
  await waiting;
  const running = JSON.parse((await request(`/api/projects/${p.id}`)).text);
  assert.equal(running.analysis.status, 'running');
  release(new Response('unavailable', { status: 503 }));
  assert.equal((await pending).status, 500);
  const failed = JSON.parse((await request(`/api/projects/${p.id}`)).text);
  assert.equal(failed.analysis.status, 'error');
  assert.match(failed.analysis.error, /JEV/);
});

test('restart recovers an interrupted analysis instead of leaving it busy forever', async () => {
  const p = await fixture({ analysis: { status: 'running', startedAt: 1 } });
  await recoverInterrupted(p);
  assert.equal(p.analysis.status, 'error');
  assert.ok(p.analysis.finishedAt > 1);
});
