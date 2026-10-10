import { getProject, updateProject } from './store.js';

export const IMAGE_POINTS = 30;
export const billingPending = (img) => ['reserve_pending', 'reserved', 'settle_pending', 'release_pending'].includes(img?.billing?.state);

// 只在服务器间传递项目所属账号；价格固定在主站，客户端不能指定金额。
export async function imageBillingAction(action, billing) {
  const secret = process.env.SSO_CLIENT_SECRET;
  if (!secret && process.env.NODE_ENV !== 'production') return { chargeRequired: false, requiredPoints: 0, chargedPoints: 0 };
  if (!secret || !billing.userId) throw new Error('图片扣费配置或项目所属账号缺失，请联系管理员');
  const main = (process.env.MAIN_APP_URL || 'https://www.qycm.top').replace(/\/+$/, '');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${main}/api/external-sso/chanpinsheji/billing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-qycm-sso-client-secret': secret },
        body: JSON.stringify({ action, requestId: billing.requestId, userId: billing.userId }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw Object.assign(new Error(typeof body.error === 'string' ? body.error : body.error?.message || '主站积分服务暂时不可用'), { status: res.status, code: body.code || body.error?.code });
      return body.data;
    } catch (err) {
      if (attempt >= 2 || (err.status && err.status < 500 && err.status !== 429)) throw err;
    }
  }
}

export async function finishImageBilling(projectId, slot) {
  const image = slot.get(await getProject(projectId));
  const billing = image.billing;
  const result = billing.chargeRequired ? await imageBillingAction('settle', billing) : { chargedPoints: 0 };
  await updateProject(projectId, (p) => {
    const previous = slot.get(p);
    const version = { ...billing.pendingResult, billing: { requestId: billing.requestId, chargedPoints: result.chargedPoints } };
    slot.set(p, { ...previous, ...billing.pendingResult, status: 'done', phase: 'COMPLETED', error: null, finishedAt: Date.now(),
      versions: [...(previous.versions || []), version],
      billing: { requestId: billing.requestId, userId: billing.userId, state: 'settled', chargedPoints: result.chargedPoints } });
  });
}

export async function releaseImageBilling(projectId, slot) {
  const image = slot.get(await getProject(projectId));
  if (image.billing.chargeRequired !== false) await imageBillingAction('release', image.billing);
  await updateProject(projectId, (p) => {
    const previous = slot.get(p);
    slot.set(p, { ...previous, status: 'error', phase: 'FAILED', finishedAt: Date.now(),
      error: previous.error || '服务重启，任务中断，请重绘', billing: { ...previous.billing, state: 'released' } });
  });
}

export async function reconcileProjectBilling(project, { interrupted = false, isRendering = () => false } = {}) {
  const slots = [];
  for (const id of Object.keys(project.images || {})) slots.push({ key: `${project.id}:${id}`, get: p => p.images[id], set: (p, img) => { p.images[id] = img; } });
  for (const d of project.directions || []) slots.push({ key: `${project.id}:dir:${d.id}`, get: p => p.directions.find(x => x.id === d.id).image, set: (p, img) => { p.directions.find(x => x.id === d.id).image = img; } });
  for (const group of ['commerce', 'commerceAlt']) for (const id of Object.keys(project[group]?.images || {})) {
    slots.push({ key: `${project.id}:c:${id}`, get: p => p[group].images[id], set: (p, img) => { p[group].images[id] = img; } });
  }
  for (const slot of slots) {
    const img = slot.get(project);
    if (!billingPending(img) || isRendering(slot.key)) continue;
    try {
      if (img.billing.state === 'settle_pending') await finishImageBilling(project.id, slot);
      else if (interrupted || img.billing.state === 'release_pending') await releaseImageBilling(project.id, slot);
    } catch (err) {
      console.error('[image-billing]', img.billing.requestId, err.message);
      await updateProject(project.id, (p) => {
        const previous = slot.get(p);
        slot.set(p, { ...previous, status: 'running', phase: previous.billing.state === 'settle_pending' ? 'BILLING' : 'REFUNDING',
          billing: { ...previous.billing, state: previous.billing.state === 'settle_pending' ? 'settle_pending' : 'release_pending' } });
      });
    }
  }
}
