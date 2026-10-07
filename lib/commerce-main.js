import { readFileSync } from 'node:fs';
import { printable, unsupportedNumbers } from './commerce-spec.js';
import { normalizeProductInfo } from './commerce-detail.js';

export const MAIN_PROMPTS = JSON.parse(readFileSync(new URL('./dianputu-main-prompts.json', import.meta.url), 'utf8'));
export const MAIN_LAYOUT = MAIN_PROMPTS.layout;
const ROLES = { main_white_bg: 'white', main_hero_selling_point: 'hero', main_ingredient: 'ingredient', main_effect: 'benefit', main_usage_scene: 'scene' };
const COPY_MAX = { main_white_bg: 0, main_hero_selling_point: 2, main_ingredient: 2, main_effect: 1, main_usage_scene: 1 };
const clean = (v, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const strings = (v, limit = 5, max = 100) => Array.isArray(v) ? v.map((s) => clean(s, max)).filter(Boolean).slice(0, limit) : [];
const numbered = (v, fallback = '无已确认资料；只使用本屏已确认信息，不补造产品事实。') => v.length ? v.map((s, i) => `${i + 1}. ${s}`).join('\n') : fallback;

export function mainPlanningInstructions() {
  return `【固定主图结构】
严格按 dianputu 的 5 张模块和顺序分配产品资料，不得合并、删减、扩充：
${MAIN_LAYOUT.modules.map((id, i) => `${i + 1}. ${id}｜${MAIN_PROMPTS.modules[id].name}｜${MAIN_PROMPTS.modules[id].description}｜最多 ${COPY_MAX[id]} 条辅助文字`).join('\n')}
白底图不加标题或文案，只保留上传产品并换纯白背景；首图用一句话卖点和产品大图；成分图以最多 2 个已确认成分微距为主，产品缩小辅助；效果图突出使用收益，有真实数据才显示数据；场景图以一个实际使用动作或已确认生活场景为主。
资料不足也保留 5 张，用已确认信息减少文字密度，缺失内容写入 missing_evidence。成分不明不能猜成分或原料；效果不明不能猜功效、编造百分比或实测前后对比；用法不明不能猜使用步骤。不要把缺失提醒印到图上。
每张返回 module_id、page_task、required_content、headline（≤24 字）、copy（短标签，≤30 字）、visual（构图）、images（产品图编号，从 1 开始）。
返回 main_layout_brief：{screen_count:5, missing_evidence:[], modules:[...]}。`;
}

export function normalizeMainPlan(raw, { identity, productName, docText }) {
  const brief = raw.main_layout_brief;
  if (!brief || Number(brief.screen_count) !== MAIN_LAYOUT.modules.length) throw new Error('主图规划必须返回固定的 5 张主图');
  const modules = Array.isArray(brief.modules) ? brief.modules : [];
  const byId = new Map(modules.map((m) => [m?.module_id, m]));
  if (modules.length !== MAIN_LAYOUT.modules.length || byId.size !== MAIN_LAYOUT.modules.length || MAIN_LAYOUT.modules.some((id) => !byId.has(id))) throw new Error('主图模块缺失、重复或不属于固定结构，请按完整模块 ID 列表重新规划');
  const supported = (s) => printable(s) && (docText === undefined || !unsupportedNumbers(s, docText));
  const copyText = (v, max) => { const s = clean(v, max); return supported(s) ? s : ''; };
  const slots = MAIN_LAYOUT.modules.map((id, index) => {
    const source = byId.get(id);
    const module = MAIN_PROMPTS.modules[id];
    const white = id === 'main_white_bg';
    const images = Array.isArray(source.images) ? source.images.filter((n) => Number.isInteger(n) && n >= 1 && n <= identity.length) : [];
    const headline = white ? '' : copyText(source.headline, 24) || (id === 'main_hero_selling_point' ? productName : module.name);
    return {
      id: `main_${String(index + 1).padStart(2, '0')}`, kind: 'main', moduleId: id,
      role: ROLES[id], referenceRole: ROLES[id], roleLabel: module.name,
      title: module.name, purpose: clean(source.page_task) || module.description, headline,
      copy: white ? [] : [...new Set(strings(source.copy, 8, 30).filter((s) => supported(s) && s !== headline))].slice(0, COPY_MAX[id]),
      copyMax: COPY_MAX[id], requiredContent: strings(source.required_content).filter(supported),
      visual: white ? '纯白背景，产品居中完整展示，不新增文字、道具或装饰。' : clean(source.visual),
      identityInputs: [...new Set(white ? [identity[images[0] ? images[0] - 1 : 0].id] : images.length ? images.map((n) => identity[n - 1].id) : identity.map((i) => i.id))],
    };
  });
  return { mainLayout: { id: MAIN_LAYOUT.id, name: MAIN_LAYOUT.name, screenCount: slots.length }, promptSource: MAIN_PROMPTS.source,
    productInfo: normalizeProductInfo(raw.product_info, { productName, docText }),
    mainBrief: { missingEvidence: strings(brief.missing_evidence, 10, 300) }, slots };
}

export function buildMainPrompt({ project, slot, identity, refCount, anchor, extra = '' }) {
  const plan = project.commerce.plan;
  const module = MAIN_PROMPTS.modules[slot.moduleId];
  if (!module || !plan.mainLayout) throw new Error('此主图方案缺少固定模块，请重新规划');
  const info = plan.productInfo;
  const system = plan.system;
  const white = slot.role === 'white';
  const values = {
    product_name: info.product_name, category: info.category, spec: info.spec,
    ...Object.fromEntries(['core_selling_points', 'functions', 'target_users', 'usage_method'].map((key) => [key, numbered(info[key] || [])])),
    ingredients: numbered((info.ingredients || []).slice(0, 2).map((x) => `${x.name}${x.benefit ? `：${x.benefit}` : ''}`)),
    effects: numbered((info.effect_claims || []).map((x) => `${x.claim}${x.value ? `；数值：${x.value}` : ''}；依据：${x.source_type}`), '未提供真实效果数据；仅表达资料支持的体验，不生成百分比、测量图表或实测结论。'),
    layout_brief: `【主图结构】\n${plan.mainLayout.name}，固定 ${plan.mainLayout.screenCount} 张。`,
    screen_brief: white ? '【本屏内容】\n只保留原始产品及包装已有文字，换纯白背景。' : `【当前屏专属信息】\n- 页面任务：${slot.purpose}\n- 用户确认的本屏文案优先，替代先前规划文案。\n- 主标题：${slot.headline}\n- 辅助文案：\n${numbered(slot.copy, '不新增辅助文案。')}\n- 构图：${slot.visual}`,
    screen_index: plan.slots.filter((s) => s.kind === 'main').findIndex((s) => s.id === slot.id) + 1,
    screen_count: plan.mainLayout.screenCount,
    style_name: (system.style || []).join(' / '), style_color: Array.isArray(system.colors) ? system.colors.join(' / ') : system.colors || '从参考图提取',
    style_keywords: (system.style || []).join(' / '), style_visual: system.visual || '',
    style_layout: '白底图独立；其余主图分别按首图、成分、效果、使用场景的固定模块构图，保持材质、光影和字体层级一致。',
  };
  const replace = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`主图提示词缺少字段：${key}`);
    return String(values[key]);
  });
  if (!white) values.style_section = replace(MAIN_PROMPTS.styles[refCount ? 'targeted' : anchor ? 'global' : 'none']).replaceAll('Gemini 对标', '参考库对标');
  const inputs = [`【实际输入图片】\n第 1–${identity.length} 张：同一产品身份参考，${identity.map((i) => i.label).join('、')}。保留产品外形、品牌、标签及包装文字。`];
  if (!white && refCount) inputs.push(`第 ${identity.length + 1}–${identity.length + refCount} 张：本屏版式参考（${slot.reference.title}），只借排版、色调、光影和氛围，不带入来源品牌、商品、文字、数字或证言。`);
  if (!white && anchor) inputs.push(`第 ${identity.length + refCount + 1} 张：本套首图，只参考产品身份、材质、光影和字体层级，不复制其构图和文字。`);
  return [replace(module.prompt.join('\n')), ...inputs,
    white ? '【本屏输出边界】\n纯白背景（#FFFFFF），只保留原产品，所有包装文字按原图保留；禁止添加任何文字或装饰。' : `【本屏输出边界：优先于模板示例】\n图上新增文案仅逐字使用以下已确认文字，不自行扩写；产品包装文字按原图保留：\n${[slot.headline, ...slot.copy].filter(Boolean).join('\n')}\n事实、成分、功效、使用方法及数字只取自已确认资料。模板中的原料、肌肤、场景和动作只是构图示例，按实际产品品类与已确认信息选择。没有已确认成分时不用具体原料暗示成分；没有真实效果证据时不用实测前后对比、数字、进度条或仪表盘，改用已知体验与短标签。`,
    '【输出要求】\n只输出当前一张，1:1 正方形主图，不生成多图拼版或详情长图。',
    extra.trim() ? `【用户本次重绘要求】\n${extra.trim()}\n应用本次修改，保持当前模块职责、产品身份和事实边界；白底图仍须纯白且不添加文字或装饰。` : '',
  ].filter(Boolean).join('\n\n');
}
