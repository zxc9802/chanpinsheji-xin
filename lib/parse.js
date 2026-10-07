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
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, n) => {
      const code = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/&nbsp;/g, ' ')
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
    const texts = [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    if (texts.length) pages.push(`【第${f.match(/slide(\d+)/)[1]}页】${texts.join(' ')}`);
  }
  return pages.join('\n');
}

// 按工作表单元格读取；共享字符串只是字典，不能代替数据本身。
async function parseXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('xl/sharedStrings.xml');
  const textNodes = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1])).join('');
  const shared = file ? [...(await file.async('string')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textNodes(m[1])) : [];
  const sheets = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const lines = [];
  for (const sheet of sheets) {
    const xml = await zip.file(sheet).async('string');
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((cell) => {
        const type = cell[1].match(/\bt="([^"]+)"/)?.[1];
        const body = cell[2] || '';
        const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || '';
        if (type === 'inlineStr') return textNodes(body);
        if (type === 's') return shared[Number(value)] || '';
        return decodeXmlEntities(value);
      });
      if (cells.some(Boolean)) lines.push(cells.join('\t'));
    }
  }
  return lines.join('\n');
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
    case '.txt':
    case '.md':
    case '.markdown':
    case '.csv':
    case '.json':
      text = buffer.toString('utf8');
      break;
    default:
      throw new Error(`暂不支持 ${ext || '无扩展名'} 文档，请上传 PDF、DOCX、PPTX、XLSX 或纯文本文件`);
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('没有从文档中读到文字内容（扫描版 PDF 需要先做文字识别）');
  return { text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS, chars: text.length };
}
