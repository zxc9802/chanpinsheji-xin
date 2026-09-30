// 图片生成：fal.ai 队列接口（提交 → 轮询 → 取结果）
import zlib from 'node:zlib';

const QUEUE_BASE = 'https://queue.fal.run';
const POLL_INTERVAL = 2500;
const TIMEOUT = 12 * 60 * 1000;
// 提交请求要把参考图（base64）整体上传，网络慢或三个方向同时提交时，60 秒不够
const SUBMIT_TIMEOUT = 180_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const authHeaders = () => {
  if (!process.env.FAL_KEY) throw new Error('未配置 FAL_KEY');
  return { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' };
};

// edit 模型必须带参考图；没有任何参考时，用一张浅色空白画布占位
let blankCanvas;
export function blankCanvasDataUri() {
  if (blankCanvas) return blankCanvas;
  const w = 64;
  const h = 64;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0).fill(Buffer.from([244, 247, 241]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  blankCanvas = `data:image/png;base64,${png.toString('base64')}`;
  return blankCanvas;
}

async function falFetch(url, init = {}, timeoutMs = 60_000) {
  let res, text;
  try {
    res = await fetch(url, { ...init, headers: { ...authHeaders(), ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (err) {
    // 不向用户抛英文的 "The operation was aborted due to timeout"
    if (err.name === 'TimeoutError') throw new Error(`图片模型 ${timeoutMs / 1000} 秒内没有响应，请检查网络后重试`);
    throw err;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body).slice(0, 300);
    const err = new Error(`图片模型请求失败（${res.status}）：${detail}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * 生成一张图，返回远程图片 URL
 * @param {{prompt:string, imageUrls:string[], imageSize:string|object, quality:string, onStatus?:(s:string)=>void}} input
 */
export async function generateImage({ prompt, imageUrls, imageSize = 'square_hd', quality = 'high', onStatus }) {
  const model = process.env.IMAGE_MODEL || 'openai/gpt-image-2.5/sunburst/edit';
  const submitted = await falFetch(`${QUEUE_BASE}/${model}`, {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls.length ? imageUrls : [blankCanvasDataUri()],
      image_size: imageSize,
      quality,
      num_images: 1,
      output_format: 'png',
      background: 'opaque',
    }),
  }, SUBMIT_TIMEOUT);
  const { status_url: statusUrl, response_url: responseUrl } = submitted;
  if (!statusUrl || !responseUrl) throw new Error('图片模型没有返回任务地址');

  const deadline = Date.now() + TIMEOUT;
  let lastStatus;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    let status;
    try {
      status = await falFetch(statusUrl);
    } catch (err) {
      // 轮询偶发网络错误不致命，继续等
      if (err.status && err.status < 500 && err.status !== 429) throw err;
      continue;
    }
    if (status.status !== lastStatus) {
      lastStatus = status.status;
      onStatus?.(status.status);
    }
    if (status.status === 'COMPLETED') {
      const result = await falFetch(responseUrl);
      const url = result.images?.[0]?.url;
      if (!url) throw new Error(`图片模型没有返回图片：${JSON.stringify(result).slice(0, 200)}`);
      return url;
    }
  }
  throw new Error('图片生成超时');
}
