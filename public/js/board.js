// 提案板：把简报与全部渲染图排成一张可直接发给客户的长图
const W = 2400;
const M = 140;
const GAP = 44;

const C = {
  paper: '#F3F6EF',
  paper2: '#E6EFE2',
  forest: '#22433A',
  jade: '#4A7A5F',
  ink2: '#3B5047',
  muted: '#6E8177',
  gold: '#B19353',
  goldSoft: '#D9C692',
  line: 'rgba(34,67,58,0.16)',
};

const F = {
  serif: '"Noto Serif SC", "Songti SC", serif',
  display: '"Bodoni Moda", "Didot", serif',
  label: '"Tenor Sans", "Avenir Next", sans-serif',
  mono: '"IBM Plex Mono", monospace',
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
};

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

// 中英文混排按字符宽度换行
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

function drawText(ctx, text, x, y, { font, color, spacing = 0, align = 'left', maxWidth, lineHeight, maxLines = 99 }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  setSpacing(ctx, spacing);
  const lines = maxWidth ? wrap(ctx, text, maxWidth).slice(0, maxLines) : [String(text || '')];
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * (lineHeight || 0)));
  setSpacing(ctx, 0);
  return lines.length * (lineHeight || 0);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function cropMarks(ctx, x, y, w, h, len = 26, off = 14) {
  ctx.strokeStyle = C.jade;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  const corners = [
    [x - off, y - off, 1, 1],
    [x + w + off, y - off, -1, 1],
    [x - off, y + h + off, 1, -1],
    [x + w + off, y + h + off, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawImageCard(ctx, img, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(34,67,58,0.22)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, x, y, w, h, 22);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, 22);
  ctx.clip();
  if (img) {
    // cover 裁切
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s;
    const ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = C.paper2;
    ctx.fillRect(x, y, w, h);
    drawText(ctx, '未生成', x + w / 2, y + h / 2, { font: `28px ${F.sans}`, color: C.muted, align: 'center' });
  }
  ctx.restore();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 22);
  ctx.stroke();
}

function groupHeader(ctx, y, code, cn, en, meta) {
  drawText(ctx, code, M, y + 92, { font: `500 120px ${F.display}`, color: C.forest });
  drawText(ctx, cn, M + 110, y + 50, { font: `600 50px ${F.serif}`, color: C.forest, spacing: 3 });
  drawText(ctx, en.toUpperCase(), M + 112, y + 92, { font: `22px ${F.label}`, color: C.jade, spacing: 6 });
  if (meta) drawText(ctx, meta, W - M, y + 88, { font: `26px ${F.sans}`, color: C.muted, align: 'right', maxWidth: 900, lineHeight: 36, maxLines: 1 });
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(M, y + 128);
  ctx.lineTo(W - M, y + 128);
  ctx.stroke();
  return 170;
}

export async function exportBoard(project, views) {
  await document.fonts.ready;
  const b = project.brief;
  const { product: p, design: d, outer, inner } = b;

  const imgs = {};
  await Promise.all(
    views.map(async (v) => {
      const img = project.images?.[v.id];
      if (img?.status === 'done') imgs[v.id] = await loadImg(img.file).catch(() => null);
    }),
  );

  const cell = (W - M * 2 - GAP * 2) / 3;
  const rowH = 170 + cell + 110;
  const hasKv = views.some((v) => v.id === 'kv');
  const kvH = (W - M * 2) * (9 / 16);
  const HEADER = 760;
  const FOOTER = 560;
  const H = HEADER + rowH * 2 + (hasKv ? 170 + kvH + 110 : 0) + FOOTER;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 底色与柔光
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, 1400);
  glow.addColorStop(0, 'rgba(210,229,208,0.95)');
  glow.addColorStop(1, 'rgba(210,229,208,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 1600);
  const glow2 = ctx.createRadialGradient(W, H * 0.6, 0, W, H * 0.6, 1200);
  glow2.addColorStop(0, 'rgba(217,198,146,0.18)');
  glow2.addColorStop(1, 'rgba(217,198,146,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  cropMarks(ctx, 60, 60, W - 120, H - 120, 40, 0);

  // ── 页眉 ──
  let y = M + 40;
  drawText(ctx, 'PACKAGING DESIGN PROPOSAL  ·  包装设计提案', M, y, { font: `24px ${F.label}`, color: C.jade, spacing: 7 });
  drawText(ctx, `N° ${project.id.toUpperCase()}`, W - M, y, { font: `22px ${F.mono}`, color: C.gold, align: 'right' });

  const leftW = 1180;
  y += 90;
  drawText(ctx, [p.brand, p.brandEn].filter(Boolean).join('  ·  ').toUpperCase(), M, y, { font: `26px ${F.label}`, color: C.jade, spacing: 6 });
  y += 30;
  const nameH = drawText(ctx, p.name, M, y + 110, { font: `700 104px ${F.serif}`, color: C.forest, spacing: 4, maxWidth: leftW, lineHeight: 128, maxLines: 2 });
  y += nameH + 40;
  drawText(ctx, p.tagline, M, y + 40, { font: `44px ${F.serif}`, color: C.jade, spacing: 8, maxWidth: leftW, lineHeight: 60, maxLines: 1 });
  y += 100;
  drawText(ctx, p.summary, M, y + 30, { font: `28px ${F.sans}`, color: C.ink2, maxWidth: leftW, lineHeight: 48, maxLines: 3 });

  // 概念卡
  const cx = M + leftW + 80;
  const cw = W - M - cx;
  const cy = M + 110;
  const ch = 520;
  ctx.save();
  ctx.shadowColor = 'rgba(34,67,58,0.35)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;
  roundRect(ctx, cx, cy, cw, ch, 28);
  const cg = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
  cg.addColorStop(0, '#2D5548');
  cg.addColorStop(1, '#1A352D');
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(217,198,146,0.35)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, cx + 16, cy + 16, cw - 32, ch - 32, 18);
  ctx.stroke();
  drawText(ctx, 'DESIGN CONCEPT', cx + 56, cy + 84, { font: `20px ${F.label}`, color: C.goldSoft, spacing: 6 });
  drawText(ctx, d.conceptName, cx + 56, cy + 160, { font: `600 58px ${F.serif}`, color: '#F4ECD2', spacing: 6, maxWidth: cw - 112, lineHeight: 70, maxLines: 1 });
  drawText(ctx, d.style, cx + 56, cy + 214, { font: `26px ${F.sans}`, color: C.goldSoft, maxWidth: cw - 112, lineHeight: 36, maxLines: 1 });
  drawText(ctx, d.concept, cx + 56, cy + 280, { font: `24px ${F.sans}`, color: 'rgba(232,239,229,0.85)', maxWidth: cw - 112, lineHeight: 42, maxLines: 5 });

  // 色板
  const py = cy + ch + 50;
  const sw = Math.min(150, (cw - 20 * (d.palette.length - 1)) / Math.max(1, d.palette.length));
  d.palette.slice(0, 7).forEach((c, i) => {
    const sx = cx + i * (sw + 20);
    roundRect(ctx, sx, py, sw, 64, 14);
    ctx.fillStyle = c.hex;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.stroke();
    drawText(ctx, c.hex, sx, py + 96, { font: `18px ${F.mono}`, color: C.muted });
  });

  // ── 三视图 ──
  y = HEADER;
  const rows = [
    { group: 'outer', code: 'A', cn: '外包装三视图', en: 'Outer Packaging · Orthographic Set', meta: [outer.structure, outer.dimensions].filter(Boolean).join(' · ') },
    { group: 'inner', code: 'B', cn: '内包装三视图', en: 'Inner Packaging · Orthographic Set', meta: inner.structure },
  ];
  for (const row of rows) {
    y += groupHeader(ctx, y, row.code, row.cn, row.en, row.meta);
    views
      .filter((v) => v.group === row.group)
      .forEach((v, i) => {
        const x = M + i * (cell + GAP);
        drawImageCard(ctx, imgs[v.id], x, y, cell, cell);
        drawText(ctx, v.code, x + 4, y + cell + 62, { font: `22px ${F.mono}`, color: C.gold });
        drawText(ctx, v.label.split(' · ')[1] || v.label, x + 90, y + cell + 62, { font: `600 32px ${F.serif}`, color: C.forest, spacing: 2 });
        drawText(ctx, (v.en.split(' · ')[1] || '').toUpperCase(), x + cell, y + cell + 62, { font: `18px ${F.label}`, color: C.muted, spacing: 5, align: 'right' });
      });
    y += cell + 110;
  }

  if (hasKv) {
    y += groupHeader(ctx, y, 'C', '主视觉全家福', 'Hero Key Visual', '16 : 9');
    drawImageCard(ctx, imgs.kv, M, y, W - M * 2, kvH);
    y += kvH + 110;
  }

  // ── 规格页脚 ──
  ctx.strokeStyle = C.line;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(M, y);
  ctx.lineTo(W - M, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 70;

  const colW = (W - M * 2 - GAP * 2) / 3;
  const cols = [
    { t: '结构与尺寸', en: 'Structure', body: [`外包装：${outer.structure}`, outer.dimensions && `尺寸：${outer.dimensions}`, `内包装：${inner.structure}`, inner.unit && `内装主体：${inner.unit}${inner.dimensions ? `（${inner.dimensions}）` : ''}`, inner.items && `内含：${inner.items}`] },
    { t: '材质与工艺', en: 'Craft', body: [d.materials, d.finishes.length && `工艺：${d.finishes.join(' / ')}`, d.typography && `字体：${d.typography}`] },
    { t: '产品档案', en: 'Profile', body: [...p.specs.slice(0, 5).map((s) => `${s.label}：${s.value}`), p.audience && `人群：${p.audience}`] },
  ];
  cols.forEach((col, i) => {
    const x = M + i * (colW + GAP);
    drawText(ctx, col.t, x, y, { font: `600 32px ${F.serif}`, color: C.forest, spacing: 2 });
    drawText(ctx, col.en.toUpperCase(), x + colW, y, { font: `18px ${F.label}`, color: C.gold, spacing: 5, align: 'right' });
    let ly = y + 60;
    for (const line of col.body.filter(Boolean)) {
      const h = drawText(ctx, line, x, ly, { font: `23px ${F.sans}`, color: C.ink2, maxWidth: colW, lineHeight: 38, maxLines: 3 });
      ly += h + 10;
      if (ly > y + 330) break;
    }
  });

  // 落款 + 色标条
  const fy = H - M + 10;
  drawText(ctx, `电商图工作台  ·  ${new Date().toLocaleDateString('zh-CN')}  ·  AI Packaging Proposal`, M, fy, { font: `22px ${F.label}`, color: C.muted, spacing: 3 });
  ['#00A0E9', '#E4007F', '#FFF100', '#1A1A1A', C.forest, '#86AC92', '#B3D1B6', C.gold].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(W - M - (8 - i) * 34, fy - 20, 34, 20);
  });

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name || '包装设计'}-提案板.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
