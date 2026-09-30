// 图像提示词构建：设计简报 + 视角镜头规范 + 一致性约束 → 最终提示词
import { referencePrompt } from './references.js';

// stage 决定生成顺序：先定调正视图，再以它为参考延展侧视、背视，保证三视图是同一件包装
export const VIEWS = [
  { id: 'outer_front', group: 'outer', face: 'front', code: 'A-01', label: '外包装 · 正视图', en: 'Outer · Front', stage: 1, deps: [] },
  { id: 'outer_side', group: 'outer', face: 'side', code: 'A-02', label: '外包装 · 侧视图', en: 'Outer · Side', stage: 2, deps: ['outer_front'] },
  { id: 'outer_back', group: 'outer', face: 'back', code: 'A-03', label: '外包装 · 背视图', en: 'Outer · Back', stage: 2, deps: ['outer_front'] },
  { id: 'inner_front', group: 'inner', face: 'front', code: 'B-01', label: '内包装 · 正视图', en: 'Inner · Front', stage: 2, deps: ['outer_front'] },
  { id: 'inner_side', group: 'inner', face: 'side', code: 'B-02', label: '内包装 · 侧视图', en: 'Inner · Side', stage: 3, deps: ['inner_front'] },
  { id: 'inner_back', group: 'inner', face: 'back', code: 'B-03', label: '内包装 · 背视图', en: 'Inner · Back', stage: 3, deps: ['inner_front'] },
  { id: 'kv', group: 'kv', face: null, code: 'C-01', label: '主视觉 · 全家福', en: 'Key Visual', stage: 3, deps: ['outer_front', 'inner_front'] },
];

export const viewById = (id) => VIEWS.find((v) => v.id === id);

const CAMERA = {
  outer_front:
    'Straight-on orthographic FRONT ELEVATION of the closed outer package in its natural resting orientation. Camera exactly level with the centre of the front panel, zero perspective distortion, only the front face visible, perfectly symmetrical framing. The package is centred with even margins, filling about 75% of the frame in its limiting direction, resting on the floor of the set with a soft natural contact shadow.',
  outer_side:
    'Straight-on orthographic SIDE ELEVATION (right-hand side panel) of the SAME closed outer package, same resting orientation as the front view. Camera level and perpendicular to the side panel, zero perspective, only the side panel visible. Centred with even margins, soft contact shadow.',
  outer_back:
    'Straight-on orthographic BACK ELEVATION (rear panel) of the SAME closed outer package, same resting orientation as the front view, seen from the exact opposite side. Camera level with the centre of the rear panel, zero perspective, only the back face visible, centred with even margins, soft contact shadow.',
  inner_front:
    'Straight-on orthographic FRONT ELEVATION of the INNER UNIT on its own: the primary container taken OUT of the outer package and standing upright on the floor of the set. Show one single unit, facing the camera. No outer box, no lid, no insert tray anywhere in the frame. Camera level with its centre, zero perspective, centred with generous margins, soft contact shadow.',
  inner_side:
    'Straight-on orthographic SIDE ELEVATION of the SAME inner unit, rotated 90° from the front view so its side profile and side printing face the camera. One single unit standing on its own; no outer box, no lid, no insert tray. Camera level, zero perspective, centred with generous margins, soft contact shadow.',
  inner_back:
    'Straight-on orthographic BACK ELEVATION of the SAME inner unit, rotated 180° from the front view so its rear side and rear printing face the camera. One single unit standing on its own; no outer box, no lid, no insert tray. Camera level, zero perspective, centred with generous margins, soft contact shadow.',
  kv:
    'Luxurious hero key visual for the packaging launch. Show the closed outer package at an elegant three-quarter angle together with the opened package revealing the inner packaging, arranged as a refined still life. Cinematic yet soft lighting, gentle shallow depth of field, editorial commercial product photography, wide 16:9 composition with generous breathing room.',
};

const FACE_EN = { front: 'front', side: 'side', back: 'back' };
const FACE_ZH = { front: '正面', side: '侧面', back: '背面' };

// 外包装每一视角只允许出现「这一面的外盒」。参考图和简报里常出现瓶身、泵头、泡沫，
// 不显式排除的话，模型会把内装和多视图拼图一起画进来。
const outerScope = (face) =>
  `ONLY ONE OBJECT IN THE FRAME: the closed outer carton, seen from its ${FACE_EN[face]} panel alone. The image must NOT contain: the bottle, container, pump or any inner product; physical foam, droplets or other contents; any other face or angle of the carton (no side, back, top or three-quarter view); a second carton; a multi-view sheet, contact sheet, collage, grid or thumbnail strip; captions or view labels of any kind (e.g. "外盒 正面", "FRONT", "SIDE"). Nothing stands, leans or lies beside, in front of or behind the carton — only the empty backdrop and the carton's own contact shadow. Foam, water and other motifs may appear solely as flat printed artwork on the carton surface. Wherever this brief mentions a bottle, pump or inner container (materials, backdrop, references), that is background information for other views: do not draw it here.`;

// 内包装每一视角只允许出现「内装主体本身」。参考图、外包装正视图和简报里常出现外盒、盒盖、内托，
// 不显式排除的话，模型会把外盒和内装画在同一张图里。
const innerScope = (face) =>
  `ONLY ONE OBJECT IN THE FRAME: the inner unit on its own, seen from its ${FACE_EN[face]} side alone. The image must NOT contain: the outer carton, box, sleeve, lid or insert tray (not even partly, blurred or in the background); a second unit; any other side or angle of the unit; a multi-view sheet, contact sheet, collage, grid or thumbnail strip; captions or view labels of any kind. Nothing stands, leans or lies beside, in front of or behind the unit — only the empty backdrop and the unit's own contact shadow. Wherever this brief mentions the outer carton, its lid, insert tray or how the unit sits inside the package, that is background information for other views: do not draw it here.`;

const SINGLE_VIEW = 'Output exactly one image showing exactly one view — never a multi-view layout, contact sheet or collage, and no view captions.';

// 解析「宽 × 深 × 高 mm」或「Ø直径 × 高 mm」，拿不到就返回 null
export function parseDims(str = '') {
  const s = String(str).replace(/，/g, ',');
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n > 0);
  if (/[Øø⌀Φφ]|直径|dia/i.test(s) && nums.length >= 2) return { cyl: true, d: nums[0], h: nums[1] };
  if (nums.length >= 3) return { w: nums[0], d: nums[1], h: nums[2] };
  return null;
}

const ratioText = (a, b) => {
  const r = a / b;
  if (Math.abs(r - 1) < 0.06) return 'a square 1 : 1 face';
  return r > 1 ? `a landscape ${r.toFixed(2)} : 1 face (wider than tall)` : `a portrait 1 : ${(1 / r).toFixed(2)} face (taller than wide)`;
};

// 把尺寸换算成这个视角下画面里应呈现的宽高比，防止三视图各画各的
function geometryLine(dimsStr, face, subject) {
  const g = parseDims(dimsStr);
  if (!g) return '';
  if (g.cyl) {
    return `Geometry: the ${subject} is a cylinder Ø${g.d} × ${g.h} mm; in this view its silhouette is ${g.d} mm wide × ${g.h} mm tall — ${ratioText(g.d, g.h)}. Keep this exact proportion.`;
  }
  const [a, b, what] = {
    front: [g.w, g.h, 'the front face spans'],
    side: [g.d, g.h, 'the side face spans'],
    back: [g.w, g.h, 'the back face spans'],
  }[face];
  const axis = `${a} mm wide × ${b} mm tall`;
  return `Geometry: the ${subject} measures ${g.w} × ${g.d} × ${g.h} mm (width × depth × height); in this view ${what} ${axis} — ${ratioText(a, b)}. Keep this exact proportion; never stretch the package to fill the frame.`;
}

const RENDER_QUALITY =
  'Photorealistic high-end commercial studio product photography, softbox lighting with rim light, subtle reflection where appropriate to the specified surface, clean palette-matched backdrop, sharp crisp print and detailed paperboard textures. Respect the specified materials, backdrop and finishes; add foil, emboss, spot-UV or glitter only when requested. No watermark, no annotations, no dimension lines, no text or labels outside the packaging itself, no UI or mockup frame.';

const quote = (arr) => arr.map((t) => `"${t}"`).join(' / ');

const paletteLine = (palette) =>
  palette.map((c) => `${c.name ? c.name + ' ' : ''}${c.hex}${c.role ? ` (${c.role})` : ''}`).join(', ');

/**
 * @param {object} brief 设计简报
 * @param {string} viewId
 * @param {{ depRefs: string[], userRefCount: number, extra?: string }} ctx
 *   depRefs: 作为一致性参考传入的已生成视角 id（按传入顺序）
 */
export function buildPrompt(brief, viewId, { depRefs = [], userRefCount = 0, referenceMatch = null, extra = '' } = {}) {
  const view = viewById(viewId);
  const { product: p, design: d, outer, inner, kv } = brief;
  const parts = [];

  parts.push(CAMERA[viewId]);
  if (view.group === 'outer') parts.push(outerScope(view.face));
  else if (view.group === 'inner') parts.push(innerScope(view.face));

  if (viewId === 'outer_front') {
    parts.push('The main display panel features the brand, a prominent product headline, a short subline and a stunning hero illustration built from the product-related motifs. Make the headline and hero artwork recognisable at thumbnail size, with substantial graphic forms, visible texture and deliberate tonal or colour contrast against the base. Botanical or gentle product attributes do not require faint curves or decorative hairlines. Printed artwork may depict photorealistic ingredients, liquid or dimensional forms, but stays entirely on the package surface, never as physical props. Explicit user requests for minimalist, text-only or low-contrast design take precedence; library descriptions alone are not such requests.');
  }

  const productName = [p.brandEn || p.brand, p.nameEn].filter(Boolean).join(' — ');
  parts.push(`Product: ${productName}${p.name ? ` (${p.brand ? p.brand + ' ' : ''}${p.name})` : ''}${p.category ? `, category: ${p.category}` : ''}.`);

  const innerUnit = inner.unitEn || inner.unit;
  // 内包装视角只写内装主体：外盒结构和「内装如何放进外盒」的描述会把外盒带进画面
  if (view.group !== 'inner') {
    const outerStructure = outer.structureEn || outer.structure || 'a single closed rectangular folding carton (paperboard box) in natural portrait orientation';
    parts.push(`Outer package structure: ${outerStructure}${outer.dimensions ? `, dimensions ${outer.dimensions} (width × depth × height)` : ''}.`);
  }
  if (view.group === 'kv' || (view.group === 'inner' && !innerUnit)) {
    parts.push(`Inner packaging: ${inner.structureEn || inner.structure}${inner.items ? `. Contents: ${inner.items}` : ''}.`);
  }
  if (view.group === 'inner' && innerUnit) {
    parts.push(`The inner unit shown in this view: ${innerUnit}${inner.dimensions ? `, ${inner.dimensions}` : ''}.`);
  }
  const geo =
    view.group === 'outer'
      ? geometryLine(outer.dimensions, view.face, 'outer package')
      : view.group === 'inner'
        ? geometryLine(inner.dimensions, view.face, 'inner unit')
        : '';
  if (geo) parts.push(geo);

  if (d.visualStyleEn) parts.push(`Art direction: ${d.visualStyleEn}`);
  if (d.palette.length) parts.push(`Colour palette — use strictly and consistently: ${paletteLine(d.palette)}.`);
  if (d.materials) parts.push(`Materials: ${d.materials}.`);
  if (d.finishes.length) parts.push(`Print finishes: ${d.finishes.join(', ')}.`);
  if (d.motifs) parts.push(`Graphic motifs: ${d.motifs}.`);
  if (d.typography) parts.push(`Typography: ${d.typography}.`);

  if (view.face) {
    const face = brief[view.group].faces[view.face];
    if (face.content || face.promptEn) {
      parts.push(`Face design — Chinese composition and English rendering notes; honour edits to either without repeating elements: ${[face.content, face.promptEn].filter(Boolean).join('\n')}`);
    }
    if (face.text.length) {
      parts.push(
        `Text printed on this face — render exactly as written, sharp, correctly spelled, with accurate Chinese characters and refined typographic hierarchy: ${quote(face.text)}.`,
      );
    }
  } else {
    if (kv.sceneEn) parts.push(`Scene: ${kv.sceneEn}`);
    if (kv.content) parts.push(`Scene notes from the designer (Chinese): ${kv.content}`);
    const heroText = [p.brand, p.name, p.tagline].filter(Boolean);
    if (heroText.length) parts.push(`The brand and product name on the packaging must stay legible: ${quote(heroText)}.`);
  }

  parts.push(`Backdrop: ${d.backdropEn}.`);

  // Input order: generated views, own product/logo, then library research images.
  const refNotes = [];
  depRefs.forEach((depId, i) => {
    const dep = viewById(depId);
    refNotes.push(
      dep.group === view.group
        ? `image ${i + 1} is the approved ${dep.en.toUpperCase()} view`
        : `image ${i + 1} is the approved ${dep.en.toUpperCase()} view — take only brand identity, logo, colours and graphics from it; do NOT draw its ${dep.group === 'outer' ? 'outer carton' : 'inner unit'} in this image`,
    );
  });
  if (userRefCount) {
    const from = depRefs.length + 1;
    const to = depRefs.length + userRefCount;
    refNotes.push(
      `${from === to ? `image ${from} is` : `images ${from}–${to} are`} the client's own product photo / logo — reproduce the logo faithfully${view.group === 'outer' ? '; do NOT draw the product itself in this outer-carton view' : ' and depict the real product shape accurately'}`,
    );
  }
  if (referenceMatch) {
    const noContainer = view.group === 'outer'
      ? '; it may show a bottle or other container — take only colour, typography and hierarchy from it and do NOT draw any container in this outer-carton view'
      : view.group === 'inner'
        ? '; it may show an outer carton or other items — take only colour, typography and hierarchy from it and do NOT draw any carton, box or extra object in this inner-unit view'
        : '';
    referenceMatch.images.forEach((asset, i) => {
      refNotes.push(`image ${depRefs.length + userRefCount + i + 1} is a LIBRARY RESEARCH EXAMPLE (${asset.role}), limited to: ${asset.scope || 'the selected product only'}. Borrow approved design relationships, NEVER copy its brand name, logo, product claims or printed quantities${noContainer}`);
    });
    parts.push(referencePrompt(referenceMatch, brief, view.group === 'outer'
      ? { scope: `仅外包装${FACE_ZH[view.face]}的单张正投影图：画面里只有这一面的外盒，不含容器、瓶身、补充装或其他视图`, singleSubject: true }
      : view.group === 'inner'
        ? { scope: `仅内包装主体${FACE_ZH[view.face]}的单张正投影图：画面里只有内装主体本身，不含外盒、盒盖、内托或其他视图`, singleSubject: true, subject: 'inner' }
        : {}));
  }
  if (depRefs.length) {
    parts.push(
      `Reference images: ${refNotes.join('; ')}. The approved generated views lock THIS new packaging system — preserve its brand identity, logo, typography, colours, graphics, materials and finishes from the specified viewpoint. Library examples are design inspiration and must never override this new identity.`,
    );
  } else if (userRefCount || referenceMatch?.images.length) {
    parts.push(`Reference images: ${refNotes.join('; ')}. Use the approved design relationships and the adaptation notes for THIS product. The new brief controls the artwork and hierarchy; do not let the example's empty space, thin graphics or muted contrast override those adaptations.`);
  } else {
    parts.push('The input image is a blank placeholder canvas — ignore it completely and create the design from scratch.');
  }

  if (extra?.trim()) parts.push(`Revision request from the art director (highest priority): ${extra.trim()}`);

  if (view.face) parts.push(SINGLE_VIEW);
  parts.push(RENDER_QUALITY);
  return parts.join('\n\n');
}
