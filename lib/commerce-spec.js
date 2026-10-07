// 主图内容规格。详情图使用 commerce-detail.js 的固定结构与原版提示词。
// 依据 zxc9802/dianputu 的 10 屏详情页与 5 张主图规格整理：每屏一个页面任务、一个主视觉、
// 固定的产品占比、必须出现与禁止出现的元素。这里只规定内容，不规定风格：
// 配色、材质、光线、字体气质与版式一律来自 JEV 选定的参考库系统与版式参考图。
//
// 规格按「版位:屏型」索引。

const NO_EXTRAS = 'decorative plants, corner or hanging leaves, blurred foreground foliage, leaf or window shadows, light spots, light beams, floating shapes, corner ornaments, meaningless icons, filler textures';

export const SPECS = {
  // ───────── 主图（货架上抢点击：产品大、卖点狠、证据短、信息少） ─────────
  'main:hero': {
    label: '首图', share: '45–55%', copyMax: 4, people: false,
    write: '抢点击。主标题只打一个最强卖点，取自「产品优势」，≤12 字，不要写品名；辅助标签 2–4 个，每个≤8 字，写优势短语或规格容量，不要写品类名、形态描述这类不是卖点的话。',
    task: 'win the click on the shelf: within 0.3 seconds the shopper knows what this is and its single strongest selling point',
    visual: 'the product as the largest subject, sitting in a full, rich commercial-photography set (a surface that carries it, strong rim light, believable reflection and volume), one big headline and a few small tags',
    must: ['the product, large and fully visible', 'ONE big headline, clearly larger than every other text', '2-4 small tags'],
    mustNot: ['an ingredient list', 'usage steps', 'paragraphs of text', 'a tiny product', 'a large empty background', 'a pretty picture that does not say what is being sold'],
    contrast: 'the product is the loudest thing in the frame, everything else is quiet',
  },
  'main:white': {
    label: '白底图', share: '70–85%', copyMax: 0, people: false, plain: true,
    write: '',
    task: 'platform compliance and product recognition: the shopper sees the real pack clearly',
    visual: 'a pure white (#FFFFFF) background, the product centred and completely shown with clean edges, at most a very faint natural contact shadow',
    must: ['the product exactly as in the product images, every label, logo and word unchanged'],
    mustNot: ['any added text', 'people', 'water drops', 'plants', 'light effects', 'stickers or badges', 'gradients', 'props', 'a coloured background', 'blank or erased labels'],
  },
  'main:ingredient': {
    label: '次图·成分', share: '10–25%', copyMax: 3, people: false,
    write: '快速解释配方亮点，不是成分表。主标题点出配方亮点（≤12 字）；最多 3 个成分，每条写「成分名＋一句作用」（≤16 字），作用只用资料里写的，资料没写作用就只写成分名。只挑资料当作亮点的成分，不挑乳化剂、防腐剂、溶剂等配角。',
    task: 'explain in one glance what is special about the formula (this is not the detail-page ingredient screen)',
    visual: 'macro photography of the named raw ingredients (petals, seeds, leaves, droplets, cross-sections) as the main visual, in a split or a card layout with the ingredient names beside it; the product small in a corner or absent',
    must: ['the named ingredients as the main visual', 'each ingredient name with at most one short effect label'],
    mustNot: ['a full ingredient list', 'more than 3 ingredients', 'effect percentages or charts', 'usage steps', 'people', 'drug-like claims', 'the hero layout of a centred product with text around it'],
    contrast: 'a raw ingredient close-up against the finished product',
  },
  'main:benefit': {
    label: '次图·效果', share: '20–35%', copyMax: 3, people: true,
    write: '让人看到使用收益。主标题一个收益（取自「产品优势」，≤12 字）；辅助文字 1–3 条体验型短语。资料里没有的数字一律不写，不写百分比。',
    task: 'show the benefit and a sense of result',
    visual: 'the product beside one small local contrast card (a close-up of the surface the product works on: skin patch, hair strand, fabric, a make-up smear and so on, before versus after), taking about a quarter to a third of the frame',
    must: ['the product', 'the headline', 'ONE local before/after or sensory contrast, clearly an illustration'],
    mustNot: ['invented percentages, charts or dashboards', 'medical or treatment-style before/after', 'exaggerated face-swap transformations', 'a pretty face with no visible change', 'ingredient lists', 'usage steps'],
    contrast: 'before versus after on one small local area',
  },
  'main:mechanism': {
    label: '次图·效果', share: '20–35%', copyMax: 3, people: false,
    write: '用一个机制讲清楚效果。主标题写效果本身（≤12 字，取自「原理说明」）；辅助文字 1–3 条，每条对应一个阶段，≤14 字。只用资料写到的原理。',
    task: 'show in one glance how the product achieves its effect',
    visual: 'one simplified concept schematic of 2-3 stages of how it works (for example a substance changing state), drawn as a clear illustration, with the product small beside it',
    must: ['the product', 'the 2-3 stage schematic', 'the headline'],
    mustNot: ['measured data, percentages or charts', 'ingredient lists', 'usage steps', 'a busy diagram with many arrows'],
    contrast: 'the state before the mechanism versus the state after it',
  },
  'main:scene': {
    label: '次图·场景', share: '15–30%', copyMax: 2, people: true,
    write: '建立代入感。主标题写使用时机或适用人群（≤12 字，取自「使用场景」或「目标人群」）；辅助文字至多 2 条。',
    task: 'let the shopper picture themselves using it',
    visual: 'a believable real-life use situation (a vanity, mirror, bathroom counter, morning or evening routine) in natural window light, hands or an ordinary person doing the real action, the product clearly visible',
    must: ['the product clearly visible and not hidden by a hand or prop', 'a real use action or setting'],
    mustNot: ['charts or data', 'ingredient lists', 'long text', 'a messy home background', 'a selfie look', 'exaggerated poses or expressions'],
    contrast: 'the product in the setting where it is actually used',
  },
  'main:usage': {
    label: '次图·用法', share: '15–30%', copyMax: 2, people: true,
    write: '主图不是步骤图：只画一个最关键的使用动作。主标题写这个动作或使用时机（≤12 字）；辅助文字至多 2 条。',
    task: 'let the shopper picture how it is used, through ONE key action (this is not a step list)',
    visual: 'one real use action in natural window light (hands taking, applying or pouring), in a clean real setting, the product clearly visible',
    must: ['the product clearly visible', 'one real use action'],
    mustNot: ['a multi-step list', 'charts or data', 'ingredient lists', 'a messy background', 'a selfie look'],
    contrast: 'the product and the single action that uses it',
  },

};

// 出图时用的版位:屏型 → 规格
export function specFor(kind, role) {
  return SPECS[`${kind}:${role}`];
}

// 图上不能印的话：资料里的「尚未 / 待定 / 打样」之类是给设计师看的限制，不是卖点；价格也不上图
export const UNPRINTABLE = /尚未|未验证|未确认|未经|未提供|待(?:定|补|确认|验证|测|完善)|暂无|暂未|没有(?:测试|结论|数据|验证)|无(?:测试|结论|数据)|打样|研发阶段|试制|备案|预期零售|零售价|售价|定价|价格|人民币|[¥￥]/;
export const printable = (s) => !UNPRINTABLE.test(String(s));

const numbersIn = (s) => String(s).match(/\d+(?:\.\d+)?\s*[%％]?/g)?.map((n) => n.replace(/\s/g, '').replace('％', '%')) || [];
export const unsupportedNumbers = (s, docText) => {
  const known = new Set(numbersIn(docText));
  return numbersIn(s).some((n) => !known.has(n));
};

export const SUBTRACTION = `VISUAL SUBTRACTION (final rule): keep only elements that carry this screen's information task. Nothing is allowed just to make the picture richer: no ${NO_EXTRAS}. Keep the whitespace clean. Elements that are the screen's own subject (the named ingredient, the pain close-up, the steps, the product) are allowed, and a soft real light and a real surface are fine.`;

// 减法只减陪衬，不减色彩层次；白底图没有参考图，不需要这一句
export const TONAL_KEEP = "Subtraction removes props and ornaments, never tonal structure: the design template's colour fields, gradients, light falloff and surface depth stay.";
