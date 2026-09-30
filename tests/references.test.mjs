import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCatalog, matchReferences, matchDirections, assetFile, assetBytes, assetsFor, imageMime } from '../lib/references.js';
import { analyzeDocument, designRequirements } from '../lib/llm.js';
import { VIEWS } from '../lib/prompts.js';
import { blankCanvasDataUri } from '../lib/fal.js';

// Keep all generated project data outside the user's actual project collection.
const originalCwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'verdant-reference-test-'));
process.chdir(temp);
const { createProject, getProject, updateProject, saveFile } = await import('../lib/store.js');
const { buildViewInput, runView, runDirections, recoverInterrupted } = await import('../lib/pipeline.js');
after(async () => { process.chdir(originalCwd); await fs.rm(temp, { recursive: true, force: true }); });

function choices(questions, selected) {
  return Response.json({ model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const choice = selected[id];
    assert.ok(Object.hasOwn(q.criteria, choice));
    return [id, { type: 'choice', choice, confidence: .9, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === choice ? 1 : 0])) }];
  })) });
}

test('automatic options do not invent design requirements; chosen shape is identified as outer packaging', () => {
  assert.equal(designRequirements({ style: 'auto', shape: 'auto', quality: 'high', lang: 'zh' }), '');
  const note = designRequirements({ style: 'natural', shape: 'tube', extra: '不要金属色' });
  assert.match(note, /外包装形态（不是产品容器）.*圆筒纸罐/);
  assert.match(note, /不要金属色/);
});

test('JEV handles a product-only document and expands recall when the first selection is none', async () => {
  const savedFetch = globalThis.fetch, savedKey = process.env.JEV_API_KEY;
  process.env.JEV_API_KEY = 'test';
  let firstCount, calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const { state, questions } = JSON.parse(init.body);
      assert.equal(state.explicit_user_requirements, '');
      calls++;
      if (questions.category) return choices(questions, { category: '发膜', form: 'unknown' });
      if (!firstCount) { firstCount = Object.keys(questions.reference.criteria).length; return choices(questions, { reference: 'none' }); }
      assert.ok(Object.keys(questions.reference.criteria).length > firstCount);
      return choices(questions, { reference: 'cece-salon-smooth-shine-mask' });
    };
    const match = await matchReferences('燕麦蛋白护发膜，200g，浓稠膏霜，洗发后涂抹发梢并冲洗。');
    assert.equal(match.status, 'matched');
    assert.equal(match.matchKind, 'same_category');
    assert.equal(match.classification.form, 'unknown');
    assert.equal(match.expandedSearch, true);
    assert.equal(calls, 3);
    assert.ok(match.images.length);
    globalThis.fetch = async () => new Response('test-secret', { status: 401 });
    await assert.rejects(matchReferences('发膜'), e => e.message.includes('401') && !e.message.includes('test-secret'));
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.JEV_API_KEY; else process.env.JEV_API_KEY = savedKey;
  }
});

const face = { content: '主标题与规格分层', text: ['燕麦蛋白护发膜', '200g'], promptEn: 'clear product heading and a small net-content line' };
const brief = {
  product: { brand: '测试品牌', name: '燕麦蛋白护发膜', nameEn: 'Oat Protein Hair Mask', category: '发膜', specs: [{label:'净含量',value:'200g'}] },
  design: { palette: [{ name: '乳白', hex: '#EEEBDC' }], finishes: ['哑光'], motifs: '燕麦线描', typography: '层级清晰', materials: '建议PP', backdropEn: 'neutral studio' },
  outer: { structure: '单品折叠盒', dimensions: '90 × 90 × 70 mm', faces: { front:face, side:face, back:face } },
  inner: { structure:'广口矮罐', unit:'200g发膜罐', dimensions:'Ø80 × 60 mm', faces:{ front:face, side:face, back:face } },
  kv: { content:'纸盒与产品罐并排', sceneEn:'new carton beside the jar' },
};

async function fixture() {
  const { products } = await loadCatalog();
  const primary = products.find(p => p.id === 'cece-salon-smooth-shine-mask');
  const bytes = await fs.readFile(await assetFile(primary.id, 0));
  const project = await createProject({ brief: structuredClone(brief), refs: [], images: {}, options: { quality: 'medium' } });
  const file = await saveFile(project.id, 'refs', 'library.jpg', bytes);
  const match = { primary, carton: null, structureScope:'visible_container', matchKind:'same_category', images:[{productId:primary.id,index:0,role:'style',scope:'仅参考发膜罐',file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}] };
  const ownBytes = Buffer.from(blankCanvasDataUri().split(',')[1], 'base64');
  const ownFile = await saveFile(project.id, 'refs', 'own-logo.png', ownBytes);
  const anchor = await saveFile(project.id, 'images', 'anchor.png', ownBytes);
  await updateProject(project.id, p => {
    p.referenceMatch = match;
    p.refs = [{file:ownFile}];
    p.images.outer_front = {status:'done',file:anchor};
    p.images.inner_front = {status:'done',file:anchor};
  });
  return { project, bytes, match, ownBytes };
}

test('all six views and the hero receive actual library image bytes with correct source roles', async () => {
  const {project,bytes} = await fixture();
  for (const view of VIEWS) {
    const input = await buildViewInput(project,view.id);
    const library = input.imageUrls.at(-1);
    assert.deepEqual(Buffer.from(library.split(',')[1],'base64'),bytes);
    assert.ok(library.startsWith(`data:${imageMime(bytes)};base64,`));
    assert.match(input.prompt,/LIBRARY RESEARCH EXAMPLE/);
    assert.match(input.prompt,/NEVER copy its brand/);
    assert.doesNotMatch(input.prompt,/blank placeholder canvas|\{(?:brand_name|product_name|views)\}/);
    assert.equal(input.referenceInputs.at(-1).productId,'cece-salon-smooth-shine-mask');
    assert.equal(input.imageSize,view.id==='kv'?'landscape_16_9':'square_hd');
    assert.equal(input.imageUrls.length,view.deps.length+2);
  }
  project.referenceMatch.images[0].sha256='changed';
  await assert.rejects(buildViewInput(project,'outer_front'),/参考图已变更/);
  await assert.rejects(assetFile('../../.env',0));
});

test('carton isolation preserves printed hero artwork and passes the new plan adaptations to rendering', async () => {
  const { project, bytes } = await fixture();
  const adjustment = '保留参考的品牌与品名分组，改用有体量的燕麦主图和粗体产品标题';
  project.brief.referenceExplanation = { adjustments: [adjustment] };
  for (const view of ['outer_front', 'outer_side', 'outer_back']) {
    const input = await buildViewInput(project, view);
    assert.match(input.prompt, /ONLY ONE OBJECT IN THE FRAME/);
    assert.match(input.prompt, /never a multi-view layout/);
    assert.doesNotMatch(input.prompt, /多视图、主视觉的描述一律不要画进/);
    assert.match(input.prompt, /包装表面印刷的主视觉.*必须按新方案保留/);
    assert.ok(input.prompt.includes(adjustment));
    assert.deepEqual(Buffer.from(input.imageUrls.at(-1).split(',')[1], 'base64'), bytes);
  }
  project.referenceMatch.designRequirements = '用户指定：纯文字极简设计，大留白，不要插画';
  const input = await buildViewInput(project, 'outer_front', { extra: '按用户修改保留文字主视觉' });
  assert.ok(input.prompt.includes(project.referenceMatch.designRequirements));
  assert.match(input.prompt, /Explicit user requests for minimalist, text-only or low-contrast design take precedence/);
  assert.match(input.prompt, /Revision request from the art director \(highest priority\): 按用户修改保留文字主视觉/);
});

test('inner-unit views contain only the unit: no outer carton in the prompt scope, structure text, references or dependencies', async () => {
  const { project } = await fixture();
  project.brief.outer.structureEn = 'FOLDING-CARTON-STRUCTURE';
  project.brief.inner.structureEn = 'jar sits inside the carton on an INSERT-TRAY';
  project.referenceMatch.carton = { visual_structure: 'CARTON-VISUAL-BASIS' };
  for (const view of ['inner_front', 'inner_side', 'inner_back']) {
    const { prompt } = await buildViewInput(project, view);
    assert.match(prompt, /ONLY ONE OBJECT IN THE FRAME: the inner unit on its own/);
    assert.match(prompt, /must NOT contain: the outer carton, box, sleeve, lid or insert tray/);
    assert.match(prompt, /do NOT draw any carton, box or extra object in this inner-unit view/);
    assert.match(prompt, /仅内包装主体.*单张正投影图.*不含外盒/);
    assert.match(prompt, /The inner unit shown in this view: 200g发膜罐/);
    assert.doesNotMatch(prompt, /FOLDING-CARTON-STRUCTURE|INSERT-TRAY|CARTON-VISUAL-BASIS|Outer package structure|不要在外盒旁摆放/);
  }
  // 内包装正视图以外包装正视图为参考：只能取品牌与图形，不能把外盒画进来
  const front = await buildViewInput(project, 'inner_front');
  assert.match(front.prompt, /approved OUTER · FRONT view — take only brand identity, logo, colours and graphics from it; do NOT draw its outer carton/);
  // 外包装与主视觉保持原样
  assert.match((await buildViewInput(project, 'outer_side')).prompt, /FOLDING-CARTON-STRUCTURE/);
  const kv = (await buildViewInput(project, 'kv')).prompt;
  assert.match(kv, /FOLDING-CARTON-STRUCTURE/);
  assert.match(kv, /INSERT-TRAY/);
  assert.doesNotMatch(kv, /ONLY ONE OBJECT IN THE FRAME/);
});

test('the actual fal request contains the library image on initial render and redraw, with per-version evidence', async () => {
  const { project,bytes,ownBytes } = await fixture();
  const savedFetch=globalThis.fetch, savedKey=process.env.FAL_KEY;
  process.env.FAL_KEY='test';
  const submissions=[];
  try {
    globalThis.fetch=async (url,init={})=>{
      if(String(url).startsWith('https://queue.fal.run/')) {
        const body=JSON.parse(init.body);
        submissions.push(body);
        assert.deepEqual(Buffer.from(body.image_urls.at(-1).split(',')[1],'base64'),bytes);
        assert.equal(body.image_urls.length,3);
        return Response.json({status_url:'https://stub.invalid/status',response_url:'https://stub.invalid/result'});
      }
      if(url==='https://stub.invalid/status') return Response.json({status:'COMPLETED'});
      if(url==='https://stub.invalid/result') return Response.json({images:[{url:'https://stub.invalid/image.png'}]});
      if(url==='https://stub.invalid/image.png') return new Response(ownBytes,{headers:{'Content-Type':'image/png'}});
      throw new Error(`Unexpected network call: ${url}`);
    };
    await runView(project.id,'outer_side');
    assert.equal((await getProject(project.id)).images.outer_side.status,'done');
    await updateProject(project.id,p=>{
      p.brief.outer.faces.side.content='中文编辑：侧面增加清晰的使用步骤';
      p.brief.outer.faces.side.promptEn='English edit: use a numbered vertical layout';
    });
    await runView(project.id,'outer_side',{extra:'减少装饰，保留哑光'});
    const image=(await getProject(project.id)).images.outer_side;
    assert.equal(image.status,'done');
    assert.equal(submissions.length,2);
    assert.match(submissions[1].prompt,/减少装饰，保留哑光/);
    assert.match(submissions[1].prompt,/中文编辑：侧面增加清晰的使用步骤/);
    assert.match(submissions[1].prompt,/English edit: use a numbered vertical layout/);
    assert.equal(image.versions.length,2);
    assert.ok(image.versions.every(v=>v.referenceInputs.at(-1).role==='library'));
  } finally {
    globalThis.fetch=savedFetch;
    if(savedKey===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=savedKey;
  }
});

test('the plan model receives the selected design profile and preserves explanation fields', async () => {
  const {match}=await fixture();
  const savedFetch=globalThis.fetch,savedKey=process.env.LLM_API_KEY;
  process.env.LLM_API_KEY='test';
  try {
    globalThis.fetch=async(_url,init)=>{
      const {messages}=JSON.parse(init.body);
      assert.ok(messages[1].content.includes(match.primary.design_language));
      assert.ok(messages[1].content.includes(match.primary.physical_structure));
      return Response.json({choices:[{message:{content:JSON.stringify({...brief,referenceExplanation:{reason:'同品类浓稠发膜',borrow:['信息层级'],adjustments:['换为燕麦图形'],unknown:[]}})}}]});
    };
    const result=await analyzeDocument({docText:'燕麦发膜',options:{style:'auto'},reference:match});
    assert.deepEqual(result.referenceExplanation.adjustments,['换为燕麦图形']);
    assert.equal(result.product.name,'燕麦蛋白护发膜');
  }finally{
    globalThis.fetch=savedFetch;
    if(savedKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=savedKey;
  }
});

test('the plan model is called as a stream so the gateway never sees a silent 60 s wait', async () => {
  const {match}=await fixture();
  const savedFetch=globalThis.fetch,savedKey=process.env.LLM_API_KEY;
  process.env.LLM_API_KEY='test';
  try {
    let sentStream;
    globalThis.fetch=async(_url,init)=>{
      sentStream=JSON.parse(init.body).stream;
      // 把 SSE 切成任意字节块：既会切断一行，也会切断一个多字节汉字
      const text=JSON.stringify(brief).match(/[\s\S]{1,37}/g).map(c=>`data: ${JSON.stringify({choices:[{delta:{content:c}}]})}\n\n`).join('')+'data: [DONE]\n\n';
      const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{role:'assistant'}}]})}\n\n: keep-alive\n\n${text}`);
      return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=11)c.enqueue(bytes.slice(i,i+11));c.close();}}),{headers:{'content-type':'text/event-stream'}});
    };
    const result=await analyzeDocument({docText:'燕麦发膜',options:{style:'auto'},reference:match});
    assert.equal(sentStream,true);
    assert.equal(result.product.name,'燕麦蛋白护发膜');
    assert.equal(result.outer.structure,'单品折叠盒');
  }finally{
    globalThis.fetch=savedFetch;
    if(savedKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=savedKey;
  }
});

test('an incomplete brief from the plan model is retried instead of accepted as a hollow brief', async () => {
  const {match}=await fixture();
  const savedFetch=globalThis.fetch,savedKey=process.env.LLM_API_KEY;
  process.env.LLM_API_KEY='test';
  try {
    const hollow={...brief,outer:{},inner:{},kv:{}};
    let calls=0;
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify(calls++===0?hollow:brief)}}]});
    const result=await analyzeDocument({docText:'燕麦发膜',options:{style:'auto'},reference:match});
    assert.equal(calls,2);
    assert.equal(result.outer.structure,'单品折叠盒');
    assert.ok(result.outer.faces.front.content&&result.inner.faces.back.content&&result.kv.content);

    calls=0;
    globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(hollow)}}]});};
    await assert.rejects(analyzeDocument({docText:'燕麦发膜',options:{style:'auto'},reference:match}),e=>/不完整/.test(e.message)&&/外包装/.test(e.message));
    assert.equal(calls,6);
  }finally{
    globalThis.fetch=savedFetch;
    if(savedKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=savedKey;
  }
});

// 平行出图：JEV 在同一次判断里给出概率，取前几名不同品牌的参考
async function withJev(t, handler) {
  const savedFetch = globalThis.fetch, savedKey = process.env.JEV_API_KEY;
  process.env.JEV_API_KEY = 'test';
  globalThis.fetch = async (_url, init) => handler(JSON.parse(init.body));
  t.after(() => {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.JEV_API_KEY; else process.env.JEV_API_KEY = savedKey;
  });
}
const answer = (questions, entries) => Response.json({ model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, entries[id](q)])) });
const single = choice => q => ({ type: 'choice', choice, confidence: .9, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === choice ? 1 : 0])) });

test('parallel directions: top JEV pick first, then the next-most-probable references from other brands', async t => {
  const { products } = await loadCatalog();
  const brandOf = id => products.find(p => p.id === id)?.brand_id;
  let seen;
  await withJev(t, ({ questions }) => {
    if (questions.category) return answer(questions, { category: single('发膜'), form: single('unknown') });
    const ids = Object.keys(questions.reference.criteria).filter(k => k !== 'none');
    const top = ids[0];
    const sameBrand = ids.find(id => id !== top && brandOf(id) === brandOf(top));
    const others = [];
    for (const id of ids) if (![top, ...others].some(o => brandOf(o) === brandOf(id))) others.push(id);
    const [second, third, fourth] = others;
    assert.ok(second && third && fourth, 'the shortlist needs at least four brands for this scenario');
    seen = { top, sameBrand, second, third, fourth };
    // 同品牌的第二名概率高于其他品牌但品牌重复，第四个品牌排在前三之后，都不应入选
    const probs = { [top]: .4, ...(sameBrand ? { [sameBrand]: .25 } : {}), [second]: .15, [third]: .08, [fourth]: .02, none: .1 };
    return answer(questions, { reference: q => ({ type: 'choice', choice: top, confidence: .8, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, probs[k] ?? 0])) }) });
  });
  const directions = await matchDirections('燕麦蛋白护发膜，200g，浓稠膏霜，洗发后涂抹发梢并冲洗。');
  assert.deepEqual(directions.map(d => d.primary.id), [seen.top, seen.second, seen.third]);
  assert.deepEqual(directions.map(d => d.rank), [0, 1, 2]);
  assert.equal(new Set(directions.map(d => d.primary.brand)).size, 3);
  assert.equal(directions[1].probability, .15);
  assert.equal(directions[0].confidence, .8);
  assert.equal(directions[1].confidence, .15);
  assert.ok(directions.every(d => d.status === 'matched' && d.images.length));
  assert.ok(!directions.some(d => d.primary.id === seen.sameBrand || d.primary.id === seen.fourth));

  const two = await matchDirections('燕麦蛋白护发膜', '', { count: 2 });
  assert.equal(two.length, 2);
});

test('parallel directions still fill up with other brands when JEV is certain about one pick, and report no_match as one entry', async t => {
  const { products } = await loadCatalog();
  const brandOf = id => products.find(p => p.id === id)?.brand_id;
  let choice = 'cece-salon-smooth-shine-mask';
  await withJev(t, ({ questions }) => questions.category
    ? answer(questions, { category: single('发膜'), form: single('unknown') })
    : answer(questions, { reference: single(choice) }));
  // 首选概率 1、其余全是 0 时，其余候选仍按召回顺序补足，不会因为概率低而缩成单方向
  const three = await matchDirections('燕麦蛋白护发膜，200g。');
  assert.equal(three.length, 3);
  assert.equal(three[0].primary.id, 'cece-salon-smooth-shine-mask');
  assert.deepEqual(three.map(d => d.rank), [0, 1, 2]);
  assert.equal(new Set(three.map(d => brandOf(d.primary.id))).size, 3);
  assert.equal(three[1].probability, 0);

  const one = await matchDirections('燕麦蛋白护发膜，200g。', '', { count: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0].primary.id, 'cece-salon-smooth-shine-mask');

  choice = 'none';
  const none = await matchDirections('燕麦蛋白护发膜，200g。');
  assert.equal(none.length, 1);
  assert.equal(none[0].status, 'no_match');
});

// 库里雅诗兰黛、娇兰、兰蔻、祖玛珑的参考图是 AVIF；不转换就会在写简报之后才报「参考图路径无效」，方向被悄悄丢掉
const firstAsset = (products, id) => { const p = products.find(x => x.id === id); return [p, p.reference_assets.indexOf(assetsFor(p, 'style')[0])]; };
const withPngCache = async t => {
  const saved = process.env.REFERENCE_PNG_CACHE;
  process.env.REFERENCE_PNG_CACHE = await fs.mkdtemp(path.join(temp, 'png-cache-'));
  t.after(() => { if (saved === undefined) delete process.env.REFERENCE_PNG_CACHE; else process.env.REFERENCE_PNG_CACHE = saved; });
};

test('AVIF library references are converted to PNG before use, and oversized ones are shrunk', async t => {
  await withPngCache(t);
  const { products } = await loadCatalog();
  const [estee, index] = firstAsset(products, 'estee-3');
  const raw = await fs.readFile(await assetFile(estee.id, index));
  assert.equal(raw.subarray(4, 12).toString(), 'ftypavif', 'the fixture must really be an AVIF');
  let png;
  try { png = await assetBytes(estee.id, index); } catch (err) { if (/无法转换/.test(err.message)) return t.skip('本机没有 sips / ffmpeg'); throw err; }
  assert.equal(imageMime(png), 'image/png');
  assert.ok((await assetBytes(estee.id, index)).equals(png), 'the converted PNG is cached');

  // 超过 1.5 MB 的参考图（库里有 4–5 MB 的 PNG）缩小后再上传，否则提交请求在慢网络上会超时
  let checked = 0;
  for (const p of products.filter(x => x.default_auto_select !== false)) for (const a of assetsFor(p, 'style')) {
    const i = p.reference_assets.indexOf(a);
    const size = (await fs.stat(await assetFile(p.id, i))).size;
    if (size <= 1_500_000) continue;
    const shrunk = await assetBytes(p.id, i);
    assert.ok(shrunk.length < size && ['image/png', 'image/jpeg'].includes(imageMime(shrunk)), `${p.id} should be shrunk`);
    checked++;
  }
  assert.ok(checked > 0, 'the library should contain oversized references');
});

test('a candidate whose reference image cannot be prepared is skipped and the next brand takes its place', async t => {
  await withPngCache(t);
  const { products } = await loadCatalog();
  const brandOf = id => products.find(p => p.id === id)?.brand_id;
  const savedPath = process.env.PATH;
  process.env.PATH = ''; // 没有 sips / ffmpeg：AVIF 参考图无法转换
  t.after(() => { process.env.PATH = savedPath; });
  let seen;
  await withJev(t, ({ questions }) => {
    if (questions.category) return answer(questions, { category: single('精华'), form: single('unknown') });
    const ids = Object.keys(questions.reference.criteria).filter(k => k !== 'none');
    assert.ok(ids.includes('estee-3'), 'the scenario needs an AVIF-only candidate in the shortlist');
    const top = ids.find(id => brandOf(id) !== brandOf('estee-3'));
    const rest = [];
    for (const id of ids) if (![top, 'estee-3', ...rest].some(o => brandOf(o) === brandOf(id))) rest.push(id);
    seen = { top, rest };
    // estee-3 排第二，但它的参考图转不了；应由后面的品牌顶上，仍然凑满 3 个
    const probs = { [top]: .5, 'estee-3': .3, [rest[0]]: .1, [rest[1]]: .05, none: .05 };
    return answer(questions, { reference: q => ({ type: 'choice', choice: top, confidence: .8, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, probs[k] ?? 0])) }) });
  });
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  let directions;
  try { directions = await matchDirections('积雪草舒缓精华液，30ml×2，滴管瓶，敏感肌修护。'); } finally { console.warn = warn; }
  assert.equal(directions.length, 3);
  assert.deepEqual(directions.map(d => d.primary.id), [seen.top, seen.rest[0], seen.rest[1]]);
  assert.ok(!directions.some(d => d.primary.id === 'estee-3'));
  assert.ok(warned.some(w => /Estée Lauder/.test(w)), 'the skipped candidate is logged');
});

test('direction previews render only the outer front from each direction\'s own brief and reference, in parallel', async t => {
  const { project, match, ownBytes } = await fixture();
  const anchorBefore = (await getProject(project.id)).images.outer_front;
  await updateProject(project.id, p => {
    p.directions = ['d1', 'd2'].map((id, i) => ({
      id, rank: i, match: structuredClone(match),
      brief: { ...structuredClone(brief), product: { ...brief.product, name: `方向${i + 1}的护发膜` } },
      image: null,
    }));
    p.direction = { status: 'previewing', chosen: null };
  });
  const savedFetch = globalThis.fetch, savedKey = process.env.FAL_KEY;
  process.env.FAL_KEY = 'test';
  const submissions = [];
  let active = 0, peak = 0;
  t.after(() => { globalThis.fetch = savedFetch; if (savedKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = savedKey; });
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://queue.fal.run/')) {
      submissions.push(JSON.parse(init.body));
      peak = Math.max(peak, ++active);
      return Response.json({ status_url: 'https://stub.invalid/status', response_url: 'https://stub.invalid/result' });
    }
    if (url === 'https://stub.invalid/status') { await new Promise(r => setTimeout(r, 20)); return Response.json({ status: 'COMPLETED' }); }
    if (url === 'https://stub.invalid/result') { active--; return Response.json({ images: [{ url: 'https://stub.invalid/image.png' }] }); }
    if (url === 'https://stub.invalid/image.png') return new Response(ownBytes, { headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected network call: ${url}`);
  };
  await runDirections(project.id, ['d1', 'd2']);
  const after = await getProject(project.id);
  assert.equal(after.direction.status, 'choosing');
  assert.deepEqual(after.directions.map(d => d.image.status), ['done', 'done']);
  assert.ok(after.directions.every(d => d.image.file && d.image.versions.length === 1));
  assert.notEqual(after.directions[0].image.file, after.directions[1].image.file);
  assert.equal(submissions.length, 2);
  assert.equal(peak, 2, 'both previews must be in flight at the same time');
  assert.ok(submissions.some(s => s.prompt.includes('方向1的护发膜')) && submissions.some(s => s.prompt.includes('方向2的护发膜')));
  // 预览不依赖整套视图：只带用户素材和该方向的库参考图，不带已有的 outer_front 作为依赖
  assert.ok(submissions.every(s => s.image_urls.length === 2));
  assert.deepEqual(after.images.outer_front, anchorBefore, 'previews must not touch the project\'s own view slots');
});

test('a service restart leaves stale direction previews as retryable errors and unlocks choosing', async () => {
  const { project } = await fixture();
  await updateProject(project.id, p => {
    p.directions = [
      { id: 'd1', rank: 0, match: {}, brief: {}, image: { status: 'running', phase: 'IN_PROGRESS' } },
      { id: 'd2', rank: 1, match: {}, brief: {}, image: { status: 'done', file: 'images/x.png' } },
    ];
    p.direction = { status: 'previewing', chosen: null };
  });
  await recoverInterrupted(await getProject(project.id));
  const after = await getProject(project.id);
  assert.equal(after.direction.status, 'choosing');
  assert.equal(after.directions[0].image.status, 'error');
  assert.match(after.directions[0].image.error, /中断/);
  assert.equal(after.directions[1].image.status, 'done');
});
