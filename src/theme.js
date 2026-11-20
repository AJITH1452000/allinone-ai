import { createTheme } from '@mui/material';

export const makeTheme = (mode) =>
  createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#c2593a' : '#e07a55' },
      secondary: { main: '#7c5cff' },
      ...(mode === 'light'
        ? {
            background: { default: '#fbfaf7', paper: '#ffffff', side: '#f4f2ec', soft: '#efede6' },
            text: { primary: '#1a1917', secondary: '#6b6963' },
            divider: 'rgba(20,18,12,0.09)',
          }
        : {
            background: { default: '#17171a', paper: '#212125', side: '#111113', soft: '#2a2a2f' },
            text: { primary: '#f2f1ee', secondary: '#9e9ca5' },
            divider: 'rgba(255,255,255,0.08)',
          }),
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", "Noto Sans Tamil", system-ui, -apple-system, sans-serif',
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { WebkitFontSmoothing: 'antialiased', fontFeatureSettings: '"cv11", "ss01"' },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-thumb': { background: mode === 'light' ? 'rgba(0,0,0,.15)' : 'rgba(255,255,255,.15)', borderRadius: 8 },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          '@keyframes fadeUp': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
        },
      },
      MuiTooltip: { defaultProps: { arrow: true }, styleOverrides: { tooltip: { fontSize: 12, borderRadius: 8 } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiDialog: { styleOverrides: { paper: { boxShadow: '0 24px 64px -12px rgba(0,0,0,.35)' } } },
      MuiBackdrop: { styleOverrides: { root: { '&:not(.MuiBackdrop-invisible)': { backdropFilter: 'blur(4px)' } } } },
    },
  });
