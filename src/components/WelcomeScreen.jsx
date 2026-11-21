import { useState } from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { LogoMark, BRAND } from './Logo';

const WORK = ['Software developer', 'Student', 'Teacher', 'Designer', 'Business owner', 'Data / AI', 'Writer / Content creator', 'Government exam aspirant', 'Other'];

/** First-run / signed-out screen. Profile is stored locally only (no account server). */
export default function WelcomeScreen({ profile = {}, onContinue }) {
  const [name, setName] = useState(profile.name || '');
  const [work, setWork] = useState(profile.work || '');
  const go = () => onContinue({ name: name.trim(), callMe: profile.callMe || name.trim().split(' ')[0], work });

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default',
      backgroundImage: (t) => `radial-gradient(1200px 500px at 50% -10%, ${t.palette.mode === 'dark' ? 'rgba(124,58,237,.22)' : 'rgba(79,70,229,.14)'}, transparent)` }}>
      <Box sx={{ width: '100%', maxWidth: 400, textAlign: 'center', animation: 'fadeUp .4s ease both' }}>
        <LogoMark size={56} sx={{ mx: 'auto', mb: 2.5 }} />
        <Typography sx={{ fontSize: 28, fontWeight: 650, letterSpacing: '-0.02em' }}>
          {profile.name ? `Welcome back, ${profile.name.split(' ')[0]}` : `Welcome to ${BRAND}`}
        </Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: 14.5, mt: 0.75, mb: 3.5 }}>
          Your Learn models, Gemini, Claude & ChatGPT — in one place.
        </Typography>
        <Box component="form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) go(); }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, textAlign: 'left' }}>
          <TextField autoFocus fullWidth label="Your name" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} />
          <TextField select fullWidth label="What do you do? (optional)" value={work} onChange={(e) => setWork(e.target.value)}>
            <MenuItem value="">—</MenuItem>
            {WORK.map((w) => <MenuItem key={w} value={w}>{w}</MenuItem>)}
          </TextField>
          <Button type="submit" variant="contained" disableElevation size="large" disabled={!name.trim()} sx={{ mt: 0.5, py: 1.2, borderRadius: '12px' }}>
            Continue
          </Button>
          <Button color="inherit" onClick={() => onContinue({})} sx={{ color: 'text.secondary' }}>Skip for now</Button>
        </Box>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 3 }}>
          Stored only on this computer. Your chats are kept when you log out.
        </Typography>
      </Box>
    </Box>
  );
}
