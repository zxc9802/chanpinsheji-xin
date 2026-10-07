// 项目持久化：每个项目一个目录 data/projects/<id>/，包含 project.json、参考图与渲染图
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve('data/projects');

const projectDir = (id) => path.join(DATA_DIR, id);
const projectFile = (id) => path.join(projectDir(id), 'project.json');
const isValidId = (id) => /^[a-z0-9-]{6,40}$/i.test(id);

// 同一项目的写操作串行化，避免并发生成时互相覆盖
const cache = new Map();
const writeChains = new Map();
const loads = new Map();

export function newId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

export async function createProject(data) {
  const id = newId();
  await fs.mkdir(path.join(projectDir(id), 'refs'), { recursive: true });
  await fs.mkdir(path.join(projectDir(id), 'images'), { recursive: true });
  const project = { id, createdAt: Date.now(), updatedAt: Date.now(), ...data };
  await persist(id, project);
  cache.set(id, project);
  return project;
}

export async function getProject(id) {
  if (!isValidId(id)) return null;
  if (cache.has(id)) return cache.get(id);
  if (!loads.has(id)) {
    loads.set(id, fs.readFile(projectFile(id), 'utf8').then((text) => {
      const project = JSON.parse(text);
      cache.set(id, project);
      return project;
    }).catch(() => null).finally(() => loads.delete(id)));
  }
  return loads.get(id);
}

function serialize(id, task) {
  const prev = writeChains.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  writeChains.set(id, next);
  const release = () => { if (writeChains.get(id) === next) writeChains.delete(id); };
  next.then(release, release);
  return next;
}

async function persist(id, project) {
  const tmp = projectFile(id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(project, null, 2));
  await fs.rename(tmp, projectFile(id));
}

export function updateProject(id, mutator) {
  return serialize(id, async () => {
    const project = await getProject(id);
    if (!project) throw new Error('项目不存在');
    const draft = structuredClone(project);
    mutator(draft);
    draft.updatedAt = Date.now();
    await persist(id, draft);
    // 写盘成功后再发布到缓存，同时保留调用者持有的项目对象。
    for (const key of Object.keys(project)) if (!Object.hasOwn(draft, key)) delete project[key];
    Object.assign(project, draft);
    return project;
  });
}

export function deleteProject(id) {
  if (!isValidId(id)) throw new Error('项目不存在');
  return serialize(id, async () => {
    await loads.get(id);
    await fs.rm(projectDir(id), { recursive: true, force: true });
    cache.delete(id);
  });
}

export async function listProjects() {
  let entries = [];
  try {
    entries = await fs.readdir(DATA_DIR);
  } catch {
    return [];
  }
  const projects = await Promise.all(entries.filter(isValidId).map((id) => getProject(id)));
  return projects
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      name: p.brief?.product?.name || p.source?.name || '未命名项目',
      brand: p.brief?.product?.brand || '',
      conceptName: p.brief?.design?.conceptName || (p.kind === 'commerce' ? '产品图直出套图' : ''),
      palette: p.brief?.design?.palette?.slice(0, 5) || [],
      cover: p.images?.kv?.file || p.images?.outer_front?.file || p.directions?.find((d) => d.image?.file)?.image.file || Object.values(p.commerce?.images || {}).find((img) => img.status === 'done' && img.file)?.file || p.commerce?.inputs?.[0]?.file || null,
      doneCount: [...Object.values(p.images || {}), ...Object.values(p.commerce?.images || {})].filter((img) => img.status === 'done').length,
      picking: ['previewing', 'choosing'].includes(p.direction?.status),
    }));
}

export async function saveFile(id, sub, filename, buffer) {
  const file = path.join(projectDir(id), sub, filename);
  await fs.writeFile(file, buffer);
  return `/files/${id}/${sub}/${filename}`;
}

export function localPathFromPublic(publicPath) {
  const m = typeof publicPath === 'string' && publicPath.match(/^\/files\/([^/]+)\/(refs|images)\/([^/]+)$/);
  if (!m || !isValidId(m[1]) || !/^[a-z0-9][a-z0-9_.-]*$/i.test(m[3])) return null;
  return path.join(DATA_DIR, m[1], m[2], m[3]);
}
