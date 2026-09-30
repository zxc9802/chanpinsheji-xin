// 文档解析：把用户上传的各种格式统一抽成纯文本
import path from 'node:path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';

const MAX_CHARS = 40000;

const decodeXmlEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

async function parsePdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function parseDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value || '';
}

// pptx：逐页读取 <a:t> 文本节点
async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const pages = [];
  for (const f of slides) {
    const xml = await zip.file(f).async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    if (texts.length) pages.push(texts.join(' '));
  }
  return pages.map((p, i) => `【第${i + 1}页】${p}`).join('\n');
}

// xlsx：读取共享字符串表即可覆盖绝大多数文字内容
async function parseXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return '';
  const xml = await file.async('string');
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1])).join('\n');
}

const stripHtml = (html) =>
  decodeXmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );

export async function extractText(buffer, originalName = '') {
  const ext = path.extname(originalName).toLowerCase();
  let text;
  switch (ext) {
    case '.pdf':
      text = await parsePdf(buffer);
      break;
    case '.docx':
      text = await parseDocx(buffer);
      break;
    case '.pptx':
      text = await parsePptx(buffer);
      break;
    case '.xlsx':
      text = await parseXlsx(buffer);
      break;
    case '.html':
    case '.htm':
      text = stripHtml(buffer.toString('utf8'));
      break;
    case '.doc':
    case '.ppt':
    case '.xls':
      throw new Error(`暂不支持旧版 ${ext} 格式，请另存为 ${ext}x 或 PDF 后再上传`);
    default:
      // txt / md / csv / json 等纯文本
      text = buffer.toString('utf8');
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('没有从文档中读到文字内容（扫描版 PDF 需要先做文字识别）');
  return { text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS, chars: text.length };
}
