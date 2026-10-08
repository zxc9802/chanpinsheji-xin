import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImagePrompt } from '../lib/image-prompt.js';

test('wording adjustments preserve fashion style, body lines and normal product details', () => {
  const prompt = prepareImagePrompt('性冷淡风，性感露肤，突出身材展示力与身体曲线，少女感配色，SEXY styling；保留露腰、V领、开衩、敏感肌和30ml');
  assert.doesNotMatch(prompt, /性冷淡|性感露肤/);
  assert.match(prompt, /极简风，露肤剪裁，突出身材展示力与身体曲线，少女感配色，SEXY styling/);
  assert.match(prompt, /露腰、V领、开衩、敏感肌和30ml/);
  assert.match(prompt, /【商品表达】/);
  assert.doesNotMatch(prompt, /不额外强化身体局部或姿态/);
  assert.match(prompt, /局部细节、穿着效果及原有风格/);
});

test('literal names and printed copy are preserved even with regex characters and overlaps', () => {
  const names = ['性感[A]+(B)?', 'SEXY.*', '性感'];
  const prompt = prepareImagePrompt('性感[A]+(B)? / SEXY.* / 性感；性冷淡风与身体曲线', names);
  for (const name of names) assert.ok(prompt.includes(name));
  assert.match(prompt, /极简风与身体曲线/);
});
