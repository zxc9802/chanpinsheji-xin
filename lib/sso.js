import crypto from 'node:crypto';

export function canAccessProject(project, user) {
  return !user || project.ownerUserId === user.id;
}

export function installSso(app, { mainAppUrl = process.env.MAIN_APP_URL || 'https://www.qycm.top',
  secret = process.env.SSO_CLIENT_SECRET, secure = process.env.NODE_ENV === 'production',
  fetchImpl = fetch } = {}) {
  const main = mainAppUrl.replace(/\/+$/, '');
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  const prefix = secure ? '__Host-' : '';
  const sessionCookie = `${prefix}qy_design_session`;
  const stateCookie = `${prefix}qy_design_state`;
  const key = crypto.createHash('sha256').update(secret || '').digest();
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((part) => {
    const i = part.indexOf('=');
    return [part.slice(0, i).trim(), part.slice(i + 1)];
  }));
  function seal(session) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  function unseal(value) {
    try {
      const bytes = Buffer.from(value || '', 'base64url');
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      const session = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]));
      return session.token && session.expiresAt > Date.now() ? session : null;
    } catch { return null; }
  }
  async function mainRequest(path, options) {
    const response = await fetchImpl(`${main}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok || !body.success) {
      throw Object.assign(new Error('主站登录已失效，请重新登录'), { statusCode: response.status === 401 || response.status === 403 || response.status === 410 ? 401 : 503 });
    }
    return body.data;
  }
  const unavailable = (res) => res.status(503).json({ error: '登录服务暂时不可用，请稍后重试' });

  app.use('/api/sso', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (!secret) return unavailable(res);
    next();
  });
  app.get('/api/sso/start', (req, res) => {
    const state = crypto.randomBytes(32).toString('base64url');
    res.cookie(stateCookie, state, { ...cookieOptions, maxAge: 10 * 60 * 1000 });
    const url = new URL('/home2', main);
    url.searchParams.set('externalSso', 'chanpinsheji');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  });
  app.get('/api/sso/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const expected = cookies(req)[stateCookie] || '';
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state) || state.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
      return res.status(400).send('登录链接已失效，请从主站重新打开产品设计智能体。');
    }
    res.clearCookie(stateCookie, cookieOptions);
    if (typeof req.query.ticket !== 'string' || !req.query.ticket) return res.status(400).send('登录票据缺失，请从主站重新打开。');
    try {
      const data = await mainRequest('/api/external-sso/chanpinsheji/exchange', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-qycm-sso-client-secret': secret },
        body: JSON.stringify({ ticket: req.query.ticket }),
      });
      const expiresAt = Math.min(Number(data.expiresAt), Date.now() + 8 * 60 * 60 * 1000);
      if (!data.token || !data.user?.id || !(expiresAt > Date.now())) throw new Error('登录响应无效');
      res.cookie(sessionCookie, seal({ token: data.token, expiresAt }), { ...cookieOptions, maxAge: expiresAt - Date.now() });
      res.redirect('/');
    } catch {
      res.status(401).send('登录未完成，请从主站重新打开产品设计智能体。');
    }
  });

  app.use(async (req, res, next) => {
    const pagePath = ['/', '/index', '/index.html'].includes(req.path);
    const protectedPath = pagePath || req.path.startsWith('/api/') || req.path.startsWith('/files/');
    if (!protectedPath || req.path === '/api/health') return next();
    if (!secret) return secure ? unavailable(res) : next();
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
      try {
        if (new URL(req.get('origin')).host !== req.get('host')) return res.status(403).json({ error: '请求来源无效' });
      } catch { return res.status(403).json({ error: '请求来源无效' }); }
    }
    const session = unseal(cookies(req)[sessionCookie]);
    if (session) {
      try {
        const data = await mainRequest('/api/sso/session', { headers: { Authorization: `Bearer ${session.token}` } });
        if (!data.user?.id) return unavailable(res);
        req.ssoUser = data.user;
        return next();
      } catch (err) {
        if (err.statusCode !== 401) return unavailable(res);
      }
    }
    res.clearCookie(sessionCookie, cookieOptions);
    if (pagePath) return res.redirect('/api/sso/start');
    res.status(401).json({ error: '请先登录主站', loginUrl: '/api/sso/start' });
  });
  app.get('/api/session', (req, res) => res.json({ user: req.ssoUser || null, mainAppUrl: main }));
}
