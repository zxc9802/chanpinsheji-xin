// 详情长图：把详情图的每一屏按顺序无缝拼成一张竖长图（浏览器里合成，和提案板一样不经过服务器）
export const LONG_WIDTH = 750; // 淘宝 / 天猫详情页的标准宽度
const MAX_HEIGHT = 30000; // 浏览器画布高度的安全上限

function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('有一张图加载失败，请刷新后再试'));
    img.src = src;
  });
}

export async function composeLong(urls, { width = LONG_WIDTH } = {}) {
  const imgs = await Promise.all(urls.map(load));
  const heights = imgs.map((img) => Math.round((img.naturalHeight * width) / img.naturalWidth));
  const height = heights.reduce((a, b) => a + b, 0);
  if (!height) throw new Error('没有可以合成的图片');
  if (height > MAX_HEIGHT) throw new Error(`长图高度 ${height}px 超过浏览器上限，请减少屏数`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = 'high';
  let y = 0;
  imgs.forEach((img, i) => {
    g.drawImage(img, 0, y, width, heights[i]);
    y += heights[i];
  });
  return { canvas, width, height, count: imgs.length };
}

export const canvasBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('长图导出失败'))), type, quality));
