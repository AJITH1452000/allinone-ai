import { createTheme } from '@mui/material';
import { BRAND, BRAND_GRADIENT } from './brand';

// Glass surfaces: see-through + blurred, so the soft aurora behind the app shows through.
const glass = (mode, strength = 0.72) => ({
  backgroundColor: mode === 'light' ? `rgba(255,255,255,${strength})` : `rgba(22,22,34,${strength})`,
  backdropFilter: 'saturate(160%) blur(18px)',
  WebkitBackdropFilter: 'saturate(160%) blur(18px)',
});

export const makeTheme = (mode) =>
  createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#5b4cf0' : '#8b7dff' },
      secondary: { main: BRAND.cyan },
      ...(mode === 'light'
        ? {
            background: { default: '#f5f6fb', paper: '#ffffff', side: 'rgba(255,255,255,0.55)', soft: '#eceef7' },
            text: { primary: '#14142b', secondary: '#64647a' },
            divider: 'rgba(30,30,80,0.09)',
          }
        : {
            background: { default: '#0a0a12', paper: '#161622', side: 'rgba(18,18,30,0.6)', soft: '#1f1f2e' },
            text: { primary: '#f1f1f7', secondary: '#9d9db3' },
            divider: 'rgba(255,255,255,0.08)',
          }),
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", "Noto Sans Tamil", system-ui, -apple-system, sans-serif',
      button: { textTransform: 'none', fontWeight: 600 },
    },
    glass: (strength) => glass(mode, strength),
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': { '--evx-link': mode === 'light' ? '#5b4cf0' : '#a99dff' },
          body: { WebkitFontSmoothing: 'antialiased', fontFeatureSettings: '"cv11", "ss01"' },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-thumb': { background: mode === 'light' ? 'rgba(20,20,60,.15)' : 'rgba(255,255,255,.15)', borderRadius: 8 },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          '::selection': { background: mode === 'light' ? 'rgba(91,76,240,.2)' : 'rgba(139,125,255,.35)' },
          '@keyframes fadeUp': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
          '@keyframes evx-drift-a': { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(8vw,6vh) scale(1.15)' } },
          '@keyframes evx-drift-b': { '0%,100%': { transform: 'translate(0,0) scale(1.1)' }, '50%': { transform: 'translate(-10vw,-4vh) scale(.95)' } },
          '@keyframes evx-drift-c': { '0%,100%': { transform: 'translate(0,0)' }, '50%': { transform: 'translate(-6vw,8vh)' } },
          '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animationDuration: '0.01ms !important', animationIterationCount: '1 !important', transitionDuration: '0.01ms !important' } },
        },
      },
      MuiTooltip: { defaultProps: { arrow: true }, styleOverrides: { tooltip: { fontSize: 12, borderRadius: 8 } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: 'transparent' } } },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 10, transition: 'transform .15s, box-shadow .2s, background-color .2s' },
          containedPrimary: { background: BRAND_GRADIENT, boxShadow: '0 6px 18px -6px rgba(79,70,229,.55)', '&:hover': { boxShadow: '0 10px 24px -8px rgba(79,70,229,.7)', transform: 'translateY(-1px)' }, '&.Mui-disabled': { background: 'none', boxShadow: 'none' } },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiDialog: { styleOverrides: { paper: { ...glass(mode, mode === 'light' ? 0.86 : 0.82), border: `1px solid ${mode === 'light' ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.08)'}`, boxShadow: '0 30px 80px -20px rgba(20,10,60,.45)' } } },
      MuiPopover: { styleOverrides: { paper: { ...glass(mode, mode === 'light' ? 0.85 : 0.82), border: `1px solid ${mode === 'light' ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.08)'}` } } },
      MuiMenu: { styleOverrides: { paper: { ...glass(mode, mode === 'light' ? 0.85 : 0.82) } } },
      MuiBackdrop: { styleOverrides: { root: { '&:not(.MuiBackdrop-invisible)': { backdropFilter: 'blur(6px)', backgroundColor: 'rgba(10,10,30,.35)' } } } },
    },
  });
