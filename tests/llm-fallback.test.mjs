import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../lib/llm.js';

const primary = 'gpt-6-luna';
const fallback = 'deepseek-v4.1-flash';
// 简报必须完整才算成功；只有前半段的返回会被当作失败重试（见 references.test.mjs）
const face = { content: '主标题与规格分层', text: ['氨基酸洁面泡沫'], promptEn: 'clear product heading' };
const faces = { front: face, side: face, back: face };
const valid = JSON.stringify({
  product: { name: '氨基酸洁面泡沫' },
  design: { palette: [{ name: '乳白', hex: '#EEEBDC', role: '主色' }] },
  outer: { structure: '单品折叠盒', faces },
  inner: { structure: '泡沫泵瓶', faces },
  kv: { content: '纸盒与泵瓶并排' },
});
const reply = content => Response.json({ choices: [{ message: { content } }] });

async function exercise(t, responses, models, shouldFail = false) {
  const config = { LLM_MODEL: primary, LLM_FALLBACK_MODEL: fallback, LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://provider.invalid/v1/chat/completions' };
  const saved = Object.fromEntries(Object.keys(config).map(k => [k, process.env[k]]));
  Object.assign(process.env, config);
  const calls = [];
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ body, signal: init.signal });
    assert.equal(url, config.LLM_BASE_URL);
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    const result = responses[calls.length - 1];
    if (result instanceof Error) throw result;
    if (typeof result === 'number') return new Response('provider error', { status: result });
    return reply(result);
  });
  try {
    const pending = analyzeDocument({ docText: '氨基酸洁面泡沫，150mL。', options: { style: 'auto' } });
    if (shouldFail) await assert.rejects(pending, /文案模型.*请求失败（503）/);
    else assert.equal((await pending).product.name, '氨基酸洁面泡沫');
    assert.deepEqual(calls.map(c => c.body.model), models);
    assert.equal(new Set(calls.map(c => c.signal)).size, calls.length, 'each attempt needs a fresh timeout signal');
    for (const call of calls) assert.deepEqual(call.body.messages, calls[0].body.messages, 'fallback must retain the same product brief and design instructions');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('primary success returns immediately without calling DeepSeek', async t => {
  await exercise(t, [valid], [primary]);
});

test('primary success on retry stops further attempts', async t => {
  await exercise(t, [503, valid], [primary, primary]);
});

test('the third retry is still sent to the primary model', async t => {
  await exercise(t, [503, 503, 503, valid], [primary, primary, primary, primary]);
});

test('HTTP, timeout, malformed JSON and empty output exhaust primary before fallback', async t => {
  await exercise(t, [503, new DOMException('timeout', 'TimeoutError'), 'not json', '', valid], [primary, primary, primary, primary, fallback]);
});

test('DeepSeek retains its original single retry', async t => {
  await exercise(t, [503, 503, 503, 503, 503, valid], [primary, primary, primary, primary, fallback, fallback]);
});

test('failure remains bounded after both models exhaust their attempts', async t => {
  await exercise(t, [503, 503, 503, 503, 503, 503], [primary, primary, primary, primary, fallback, fallback], true);
});

test('the brief prompt asks for invented back-panel copy instead of "待确认" placeholders', async t => {
  const saved = { key: process.env.LLM_API_KEY, url: process.env.LLM_BASE_URL };
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_BASE_URL = 'https://provider.invalid/v1/chat/completions';
  t.mock.method(console, 'info', () => {});
  let system = '';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    system = JSON.parse(init.body).messages.find(m => m.role === 'system').content;
    return reply(valid);
  });
  try {
    await analyzeDocument({ docText: '氨基酸洁面泡沫，150mL。', options: { style: 'auto' } });
  } finally {
    if (saved.key === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved.key;
    if (saved.url === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = saved.url;
  }
  assert.match(system, /编造合理、自洽的内容补全/);
  assert.match(system, /不能出现「待确认」/);
  assert.doesNotMatch(system, /缺失事实保持待确认/);
  // 编造的版面信息要如实记在 unknown 里，方便设计师投产前替换
  assert.match(system, /referenceExplanation\.unknown 里如实列一条/);
});
