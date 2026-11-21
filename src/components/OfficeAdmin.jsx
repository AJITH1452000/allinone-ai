// Office mode — owner pages in Settings: Access (requests, approvals, users, lock), Audit (log + integrity), Admin (status).
import { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Select, Switch, TextField, Typography } from '@mui/material';

const PERMS = [['chat', 'Chat'], ['upload', 'Upload files'], ['kb', 'Knowledge bases'], ['code', 'Run code'], ['projects', 'Projects / build agent'], ['export', 'Export']];
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
  return j;
};
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const Section = ({ title, children }) => <Box sx={{ mb: 3 }}><Typography sx={{ fontWeight: 600, fontSize: 14, mb: 1 }}>{title}</Typography>{children}</Box>;
const Card = ({ children }) => <Box sx={{ p: 1.5, mb: 1, borderRadius: '12px', border: 1, borderColor: 'divider' }}>{children}</Box>;

function ApproveForm({ r, models, onDone }) {
  const [perms, setPerms] = useState({ chat: true });
  const [allowed, setAllowed] = useState(['learn']);
  const [expires, setExpires] = useState('7');
  const [custom, setCustom] = useState('');
  const [username, setUsername] = useState((r.email || r.name || '').split('@')[0].toLowerCase().replace(/[^\w.-]/g, ''));
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const approve = async () => {
    try {
      const j = await api(`/api/office/requests/${r.id}/approve`, 'POST', { perms, models: allowed, expires: expires === 'custom' ? custom : expires, username });
      if (j.inviteLink) setLink(j.inviteLink); else onDone();
    } catch (e) { setErr(e.message); }
  };
  if (link) return (
    <Alert severity="success" sx={{ mt: 1 }}>
      Approved. Send this one-time invite link to {r.name} (valid 24 h, single use — they set their own password):
      <TextField fullWidth size="small" value={link} sx={{ mt: 1 }} InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
      <Button size="small" sx={{ mt: 1 }} onClick={() => { navigator.clipboard?.writeText(link); onDone(); }}>Copy & close</Button>
    </Alert>
  );
  return (
    <Box sx={{ mt: 1 }}>
      {r.type === 'access' && <TextField size="small" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} sx={{ mb: 1 }} />}
      {r.type !== 'renewal' && r.type !== 'permission' && (
        <>
          <Box>{PERMS.map(([k, l]) => <FormControlLabel key={k} control={<Checkbox size="small" checked={!!perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />} label={<Typography sx={{ fontSize: 13 }}>{l}</Typography>} />)}</Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>Models allowed</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', my: 0.5 }}>
            {models.map((m) => <Chip key={m} size="small" label={m} color={allowed.includes(m) ? 'primary' : 'default'} onClick={() => setAllowed(allowed.includes(m) ? allowed.filter((x) => x !== m) : [...allowed, m])} />)}
          </Box>
        </>
      )}
      {r.type !== 'permission' && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
          <Typography sx={{ fontSize: 13 }}>Expires</Typography>
          <Select size="small" value={expires} onChange={(e) => setExpires(e.target.value)}>
            <MenuItem value="1">1 day</MenuItem><MenuItem value="7">7 days</MenuItem><MenuItem value="30">30 days</MenuItem><MenuItem value="custom">Custom date</MenuItem>
          </Select>
          {expires === 'custom' && <TextField size="small" type="date" value={custom} onChange={(e) => setCustom(e.target.value)} />}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <Button size="small" variant="contained" disableElevation onClick={approve}>Approve</Button>
        <Button size="small" color="error" onClick={async () => { await api(`/api/office/requests/${r.id}/reject`, 'POST', {}); onDone(); }}>Reject</Button>
      </Box>
      {err && <Alert severity="error" sx={{ mt: 1 }}>{err}</Alert>}
    </Box>
  );
}

export function AccessTab() {
  const [reqs, setReqs] = useState([]);
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState({});
  const [models, setModels] = useState(['learn']);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    const [r, u, s, m] = await Promise.all([api('/api/office/requests'), api('/api/office/users'), api('/api/office/status'), fetch('/api/models').then((x) => x.json()).catch(() => ({}))]);
    setReqs(r); setUsers(u); setStatus(s);
    setModels([...new Set((m.models || []).filter((x) => x.provider === 'ollama').map((x) => x.id.replace(/:latest$/, '')))].sort());
  };
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, []);
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { setMsg(e.message); } };
  const pending = reqs.filter((r) => r.status === 'pending');
  return (
    <>
      {msg && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      <Section title="Kill switch">
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant={status.locked ? 'contained' : 'outlined'} color="error" size="small" onClick={() => act(() => api('/api/office/lock', 'POST', { locked: !status.locked }))}>{status.locked ? 'Unlock app' : 'Lock app'}</Button>
          <Button variant="outlined" color="inherit" size="small" onClick={() => act(() => api('/api/office/logout-everyone', 'POST', {}))}>Log out everyone</Button>
          <Button variant="outlined" color="inherit" size="small" onClick={() => act(() => api('/api/office/logout-all', 'POST', {}))}>Log me out everywhere</Button>
        </Box>
        {status.locked && <Typography sx={{ fontSize: 12.5, color: 'error.main', mt: 1 }}>Locked: only you can log in.</Typography>}
      </Section>
      <Section title="Settings">
        <FormControlLabel control={<Switch checked={!!status.allowTraining} onChange={(e) => act(() => api('/api/office/settings', 'POST', { allowTraining: e.target.checked }))} />}
          label={<Typography sx={{ fontSize: 13 }}>Allow saving training data (only from users who agreed; kept in data/training/office/)</Typography>} />
        <FormControlLabel control={<Switch checked={!!status.allowSearch} onChange={(e) => act(() => api('/api/office/settings', 'POST', { allowSearch: e.target.checked }))} />}
          label={<Typography sx={{ fontSize: 13 }}>Allow web search (needs OFFICE_ALLOW_SEARCH=1 in .env)</Typography>} />
      </Section>
      {!!status.notices?.length && (
        <Section title="Notices">
          {status.notices.map((n, i) => <Typography key={i} sx={{ fontSize: 12.5, color: 'text.secondary' }}>{new Date(n.at).toLocaleString()} — {n.text}</Typography>)}
          <Button size="small" onClick={() => act(() => api('/api/office/notices/clear', 'POST', {}))}>Clear</Button>
        </Section>
      )}
      <Section title={`Requests${pending.length ? ` (${pending.length})` : ''}`}>
        {!pending.length && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No pending requests.</Typography>}
        {pending.map((r) => (
          <Card key={r.id}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{r.type === 'permission' ? `${r.username} asks for "${r.perm || r.model}"` : `${r.name} · ${r.email}`} <Chip size="small" label={r.type} sx={{ ml: 0.5 }} /></Typography>
            {r.reason && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{r.reason}</Typography>}
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{new Date(r.at).toLocaleString()}{r.ip ? ` · ${r.ip}` : ''}</Typography>
            {open === r.id ? <ApproveForm r={r} models={models} onDone={() => { setOpen(null); load(); }} /> : <Button size="small" sx={{ mt: 0.5 }} onClick={() => setOpen(r.id)}>Review</Button>}
          </Card>
        ))}
      </Section>
      <Section title="Users">
        {users.map((u) => (
          <Card key={u.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{u.username}</Typography>
              <Chip size="small" label={u.role === 'owner' ? 'owner' : u.state} color={u.state === 'online' ? 'success' : u.state === 'expired' || u.state === 'suspended' ? 'error' : 'default'} />
              {u.expiresAt && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>expires {new Date(u.expiresAt).toLocaleDateString()}</Typography>}
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>· data {fmtBytes(u.dataBytes || 0)}</Typography>
            </Box>
            {u.role !== 'owner' && (
              <>
                <Box>{PERMS.map(([k, l]) => <FormControlLabel key={k} control={<Checkbox size="small" checked={!!u.perms?.[k]} onChange={(e) => act(() => api(`/api/office/users/${u.id}`, 'PATCH', { perms: { ...u.perms, [k]: e.target.checked } }))} />} label={<Typography sx={{ fontSize: 12.5 }}>{l}</Typography>} />)}</Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Models: {(u.models || []).join(', ')}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                  <Button size="small" onClick={() => act(() => api(`/api/office/users/${u.id}`, 'PATCH', { expires: '7' }))}>+7 days</Button>
                  <Button size="small" onClick={() => act(() => api(`/api/office/users/${u.id}`, 'PATCH', { status: u.state === 'suspended' ? 'active' : 'suspended' }))}>{u.state === 'suspended' ? 'Reactivate' : 'Suspend'}</Button>
                  <Button size="small" onClick={() => act(() => api(`/api/office/users/${u.id}/logout`, 'POST', {}))}>Force logout</Button>
                  {u.state === 'pending' && <Button size="small" onClick={() => act(async () => { const j = await api(`/api/office/users/${u.id}/invite`, 'POST', {}); setMsg(`New invite link (24 h): ${j.inviteLink}`); })}>New invite link</Button>}
                  <Button size="small" color="error" onClick={() => { if (window.confirm(`Delete ${u.username}?`)) { const data = window.confirm(`Also delete ALL of ${u.username}'s data (chats, knowledge bases)? This cannot be undone.`); act(() => api(`/api/office/users/${u.id}${data ? '?deleteData=1' : ''}`, 'DELETE')); } }}>Delete</Button>
                </Box>
              </>
            )}
          </Card>
        ))}
      </Section>
    </>
  );
}

export function AuditTab() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [check, setCheck] = useState(null);
  useEffect(() => { const t = setTimeout(() => api(`/api/office/audit?q=${encodeURIComponent(q)}`).then(setRows).catch(() => {}), 250); return () => clearTimeout(t); }, [q]);
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
        <TextField size="small" fullWidth placeholder="Search (user, event, IP…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="outlined" color="inherit" size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => api('/api/office/audit/verify').then(setCheck)}>Verify log integrity</Button>
      </Box>
      {check && <Alert severity={check.ok ? 'success' : 'error'} sx={{ mb: 1.5 }}>{check.ok ? `Intact — ${check.lines} lines, hash chain verified.` : `TAMPERED at line ${check.line}: ${check.why}`}</Alert>}
      {rows.map((e) => (
        <Typography key={e.hash} sx={{ fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace', py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
          {new Date(e.ts).toLocaleString()} · <b>{e.type}</b> · {e.actor} · {e.ip} {Object.keys(e.details || {}).length ? `· ${JSON.stringify(e.details)}` : ''}
        </Typography>
      ))}
    </>
  );
}

export function AdminTab() {
  const [a, setA] = useState(null);
  const [users, setUsers] = useState([]);
  useEffect(() => { api('/api/office/admin').then(setA).catch(() => {}); api('/api/office/users').then(setUsers).catch(() => {}); }, []);
  if (!a) return <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>Loading…</Typography>;
  return (
    <>
      {a.firewallOpen && <Alert severity="error" sx={{ mb: 2 }}>Firewall lock is OFF — outbound internet is open. Run firewall-lock.ps1 as Administrator.</Alert>}
      <Section title="Users">
        {users.map((u) => <Typography key={u.id} sx={{ fontSize: 13 }}>{u.username} — {u.role === 'owner' ? 'owner' : u.state}{u.expiresAt ? ` · expires ${new Date(u.expiresAt).toLocaleDateString()}` : ''}</Typography>)}
      </Section>
      <Section title="Queue">
        {Object.keys(a.queue).length ? Object.entries(a.queue).map(([m, q]) => <Typography key={m} sx={{ fontSize: 13 }}>{m}: {q.running ? 'generating' : 'idle'}, {q.waiting} waiting</Typography>) : <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Idle.</Typography>}
      </Section>
      <Section title="GPU (ollama ps)">
        {a.gpu.length ? a.gpu.map((g) => <Typography key={g.name} sx={{ fontSize: 13 }}>{g.name}: {fmtBytes(g.size)} · {g.size ? Math.round((100 * g.vram) / g.size) : 0}% on GPU</Typography>) : <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No model loaded.</Typography>}
      </Section>
      <Section title="Installed models"><Typography sx={{ fontSize: 13 }}>{a.models.join(', ') || '—'}</Typography></Section>
      <Section title="Disk used by data/"><Typography sx={{ fontSize: 13 }}>{fmtBytes(a.dataBytes)}</Typography></Section>
      <Section title="Outgoing connections since start">
        {Object.entries(a.network).map(([h, n]) => <Typography key={h} sx={{ fontSize: 13, color: n.allowed ? 'text.primary' : 'error.main' }}>{n.allowed ? '✔' : '⛔ blocked'} {h} — {n.count}×</Typography>)}
      </Section>
      <Button variant="outlined" color="inherit" size="small" href="/api/office/admin/usage.csv">Export usage CSV</Button>
    </>
  );
}

/** For approved users: agree (or not) that their 👍 / ✏️ answers may improve Learn */
export function ConsentTab() {
  const [on, setOn] = useState(!!window.__EVX_USER?.consentTraining);
  return (
    <FormControlLabel control={<Checkbox checked={on} onChange={async (e) => { setOn(e.target.checked); await api('/api/office/consent', 'POST', { consentTraining: e.target.checked }); }} />}
      label={<Typography sx={{ fontSize: 14 }}>I agree my 👍 / ✏️ answers may be used to improve Learn (only if the owner allows training data).</Typography>} />
  );
}
