// Reproduce the analysis chain in a separate process; leave the running app and project unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { extractText } from '../lib/parse.js';
import { matchReferences, assetFile } from '../lib/references.js';
import { analyzeDocument, designRequirements } from '../lib/llm.js';

process.loadEnvFile('.env');
const [projectId, documentFile] = process.argv.slice(2);
if (!/^[a-z0-9-]{6,40}$/i.test(projectId || '')) throw new Error('Usage: node scripts/profile-analysis.mjs PROJECT_ID [DOCUMENT_PATH]');
const project = JSON.parse(await fs.readFile(path.join('data/projects', projectId, 'project.json'), 'utf8'));
const report = { projectId, startedAt: new Date().toISOString(), documentChars: project.docText.length, phases: [], requests: [] };
const outDir = path.join('data/diagnostics', `${projectId}-${Date.now()}`);
await fs.mkdir(outDir, { recursive: true });
const save = () => fs.writeFile(path.join(outDir, 'timings.json'), JSON.stringify(report, null, 2));
const log = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

// Log metadata only: never credentials, request prompts, product text or raw error bodies.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const request = JSON.parse(options.body || '{}');
  const endpoint = new URL(url);
  const stage = request.questions?.category ? 'jev_classify'
    : request.questions?.reference ? 'jev_select' : 'brief_model';
  const row = { stage, model: request.model, endpoint: `${endpoint.origin}${endpoint.pathname}`, startedAt: new Date().toISOString() };
  report.requests.push(row);
  log({ event: 'request_start', stage, model: row.model, request: report.requests.length });
  const start = performance.now();
  let response;
  try {
    response = await realFetch(url, options);
    row.headersMs = Math.round(performance.now() - start);
    row.httpStatus = response.status;
  } catch (error) {
    row.totalMs = Math.round(performance.now() - start);
    row.errorType = error.name;
    await save();
    log({ event: 'request_failed', ...row });
    throw error;
  }
  const read = async (asJson) => {
    const text = await response.text();
    row.totalMs = Math.round(performance.now() - start);
    row.bodyMs = row.totalMs - row.headersMs;
    row.responseBytes = Buffer.byteLength(text);
    let data;
    try { data = JSON.parse(text); } catch { /* Record invalid JSON without logging its contents. */ }
    row.usage = data?.usage;
    row.finishReason = data?.choices?.[0]?.finish_reason;
    row.outputChars = data?.choices?.[0]?.message?.content?.length;
    row.reasoningChars = data?.choices?.[0]?.message?.reasoning_content?.length;
    log({ event: 'request_done', ...row });
    await save();
    return asJson ? JSON.parse(text) : text;
  };
  return new Proxy(response, { get(target, property) {
    if (property === 'json') return () => read(true);
    if (property === 'text') return () => read(false);
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};

async function phase(name, fn) {
  log({ event: 'phase_start', name });
  const start = performance.now();
  try { return await fn(); }
  finally {
    const entry = { name, ms: Math.round(performance.now() - start) };
    report.phases.push(entry);
    log({ event: 'phase_done', ...entry });
    await save();
  }
}

const start = performance.now();
try {
  const text = documentFile
    ? (await phase('document_extract', async () => extractText(await fs.readFile(documentFile), path.basename(documentFile)))).text
    : project.docText;
  const reference = await phase('reference_match', () => matchReferences(text, designRequirements(project.options)));
  if (reference.status !== 'matched') throw new Error('No reference matched');
  reference.designRequirements = designRequirements(project.options);
  report.reference = { id: reference.primary.id, ms: reference.ms, expandedSearch: reference.expandedSearch };
  const brief = await phase('brief_generation', () => analyzeDocument({ docText: text, options: project.options, reference }));
  await phase('reference_snapshot', async () => {
    for (const [i, image] of reference.images.entries()) {
      await fs.copyFile(await assetFile(image.productId, image.index), path.join(outDir, `reference-${i}${path.extname(image.path)}`));
    }
  });
  await phase('brief_save', () => fs.writeFile(path.join(outDir, 'brief.json'), JSON.stringify(brief, null, 2)));
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.errorType = error.name;
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  report.totalMs = Math.round(performance.now() - start);
  report.completedAt = new Date().toISOString();
  report.briefAttempts = report.requests.filter(r => r.stage === 'brief_model').length;
  await save();
  log({ event: 'profile_saved', file: path.resolve(outDir, 'timings.json'), totalMs: report.totalMs, status: report.status });
}
