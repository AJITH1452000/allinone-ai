import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Link, Snackbar, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { BRAND_GRADIENT } from '../brand';

/**
 * Office mode (OFFICE_MODE=1 on the server): nobody sees anything without the owner's permission.
 * First start → owner setup (password + authenticator). Then: login, "Request access", invite links (set your own password),
 * renewal for expired access. Not in office mode → renders `fallback` (the normal app with its optional site password).
 */
export default function OfficeGate({ app, fallback }) {
  const [mode, setMode] = useState('checking'); // checking | off | setup | login | request | invite | expired | ready
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupInfo, setSetupInfo] = useState(null);
  const [done, setDone] = useState('');
  const [ask, setAsk] = useState(null);
  const invite = new URLSearchParams(window.location.search).get('invite');
  const f = (k) => ({ value: form[k] || '', onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const start = async (csrf) => {
    const s = await (await fetch('/api/office/status')).json();
    if (csrf) s.csrf = csrf;
    setStatus(s);
    window.__EVX_CSRF = s.csrf;
    if (!s.user) return setMode(invite ? 'invite' : s.setupDone ? 'login' : 'setup');
    // Your chats / settings / projects come from YOUR folder on the server, not this browser
    const docs = {};
    await Promise.all(['chats', 'settings', 'projects'].map(async (n) => { try { docs[n] = await (await fetch(`/api/office/doc/${n}`)).json(); } catch {} }));
    window.__EVX_DOCS = docs; window.__EVX_OFFICE = true; window.__EVX_USER = s.user;
    setMode('ready');
  };

  useEffect(() => {
    fetch('/api/office/status').then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (!s?.office) return setMode('off');
      // Every same-origin change carries the CSRF token; 401 → back to login; 403 with askOwner → "Ask the owner" button
      const orig = window.fetch;
      window.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
        const method = (init.method || 'GET').toUpperCase();
        if (sameOrigin && method !== 'GET' && window.__EVX_CSRF) init = { ...init, headers: { ...(init.headers || {}), 'X-CSRF-Token': window.__EVX_CSRF } };
        const r = await orig(input, init);
        if (sameOrigin && (r.status === 401 || r.status === 403)) {
          r.clone().json().then((j) => {
            if (r.status === 401 && j?.auth) { window.__EVX_OFFICE = false; setMode('login'); }
            if (r.status === 403 && j?.askOwner) setAsk(j);
          }).catch(() => {});
        }
        return r;
      };
      start();
    }).catch(() => setMode('off'));
  }, []); // eslint-disable-line

  const post = async (url, body) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.expired) setMode('expired'); throw new Error(j.error || 'Something went wrong'); }
      return j;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  };

  if (mode === 'off') return fallback;
  if (mode === 'ready') {
    return (
      <>
        {app}
        <Chip size="small" label="🔒 Office mode · local only" sx={{ position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1400, fontSize: 11.5, bgcolor: 'background.paper', border: 1, borderColor: 'divider', pointerEvents: 'none' }} />
        {status?.user?.role === 'owner' && status.firewallOpen && (
          <Alert severity="error" sx={{ position: 'fixed', bottom: 12, left: 12, zIndex: 1400, maxWidth: 420 }}>Firewall lock is OFF — outbound internet is open. Run firewall-lock.ps1 as Administrator (the app still blocks its own connections).</Alert>
        )}
        <Snackbar open={!!ask} onClose={() => setAsk(null)} message={ask?.error} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          action={<Button color="secondary" size="small" onClick={async () => { await post('/api/office/permission-request', { perm: ask.perm, model: ask.model }); setAsk(null); }}>Ask the owner</Button>} />
      </>
    );
  }

  const card = (title, sub, children) => (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default' }}>
      <Box sx={{ width: '100%', maxWidth: 400 }}>
        <Box sx={{ width: 48, height: 48, mx: 'auto', mb: 2, borderRadius: '14px', display: 'grid', placeItems: 'center', background: BRAND_GRADIENT }}><LockOutlinedIcon sx={{ color: '#fff' }} /></Box>
        <Typography sx={{ fontSize: 22, fontWeight: 700, textAlign: 'center' }}>{title}</Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: 14, mt: 0.5, mb: 2.5, textAlign: 'center' }}>{sub}</Typography>
        {done ? <Alert severity="success">{done}</Alert> : children}
        {err && <Alert severity="error" sx={{ mt: 1.5 }}>{err}</Alert>}
        <Typography sx={{ mt: 3, fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>🔒 Office mode · everything stays on this company network</Typography>
      </Box>
    </Box>
  );
  const btn = (label, onClick, disabled) => <Button fullWidth variant="contained" disableElevation size="large" disabled={busy || disabled} onClick={onClick} sx={{ mt: 1.5, borderRadius: '12px' }}>{busy ? <CircularProgress size={20} color="inherit" /> : label}</Button>;

  if (mode === 'checking') return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>;

  if (mode === 'setup') {
    if (setupInfo) return card('Set up your authenticator', 'Scan with Google Authenticator (or any TOTP app), save the recovery codes, then enter the 6-digit code.', (
      <>
        <Box component="img" src={setupInfo.qr} alt="Authenticator QR code" sx={{ display: 'block', mx: 'auto', width: 200, height: 200, borderRadius: 2, bgcolor: '#fff', p: 1 }} />
        <Typography sx={{ fontSize: 12, textAlign: 'center', mt: 1, wordBreak: 'break-all', color: 'text.secondary' }}>Key: {setupInfo.secret}</Typography>
        <Alert severity="warning" sx={{ mt: 1.5, fontSize: 13 }}>Recovery codes (each works once if you lose your phone) — write them down now, they are not shown again:<br /><b style={{ fontFamily: 'monospace' }}>{setupInfo.recovery.join('  ')}</b></Alert>
        <TextField fullWidth label="6-digit code" sx={{ mt: 2 }} inputProps={{ inputMode: 'numeric' }} {...f('code')} />
        {btn('Finish setup', async () => { const j = await post('/api/office/setup/confirm', { username: form.username, code: form.code }); if (j) start(j.csrf); }, !form.code)}
      </>
    ));
    return card('Create the owner account', 'First start in office mode. Only you (the owner) can log in until you approve someone. This page is disabled after setup.', (
      <>
        <TextField fullWidth label="Owner username" {...f('username')} />
        <TextField fullWidth label="Password (min 12 characters)" type="password" sx={{ mt: 1.5 }} {...f('password')} />
        <TextField fullWidth label="Repeat password" type="password" sx={{ mt: 1.5 }} {...f('password2')} error={!!form.password2 && form.password2 !== form.password} />
        {btn('Continue', async () => { const j = await post('/api/office/setup', { username: form.username, password: form.password }); if (j) setSetupInfo(j); }, !form.username || (form.password || '').length < 12 || form.password !== form.password2)}
      </>
    ));
  }

  if (mode === 'invite') return card('Set your password', 'The owner approved your access. Choose your own password — nobody else ever sees it.', (
    <>
      <TextField fullWidth label="New password (min 12 characters)" type="password" {...f('password')} />
      <TextField fullWidth label="Repeat password" type="password" sx={{ mt: 1.5 }} {...f('password2')} error={!!form.password2 && form.password2 !== form.password} />
      {btn('Save password', async () => { const j = await post(`/api/office/invite/${invite}`, { password: form.password }); if (j) { window.history.replaceState(null, '', '/'); setForm({ username: j.username }); setMode('login'); } }, (form.password || '').length < 12 || form.password !== form.password2)}
    </>
  ));

  if (mode === 'request' || mode === 'expired') return card(mode === 'expired' ? 'Your access has expired' : 'Request access', 'The owner reviews every request. You will get an invite link (or a renewal) if approved.', (
    <>
      <TextField fullWidth label="Your name" {...f('name')} />
      <TextField fullWidth label="Work email / employee ID" sx={{ mt: 1.5 }} {...f('email')} />
      <TextField fullWidth label="Why do you need access?" multiline minRows={2} sx={{ mt: 1.5 }} {...f('reason')} />
      {btn(mode === 'expired' ? 'Request renewal' : 'Send request', async () => { const j = await post('/api/office/request-access', { name: form.name, email: form.email, reason: form.reason, renewal: mode === 'expired', username: form.username }); if (j) setDone('Request sent. The owner will review it.'); }, !form.name || !form.email)}
      <Link component="button" onClick={() => { setDone(''); setErr(''); setMode('login'); }} sx={{ display: 'block', mx: 'auto', mt: 2, fontSize: 13 }}>Back to log in</Link>
    </>
  ));

  return card('Evolvix', status?.locked ? 'The app is locked by the owner. Only the owner can log in.' : 'Log in with the account the owner approved.', (
    <>
      <TextField fullWidth label="Username" autoFocus {...f('username')} />
      <TextField fullWidth label="Password" type="password" sx={{ mt: 1.5 }} {...f('password')} />
      <TextField fullWidth label="Authenticator code (owner only)" sx={{ mt: 1.5 }} inputProps={{ inputMode: 'numeric' }} {...f('code')} />
      {btn('Log in', async () => { const j = await post('/api/office/login', { username: form.username, password: form.password, code: form.code }); if (j) start(j.csrf); }, !form.username || !form.password)}
      <Link component="button" onClick={() => { setErr(''); setMode('request'); }} sx={{ display: 'block', mx: 'auto', mt: 2, fontSize: 13 }}>No account? Request access</Link>
    </>
  ));
}
