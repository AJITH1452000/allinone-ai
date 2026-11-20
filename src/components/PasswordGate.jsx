import { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

/** Shown on the live site when APP_PASSWORD is set, so strangers can't use your API keys. */
export default function PasswordGate({ children }) {
  const [state, setState] = useState('checking'); // checking | locked | open
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth').then((r) => r.json()).then((j) => setState(j.ok ? 'open' : 'locked')).catch(() => setState('open'));
  }, []);

  const login = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    setBusy(false);
    if (r.ok) setState('open'); else setErr('Wrong password');
  };

  if (state === 'open') return children;
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default' }}>
      {state === 'checking' ? <CircularProgress size={28} /> : (
        <Box component="form" onSubmit={login} sx={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
          <Box sx={{ width: 48, height: 48, mx: 'auto', mb: 2, borderRadius: '14px', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#c96442,#7c5cff)' }}>
            <LockOutlinedIcon sx={{ color: '#fff' }} />
          </Box>
          <Typography sx={{ fontSize: 22, fontWeight: 650 }}>All-in-One AI</Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 14, mt: 0.5, mb: 3 }}>Enter the password to continue</Typography>
          <TextField autoFocus fullWidth type="password" label="Password" value={pw} onChange={(e) => setPw(e.target.value)} error={!!err} helperText={err || ' '} />
          <Button type="submit" fullWidth variant="contained" disableElevation size="large" disabled={!pw || busy} sx={{ mt: 1, borderRadius: '12px' }}>
            {busy ? <CircularProgress size={20} color="inherit" /> : 'Continue'}
          </Button>
        </Box>
      )}
    </Box>
  );
}
