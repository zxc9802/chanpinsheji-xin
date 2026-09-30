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
  cache.set(id, project);
  await persist(id);
  return project;
}

export async function getProject(id) {
  if (!isValidId(id)) return null;
  if (cache.has(id)) return cache.get(id);
  try {
    const project = JSON.parse(await fs.readFile(projectFile(id), 'utf8'));
    cache.set(id, project);
    return project;
  } catch {
    return null;
  }
}

function persist(id) {
  const prev = writeChains.get(id) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const project = cache.get(id);
      if (!project) return;
      const tmp = projectFile(id) + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(project, null, 2));
      await fs.rename(tmp, projectFile(id));
    });
  writeChains.set(id, next);
  return next;
}

export async function updateProject(id, mutator) {
  const project = await getProject(id);
  if (!project) throw new Error('项目不存在');
  mutator(project);
  project.updatedAt = Date.now();
  await persist(id);
  return project;
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
      conceptName: p.brief?.design?.conceptName || '',
      palette: p.brief?.design?.palette?.slice(0, 5) || [],
      cover: p.images?.kv?.file || p.images?.outer_front?.file || p.directions?.find((d) => d.image?.file)?.image.file || null,
      doneCount: Object.values(p.images || {}).filter((img) => img.status === 'done').length,
      picking: ['previewing', 'choosing'].includes(p.direction?.status),
    }));
}

export async function saveFile(id, sub, filename, buffer) {
  const file = path.join(projectDir(id), sub, filename);
  await fs.writeFile(file, buffer);
  return `/files/${id}/${sub}/${filename}`;
}

export function localPathFromPublic(publicPath) {
  const m = publicPath?.match(/^\/files\/([^/]+)\/(refs|images)\/([^/]+)$/);
  if (!m || !isValidId(m[1])) return null;
  return path.join(DATA_DIR, m[1], m[2], m[3]);
}
