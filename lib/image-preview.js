import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const pending = new Map();
let queue = Promise.resolve();

export async function imagePreview(local) {
  const target = path.join(path.dirname(local), 'previews', path.basename(local) + '.jpg');
  try { await fs.access(target); return target; } catch {}
  if (!pending.has(local)) {
    const job = queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = target + '.' + crypto.randomUUID() + '.jpg';
      try {
        await run('ffmpeg', [
          '-v', 'error', '-nostdin', '-i', local,
          '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease",
          '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '4', '-pix_fmt', 'yuvj420p', '-threads', '1', '-y', temp,
        ], { timeout: 20000 });
        await fs.rename(temp, target);
        return target;
      } finally {
        await fs.rm(temp, { force: true });
        pending.delete(local);
      }
    });
    pending.set(local, job);
    queue = job;
  }
  return pending.get(local);
}
