import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';

const run = promisify(execFile);
const original = await fs.readFile(new URL('../public/sample/test-product-centella.png', import.meta.url));
const appSource = await fs.readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const cwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-preview-test-'));
process.chdir(temp);
process.env.PORT = String(44000 + Math.floor(Math.random() * 1000));
const { server } = await import('../server.js');
const { createProject, saveFile } = await import('../lib/store.js');
const origin = `http://127.0.0.1:${process.env.PORT}`;
after(async () => {
  server.close(); server.closeAllConnections?.();
  process.chdir(cwd);
  await fs.rm(temp, { recursive: true, force: true });
});

test('image previews are small, cached and decodable while the original stays unchanged', async () => {
  const project = await createProject({ images: {} });
  const url = await saveFile(project.id, 'images', 'detail.png', original);
  const replies = await Promise.all(Array.from({ length: 3 }, () => fetch(origin + url + '?preview=1')));
  const buffers = await Promise.all(replies.map(async (res) => {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/jpeg/);
    assert.match(res.headers.get('cache-control'), /max-age=604800/);
    return Buffer.from(await res.arrayBuffer());
  }));
  assert.ok(buffers[0].length < original.length / 4, 'preview should transfer less than a quarter of the original');
  assert.deepEqual(buffers[0], buffers[1]);
  const preview = path.join(temp, 'preview.jpg');
  await fs.writeFile(preview, buffers[0]);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', preview]);
  const { width, height } = JSON.parse(stdout).streams[0];
  assert.ok(width > 0 && height > 0 && Math.max(width, height) <= 1280);
  const cached = await fetch(origin + url + '?preview=1');
  assert.deepEqual(Buffer.from(await cached.arrayBuffer()), buffers[0]);
  const download = await fetch(origin + url);
  assert.match(download.headers.get('content-type'), /image\/png/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
  assert.equal((await fetch(origin + `/files/${project.id}/images/missing.png?preview=1`)).status, 404);
});

test('the lightbox loads the compact preview and links to the original download', () => {
  const file = '/files/20261007-example/images/detail.png';
  const nodes = new Map();
  const context = vm.createContext({
    state: {}, lb: {}, viewable: () => true, lbEntry: () => ({ img: { file }, code: 'D-02', title: '详情图', en: '', file: 'detail.png' }),
    lbIds: () => ['detail_02'],
    $: (selector) => {
      if (!nodes.has(selector)) nodes.set(selector, { dataset: {}, style: {}, classList: { toggle() {} }, setAttribute() {} });
      return nodes.get(selector);
    },
    $$: () => [],
  });
  const helper = appSource.match(/^const previewUrl = .*$/m)?.[0] || '';
  const start = appSource.indexOf('function refreshLightbox(');
  const end = appSource.indexOf('\nfunction openImageZoom(', start);
  vm.runInContext(helper + '\n' + appSource.slice(start, end) + '\nrefreshLightbox(true)', context);
  assert.equal(nodes.get('#lbImg').src, file + '?preview=1');
  assert.equal(nodes.get('#lbDownload').href, file);
});
