import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { errorMessage } from '../public/js/errors.js';

const source = await fs.readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

for (const response of ['truncated JSON', 'empty object']) {
  test(`${response} preserves the commerce project and the next poll reaches completion`, async () => {
    const id = '20261007-polling-test';
    const images = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`image_${i}`, { status: 'done' }]));
    const project = { id, kind: 'commerce', brief: null, briefRev: 0, images: {}, commerce: { status: 'rendering', images: {}, plan: { slots: [] } } };
    const completed = { ...project, commerce: { ...project.commerce, status: 'done', images } };
    const nodes = new Map();
    const timers = [];
    let requests = 0;
    const context = vm.createContext({
      errorMessage,
      state: { project, pollEpoch: 0, pollTimer: null, galleryKey: '', views: [{ id: 'outer_front', group: 'outer' }] },
      $: (selector) => {
        if (!nodes.has(selector)) nodes.set(selector, { hidden: false, textContent: '', classList: { toggle() {} } });
        return nodes.get(selector);
      },
      commerce: {
        isActive: (p = context.state.project) => p?.commerce?.status === 'rendering',
        render() {},
        commerceOf: () => context.state.project.commerce,
        slotsOf: (c) => c.plan.slots,
      },
      fetch: async () => ({
        ok: true,
        json: async () => {
          if (++requests === 1) {
            if (response === 'truncated JSON') throw new SyntaxError('Unexpected end of JSON input');
            return {};
          }
          return completed;
        },
      }),
      setTimeout: (callback) => { timers.push(callback); return timers.length; },
      clearTimeout() {},
      setRail() {},
      lbOpen: () => false,
      toast() {},
      Date,
    });
    vm.runInContext([
      section('async function api(', '\nfunction toast('),
      section('function activeViews(', '\nasync function generate('),
      section('function renderGallery(', '\nfunction paintShot('),
      section('function updateGallery(', '// 每秒刷新计时器'),
    ].join('\n'), context);

    vm.runInContext('startPolling()', context);
    await timers.shift()();
    assert.equal(context.state.project.id, id, 'a failed response must not erase the project being watched');
    assert.equal(context.state.project.kind, 'commerce');
    await timers.shift()();
    assert.equal(requests, 2);
    assert.equal(context.state.project.commerce.status, 'done');
    assert.match(nodes.get('#renderSubtitle').textContent, /已完成 15 张/);
    assert.equal(nodes.get('#renderTitle').textContent, '产品套图');
  });
}
