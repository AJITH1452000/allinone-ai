// Office mode — accounts, sessions, approvals and permissions. Default: ONLY the owner can log in; nobody else gets in
// without the owner's approval (with permissions + an expiry). Passwords: bcrypt (cost 12). Owner: password + TOTP.
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { DATA_DIR } from '../paths.js';
import { OFFICE, HTTPS_ON, readJson, writeJson, system, saveSystem, audit, readAudit, verifyAudit, clientIp, limited, queueStatus, netLog, SAFE_ID } from './core.js';

export const PERMS = ['chat', 'upload', 'kb', 'code', 'projects', 'export'];
const users = () => readJson('users.json', []);
const saveUsers = (u) => writeJson('users.json', u);
const requests = () => readJson('requests.json', []);
const saveRequests = (r) => writeJson('requests.json', r);
const sessions = () => readJson('sessions.json', {});
const saveSessions = (s) => writeJson('sessions.json', s);
const notices = () => readJson('notices.json', []);
const notify = (text) => writeJson('notices.json', [{ at: new Date().toISOString(), text }, ...notices()].slice(0, 200));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = () => crypto.randomBytes(8).toString('hex');
const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
const publicUser = (u) => u && ({ id: u.id, username: u.username, name: u.name, role: u.role, perms: u.role === 'owner' ? Object.fromEntries(PERMS.map((p) => [p, true])) : u.perms,
  models: u.role === 'owner' ? ['*'] : u.models, expiresAt: u.expiresAt || null, consentTraining: !!u.consentTraining });
export const userDir = (id) => { if (!SAFE_ID.test(String(id))) throw new Error('bad id'); return path.join(DATA_DIR, 'users', id); };
const expired = (u) => u.role !== 'owner' && u.expiresAt && Date.parse(u.expiresAt) < Date.now();
const strong = (pw) => typeof pw === 'string' && pw.length >= 12;

// ---------- sessions ----------
function createSession(res, user, req) {
  const id = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(32).toString('hex');
  const s = sessions();
  s[sha(id)] = { userId: user.id, csrf, created: Date.now(), last: Date.now(), ip: clientIp(req) };
  saveSessions(s);
  res.setHeader('Set-Cookie', `evx_sid=${id}; Path=/; HttpOnly; SameSite=Strict${HTTPS_ON ? '; Secure' : ''}`);
  return csrf;
}
function endSessions(filter) { const s = sessions(); for (const [k, v] of Object.entries(s)) if (filter(v)) delete s[k]; saveSessions(s); }

/** Attaches req.user / req.session (or nothing). Enforces idle + absolute timeouts, expiry, suspension and the lock. */
export function sessionMiddleware(req, res, next) {
  const id = cookieOf(req).evx_sid;
  if (!id) return next();
  const s = sessions(), key = sha(id), sess = s[key];
  if (!sess) return next();
  const sys = system();
  const now = Date.now();
  const u = users().find((x) => x.id === sess.userId);
  const dead = !u || now - sess.last > (sys.idleMin || 30) * 60_000 || now - sess.created > (sys.absHours || 12) * 3_600_000
    || u.status !== 'active' || expired(u) || (sys.locked && u.role !== 'owner');
  if (dead) { delete s[key]; saveSessions(s); if (u && expired(u)) audit('user-expired', { user: u.username }); return next(); }
  if (now - sess.last > 30_000) { sess.last = now; saveSessions(s); }
  req.user = u; req.session = sess; req.sessionKey = key;
  next();
}
const OPEN = /^\/api\/office\/(status|login|setup|setup\/confirm|request-access|invite\/[\w-]+)$/;
/** In office mode every /api route needs a session (except login/setup/request-access/invite) + CSRF on state changes */
export function gate(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (OPEN.test(req.path)) return next();
  if (!req.user) return res.status(401).json({ error: 'Please log in.', auth: true });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-CSRF-Token') !== req.session.csrf) return res.status(403).json({ error: 'Security check failed (CSRF). Reload the page.' });
  if (req.user.role !== 'owner' && !['GET', 'HEAD'].includes(req.method) && limited(`rate:${req.user.id}`, 30, 60_000)) return res.status(429).json({ error: 'Too many requests — max 30 per minute. Wait a moment.' });
  next();
}
export const ownerOnly = (req, res, next) => (req.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this.', askOwner: true }));
/** 403 + "Ask the owner" when the user lacks a permission */
export function can(req, perm) { return req.user?.role === 'owner' || !!req.user?.perms?.[perm]; }
export function deny(res, perm, what) { return res.status(403).json({ error: `You don't have access to ${what || perm}. Ask the owner for access.`, askOwner: true, perm }); }
export const need = (perm, what) => (req, res, next) => (can(req, perm) ? next() : deny(res, perm, what));
export const modelAllowed = (req, model) => req.user?.role === 'owner' || (req.user?.models || []).some((m) => String(model).replace(/:latest$/, '') === m || m === '*');

// ---------- routes ----------
export function mountOffice(app) {
  if (!OFFICE) return;
  const slow = (req) => new Promise((r) => setTimeout(r, Math.min(10_000, 1000 * ((readJson('ipfails.json', {})[clientIp(req)] || 0)))));
  const ipFail = (req, add) => { const f = readJson('ipfails.json', {}); f[clientIp(req)] = add ? (f[clientIp(req)] || 0) + 1 : 0; writeJson('ipfails.json', f); };

  app.get('/api/office/status', (req, res) => {
    const sys = system();
    res.json({ office: true, setupDone: !!sys.ownerCreated, locked: !!sys.locked, user: publicUser(req.user), csrf: req.session?.csrf || null,
      allowTraining: !!sys.allowTraining, allowSearch: !!sys.allowSearch,
      ...(req.user?.role === 'owner' ? { firewallOpen: !!globalThis.__evxFirewallOpen, pending: requests().filter((r) => r.status === 'pending').length, notices: notices().slice(0, 20) } : {}) });
  });

  // One-time owner setup (disabled forever once confirmed)
  app.post('/api/office/setup', async (req, res) => {
    if (system().ownerCreated) return res.status(410).json({ error: 'Setup is already done.' });
    const { username, password } = req.body || {};
    if (!/^[\w.-]{3,32}$/.test(String(username || ''))) return res.status(400).json({ error: 'Username: 3–32 letters, digits, . _ -' });
    if (!strong(password)) return res.status(400).json({ error: 'The password must be at least 12 characters.' });
    const secret = authenticator.generateSecret();
    const recovery = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
    const owner = { id: rid(), username, name: username, role: 'owner', status: 'setup', passHash: await bcrypt.hash(password, 12), totpSecret: secret,
      recovery: await Promise.all(recovery.map((c) => bcrypt.hash(c, 10))), createdAt: new Date().toISOString(), failed: 0 };
    saveUsers([owner, ...users().filter((u) => u.role !== 'owner' || u.status !== 'setup')]);
    const qr = await QRCode.toDataURL(authenticator.keyuri(username, 'Evolvix Office', secret)); // generated locally, no network
    res.json({ qr, secret, recovery });
  });
  app.post('/api/office/setup/confirm', (req, res) => {
    if (system().ownerCreated) return res.status(410).json({ error: 'Setup is already done.' });
    const all = users(), o = all.find((u) => u.role === 'owner' && u.status === 'setup' && u.username === req.body?.username);
    if (!o || !authenticator.check(String(req.body?.code || ''), o.totpSecret)) return res.status(400).json({ error: 'Wrong code — check the time on your phone and try again.' });
    o.status = 'active'; saveUsers(all); saveSystem({ ownerCreated: true });
    audit('owner-created', { actor: o.username }, req);
    const csrf = createSession(res, o, req);
    res.json({ ok: true, csrf });
  });

  app.post('/api/office/login', async (req, res) => {
    await slow(req);
    const { username, password, code } = req.body || {};
    const all = users(), u = all.find((x) => x.username === username);
    const fail = (why, status = 401) => { ipFail(req, true); audit('login-failed', { username: String(username).slice(0, 40), why }, req); return res.status(status).json({ error: why }); };
    if (!u || u.status === 'setup') return fail('Wrong username or password.');
    if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) return fail(`This account is locked after 5 wrong passwords. Try again after ${new Date(u.lockedUntil).toLocaleTimeString()}.`, 423);
    if (!u.passHash || !(await bcrypt.compare(String(password || ''), u.passHash))) {
      u.failed = (u.failed || 0) + 1;
      if (u.failed >= 5) { u.lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString(); u.failed = 0; notify(`Account "${u.username}" was locked for 15 minutes after 5 wrong passwords (from ${clientIp(req)}).`); audit('account-locked', { user: u.username }, req); }
      saveUsers(all);
      return fail('Wrong username or password.');
    }
    if (u.role === 'owner') {
      const c = String(code || '').replace(/\s/g, '');
      let ok = /^\d{6}$/.test(c) && authenticator.check(c, u.totpSecret);
      if (!ok && c.length === 10) { const i = (await Promise.all(u.recovery.map((h) => bcrypt.compare(c, h)))).indexOf(true); if (i >= 0) { u.recovery.splice(i, 1); ok = true; audit('recovery-code-used', {}, req); } }
      if (!ok) { saveUsers(all); return fail(c ? 'Wrong authenticator code.' : 'Enter the 6-digit code from your authenticator app.', 401); }
    } else {
      if (system().locked) return fail('The app is locked by the owner.', 423);
      if (u.status === 'suspended') return fail('Your access is suspended. Ask the owner.', 403);
      if (u.status !== 'active') return fail('Your account is not active yet.', 403);
      if (expired(u)) { audit('user-expired', { user: u.username }, req); return res.status(403).json({ error: 'Your access has expired.', expired: true }); }
    }
    u.failed = 0; u.lockedUntil = null; u.lastLogin = new Date().toISOString(); saveUsers(all); ipFail(req, false);
    const csrf = createSession(res, u, req);
    audit('login', { user: u.username }, req);
    res.json({ ok: true, csrf, user: publicUser(u) });
  });
  app.post('/api/office/logout', (req, res) => { if (req.sessionKey) { const s = sessions(); delete s[req.sessionKey]; saveSessions(s); } res.setHeader('Set-Cookie', 'evx_sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });
  app.post('/api/office/logout-all', (req, res) => { endSessions((v) => v.userId === req.user.id); audit('logout-everywhere', {}, req); res.json({ ok: true }); });

  // Access requests (also renewals) — rate limited 3 per IP per hour
  app.post('/api/office/request-access', (req, res) => {
    if (limited(`req:${clientIp(req)}`, 3, 3_600_000)) return res.status(429).json({ error: 'Too many requests from this computer. Try again in an hour.' });
    const { name = '', email = '', reason = '', renewal = false, username = '' } = req.body || {};
    if (!String(name).trim() || !String(email).trim()) return res.status(400).json({ error: 'Name and work email / ID are required.' });
    const r = { id: rid(), type: renewal ? 'renewal' : 'access', name: String(name).slice(0, 80), email: String(email).slice(0, 120), reason: String(reason).slice(0, 500), username: String(username).slice(0, 40), ip: clientIp(req), at: new Date().toISOString(), status: 'pending' };
    saveRequests([r, ...requests()]);
    audit(renewal ? 'renewal-request' : 'access-request', { name: r.name, email: r.email }, req);
    res.json({ ok: true });
  });
  // A logged-in user asks for a permission they don't have
  app.post('/api/office/permission-request', (req, res) => {
    const perm = String(req.body?.perm || ''); const model = String(req.body?.model || '');
    const r = { id: rid(), type: 'permission', userId: req.user.id, username: req.user.username, name: req.user.name, perm, model, reason: String(req.body?.reason || '').slice(0, 300), at: new Date().toISOString(), status: 'pending' };
    saveRequests([r, ...requests()]);
    audit('permission-request', { perm, model }, req);
    res.json({ ok: true });
  });
  app.post('/api/office/consent', (req, res) => {
    const all = users(), u = all.find((x) => x.id === req.user.id); u.consentTraining = !!req.body?.consentTraining; saveUsers(all);
    audit('training-consent', { value: u.consentTraining }, req); res.json({ ok: true });
  });

  // Invite: set your own password (the owner never sees it). Token: 32 random bytes, 24 h, single use.
  app.get('/api/office/invite/:token', (req, res) => {
    const inv = readJson('invites.json', []).find((i) => i.tokenHash === sha(req.params.token) && !i.used && Date.parse(i.expiresAt) > Date.now());
    const u = inv && users().find((x) => x.id === inv.userId);
    res.json(u ? { valid: true, username: u.username } : { valid: false });
  });
  app.post('/api/office/invite/:token', async (req, res) => {
    const invs = readJson('invites.json', []), inv = invs.find((i) => i.tokenHash === sha(req.params.token) && !i.used && Date.parse(i.expiresAt) > Date.now());
    if (!inv) return res.status(410).json({ error: 'This invite link is invalid, used or expired. Ask the owner for a new one.' });
    if (!strong(req.body?.password)) return res.status(400).json({ error: 'The password must be at least 12 characters.' });
    const all = users(), u = all.find((x) => x.id === inv.userId);
    if (!u) return res.status(410).json({ error: 'This account no longer exists.' });
    u.passHash = await bcrypt.hash(req.body.password, 12); u.status = 'active'; inv.used = true;
    saveUsers(all); writeJson('invites.json', invs);
    audit('invite-accepted', { user: u.username }, req);
    res.json({ ok: true, username: u.username });
  });

  // ----- owner: requests, users, lock, settings, audit, admin -----
  app.get('/api/office/requests', ownerOnly, (req, res) => res.json(requests()));
  const expiryOf = (v) => {
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) { const t = Date.parse(v); if (t > Date.now()) return new Date(t).toISOString(); }
    const days = [1, 7, 30].includes(Number(v)) ? Number(v) : 7;
    return new Date(Date.now() + days * 86_400_000).toISOString();
  };
  const cleanPerms = (p = {}) => Object.fromEntries(PERMS.map((k) => [k, k === 'chat' ? p.chat !== false : !!p[k]]));
  const makeInvite = (u, req) => {
    const token = crypto.randomBytes(32).toString('hex');
    writeJson('invites.json', [{ tokenHash: sha(token), userId: u.id, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), used: false }, ...readJson('invites.json', [])]);
    return `${req.protocol}://${req.get('host')}/?invite=${token}`;
  };
  app.post('/api/office/requests/:id/approve', ownerOnly, (req, res) => {
    const all = requests(), r = all.find((x) => x.id === req.params.id && x.status === 'pending');
    if (!r) return res.status(404).json({ error: 'Request not found.' });
    const us = users();
    let u, link = null;
    if (r.type === 'permission') {
      u = us.find((x) => x.id === r.userId);
      if (!u) return res.status(404).json({ error: 'User not found.' });
      if (r.perm && PERMS.includes(r.perm)) u.perms[r.perm] = true;
      if (r.model && !u.models.includes(r.model)) u.models.push(r.model);
    } else if (r.type === 'renewal' && us.find((x) => x.username === r.username)) {
      u = us.find((x) => x.username === r.username);
      u.expiresAt = expiryOf(req.body?.expires); if (u.status === 'suspended') u.status = 'active';
    } else {
      const username = String(req.body?.username || r.email.split('@')[0] || r.name).toLowerCase().replace(/[^\w.-]/g, '').slice(0, 32) || `user${rid().slice(0, 4)}`;
      if (us.some((x) => x.username === username)) return res.status(400).json({ error: `The username "${username}" is taken — choose another.` });
      u = { id: rid(), username, name: r.name, email: r.email, role: 'user', status: 'invited', perms: cleanPerms(req.body?.perms),
        models: (Array.isArray(req.body?.models) && req.body.models.length ? req.body.models : ['learn']).map(String), expiresAt: expiryOf(req.body?.expires), createdAt: new Date().toISOString(), failed: 0 };
      us.push(u);
      link = makeInvite(u, req);
    }
    saveUsers(us);
    r.status = 'approved'; r.decidedAt = new Date().toISOString(); saveRequests(all);
    audit('request-approved', { type: r.type, user: u.username, perms: u.perms, models: u.models, expiresAt: u.expiresAt }, req);
    res.json({ ok: true, user: publicUser(u), inviteLink: link });
  });
  app.post('/api/office/requests/:id/reject', ownerOnly, (req, res) => {
    const all = requests(), r = all.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found.' });
    r.status = 'rejected'; r.decidedAt = new Date().toISOString(); saveRequests(all);
    audit('request-rejected', { type: r.type, name: r.name || r.username }, req);
    res.json({ ok: true });
  });
  app.get('/api/office/users', ownerOnly, (req, res) => {
    const online = new Set(Object.values(sessions()).filter((s) => Date.now() - s.last < 5 * 60_000).map((s) => s.userId));
    res.json(users().map((u) => ({ ...publicUser(u), email: u.email, lastLogin: u.lastLogin || null,
      state: u.status === 'invited' ? 'pending' : expired(u) ? 'expired' : u.status === 'suspended' ? 'suspended' : online.has(u.id) ? 'online' : 'active', dataBytes: dirSize(userDirSafe(u.id)) })));
  });
  app.patch('/api/office/users/:id', ownerOnly, (req, res) => {
    const all = users(), u = all.find((x) => x.id === req.params.id && x.role !== 'owner');
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const b = req.body || {};
    if (b.perms) u.perms = cleanPerms(b.perms);
    if (Array.isArray(b.models)) u.models = b.models.map(String);
    if (b.expires) u.expiresAt = expiryOf(b.expires);
    if (b.status && ['active', 'suspended'].includes(b.status)) u.status = b.status;
    saveUsers(all);
    if (b.status === 'suspended') endSessions((v) => v.userId === u.id);
    audit('user-changed', { user: u.username, ...b }, req);
    res.json({ ok: true, user: publicUser(u) });
  });
  app.post('/api/office/users/:id/logout', ownerOnly, (req, res) => { endSessions((v) => v.userId === req.params.id); audit('force-logout', { userId: req.params.id }, req); res.json({ ok: true }); });
  app.post('/api/office/users/:id/invite', ownerOnly, (req, res) => {
    const u = users().find((x) => x.id === req.params.id && x.role !== 'owner');
    if (!u) return res.status(404).json({ error: 'User not found.' });
    audit('invite-reissued', { user: u.username }, req); res.json({ inviteLink: makeInvite(u, req) });
  });
  app.delete('/api/office/users/:id', ownerOnly, (req, res) => {
    const all = users(), u = all.find((x) => x.id === req.params.id && x.role !== 'owner');
    if (!u) return res.status(404).json({ error: 'User not found.' });
    saveUsers(all.filter((x) => x.id !== u.id)); endSessions((v) => v.userId === u.id);
    if (req.query.deleteData === '1') fs.rmSync(userDirSafe(u.id), { recursive: true, force: true });
    audit('user-deleted', { user: u.username, dataDeleted: req.query.deleteData === '1' }, req);
    res.json({ ok: true });
  });
  app.post('/api/office/users/:id/clear-data', ownerOnly, (req, res) => {
    const u = users().find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    fs.rmSync(userDirSafe(u.id), { recursive: true, force: true }); audit('user-data-cleared', { user: u.username }, req); res.json({ ok: true });
  });
  app.post('/api/office/lock', ownerOnly, (req, res) => {
    const lock = req.body?.locked !== false;
    saveSystem({ locked: lock });
    if (lock) { const owners = new Set(users().filter((u) => u.role === 'owner').map((u) => u.id)); endSessions((v) => !owners.has(v.userId)); }
    audit(lock ? 'app-locked' : 'app-unlocked', {}, req);
    res.json({ ok: true, locked: lock });
  });
  app.post('/api/office/logout-everyone', ownerOnly, (req, res) => { endSessions((v) => v.userId !== req.user.id); audit('logout-everyone', {}, req); res.json({ ok: true }); });
  app.post('/api/office/settings', ownerOnly, (req, res) => {
    const b = req.body || {}, patch = {};
    if ('allowTraining' in b) patch.allowTraining = !!b.allowTraining;
    if ('allowSearch' in b) patch.allowSearch = !!b.allowSearch && process.env.OFFICE_ALLOW_SEARCH === '1';
    if (b.idleMin) patch.idleMin = Math.min(480, Math.max(5, Number(b.idleMin)));
    if (b.absHours) patch.absHours = Math.min(72, Math.max(1, Number(b.absHours)));
    saveSystem(patch); audit('settings-changed', patch, req); res.json({ ok: true, ...system() });
  });
  app.post('/api/office/notices/clear', ownerOnly, (req, res) => { writeJson('notices.json', []); res.json({ ok: true }); });
  app.get('/api/office/audit', ownerOnly, (req, res) => res.json(readAudit(String(req.query.q || ''))));
  app.get('/api/office/audit/verify', ownerOnly, (req, res) => { const v = verifyAudit(); audit('audit-verified', { ok: v.ok }, req); res.json(v); });
  app.get('/api/office/admin', ownerOnly, async (req, res) => {
    const ollama = (process.env.OLLAMA_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
    const get = (p) => fetch(`${ollama}${p}`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => ({}));
    const [ps, tags] = await Promise.all([get('/api/ps'), get('/api/tags')]);
    res.json({ queue: queueStatus(), gpu: (ps.models || []).map((m) => ({ name: m.name, size: m.size, vram: m.size_vram })), models: (tags.models || []).map((m) => m.name),
      dataBytes: dirSize(DATA_DIR), network: Object.fromEntries(netLog), firewallOpen: !!globalThis.__evxFirewallOpen, host: os.hostname() });
  });
  app.get('/api/office/admin/usage.csv', ownerOnly, (req, res) => {
    const rows = [['username', 'role', 'state', 'expires', 'last login', 'data bytes']];
    for (const u of users()) rows.push([u.username, u.role, expired(u) ? 'expired' : u.status, u.expiresAt || '', u.lastLogin || '', dirSize(userDirSafe(u.id))]);
    audit('export', { kind: 'usage.csv' }, req);
    res.setHeader('Content-Disposition', 'attachment; filename="evolvix-usage.csv"');
    res.type('text/csv').send(rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'));
  });

  // Per-user documents (chats, settings, projects) — a user can only ever read/write their own folder
  const DOCS = new Set(['chats', 'settings', 'projects']);
  app.get('/api/office/doc/:name', (req, res) => {
    if (!DOCS.has(req.params.name)) return res.status(400).json({ error: 'bad name' });
    const f = path.join(userDir(req.user.id), `${req.params.name}.json`);
    try { res.type('application/json').send(fs.readFileSync(f, 'utf8')); } catch { res.json(null); }
  });
  app.put('/api/office/doc/:name', (req, res) => {
    if (!DOCS.has(req.params.name)) return res.status(400).json({ error: 'bad name' });
    const d = userDir(req.user.id); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${req.params.name}.json`), JSON.stringify(req.body?.value ?? null));
    res.json({ ok: true });
  });
  // Exports happen in the browser — this records them and enforces the "export" permission first
  app.post('/api/office/export-check', (req, res) => {
    if (!can(req, 'export')) return deny(res, 'export', 'exporting');
    audit('export', { kind: String(req.body?.kind || '').slice(0, 40) }, req); res.json({ ok: true });
  });
}
const userDirSafe = (id) => { try { return userDir(id); } catch { return path.join(DATA_DIR, 'users', '_invalid'); } };
function dirSize(d) { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch {} return n; }
