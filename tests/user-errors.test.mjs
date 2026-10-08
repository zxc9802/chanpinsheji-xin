import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { errorMessage, localizeErrors } from '../public/js/errors.js';

const legacy = '图片模型请求失败（422）：[{"loc":["body","prompt"],"msg":"The content could not be processed because it contained material flagged by a content checker.","type":"content_policy_violation","input":{"prompt":"截断';
for (const [error, expected] of [
  [legacy, /内容审核/],
  [{ status: 422, detail: [{ type: 'image_too_large', msg: 'Image too large' }] }, /图片尺寸过大/],
  [{ status: 401, message: 'Invalid API key' }, /认证失败/],
  [{ status: 429, message: 'Too many requests' }, /请求过于频繁/],
  [{ status: 402, message: 'Insufficient credits' }, /额度不足/],
  [{ status: 503, message: 'Bad Gateway' }, /服务暂时异常/],
  [new TypeError('Failed to fetch'), /检查网络/],
  [new SyntaxError('Unexpected end of JSON input'), /内容格式异常/],
  [new Error('ENOENT: no such file or directory'), /文件不存在/],
  [new Error('Unrecognized provider failure'), /操作失败/],
  ['AI service failed', /操作失败/],
  ['PNG decode failed', /操作失败/],
  ['上传失败 Bad Gateway', /服务暂时异常/],
  ['AI 规划出错：Unrecognized provider failure', /AI 规划出错：操作失败/],
]) {
  test(`user-facing error is Chinese: ${String(error?.message || error)}`, () => {
    const message = errorMessage(error);
    assert.match(message, expected);
    assert.doesNotMatch(message, /flagged|Bad Gateway|Unrecognized|API key|\{"loc"/);
  });
}

test('meaningful Chinese errors and filenames remain readable', () => {
  assert.equal(errorMessage('请先完成首图，再重绘本屏'), '请先完成首图，再重绘本屏');
  assert.equal(errorMessage('无法读取「Product.docx」：请重新上传'), '无法读取「Product.docx」：请重新上传');
  assert.match(errorMessage('未配置 FAL_KEY'), /图片模型密钥/);
});

test('old errors in all project branches are localized without changing saved data', () => {
  const p = { analysis: { error: 'fetch failed' }, images: { front: { error: legacy } }, directions: [{ image: { error: 'Bad Gateway' } }], commerce: { error: 'Unexpected end of JSON input' }, commerceAlt: { images: { detail_01: { error: legacy } } } };
  const original = structuredClone(p);
  const displayed = localizeErrors(p);
  assert.match(displayed.analysis.error, /网络/);
  assert.match(displayed.images.front.error, /内容审核/);
  assert.match(displayed.directions[0].image.error, /服务暂时异常/);
  assert.match(displayed.commerce.error, /格式异常/);
  assert.match(displayed.commerceAlt.images.detail_01.error, /内容审核/);
  assert.deepEqual(p, original);
});

const source = await fs.readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const apiCode = source.slice(source.indexOf('async function api('), source.indexOf('\nfunction toast('));
for (const [fetch, expected, status] of [
  [async () => { throw new TypeError('Failed to fetch'); }, /网络/, undefined],
  [async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }), /格式异常/, undefined],
  [async () => ({ ok: false, status: 503, json: async () => { throw new SyntaxError('Unexpected token <'); } }), /服务暂时异常/, 503],
  [async () => ({ ok: false, status: 409, json: async () => ({ error: '简报已更新，请重新载入', stale: true }) }), /简报已更新/, 409],
]) {
  test(`browser request errors are Chinese and preserve status ${status}`, async () => {
    const context = vm.createContext({ fetch, errorMessage });
    vm.runInContext(apiCode, context);
    await assert.rejects(vm.runInContext('api("/api/projects")', context), (error) => {
      assert.match(error.message, expected);
      assert.equal(error.status, status);
      if (status === 409) assert.equal(error.stale, true);
      return true;
    });
  });
}

test('error toasts translate browser errors while ordinary notifications stay intact', () => {
  const nodes = [];
  const context = vm.createContext({ errorMessage, document: { createElement: () => ({}) }, $: () => ({ append: (node) => nodes.push(node) }), setTimeout() {} });
  const toastCode = source.slice(source.indexOf('function toast('), source.indexOf('/* ───────────── 选项配置'));
  vm.runInContext(toastCode, context);
  vm.runInContext('toast("Failed to fetch", "error"); toast("作品 Product 已保存")', context);
  assert.match(nodes[0].textContent, /网络/);
  assert.equal(nodes[1].textContent, '作品 Product 已保存');
});
