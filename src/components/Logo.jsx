import { useId } from 'react';
import { Box } from '@mui/material';
import { BRAND as C } from '../brand';

export const BRAND = 'Evolvix';

/** Evolvix mark: two helix strands crossing into an "X" (evolution). Same drawing as public/icon.svg. */
export function LogoMark({ size = 24, spin = false, sx }) {
  const id = useId().replace(/:/g, '');
  return (
    <Box component="svg" viewBox="0 0 512 512" aria-label={BRAND}
      sx={{ width: size, height: size, flexShrink: 0, display: 'block', borderRadius: `${size * 0.26}px`,
        boxShadow: size >= 32 ? '0 8px 24px -8px rgba(79,70,229,.6)' : 'none',
        ...(spin && { '& .strand': { animation: 'evx-helix 1.6s ease-in-out infinite' },
          '& .strand2': { animationDelay: '-.8s' },
          '@keyframes evx-helix': { '50%': { opacity: 0.45 } } }),
        ...sx }}>
      <defs>
        <linearGradient id={`evx${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.violet} />
          <stop offset=".55" stopColor={C.indigo} />
          <stop offset="1" stopColor={C.cyan} />
        </linearGradient>
        <radialGradient id={`evxs${id}`} cx=".3" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="132" fill={`url(#evx${id})`} />
      <rect width="512" height="512" rx="132" fill={`url(#evxs${id})`} />
      <g fill="none" stroke="#fff" strokeLinecap="round">
        <path d="M208 176h96M208 336h96" strokeWidth="26" strokeOpacity=".55" />
        <path className="strand strand2" d="M352 136C352 236 160 276 160 376" strokeWidth="46" strokeOpacity=".7" />
        <path className="strand" d="M160 136C160 236 352 276 352 376" strokeWidth="46" />
      </g>
    </Box>
  );
}

/** Mark + "Evolvix" wordmark. */
export default function Logo({ size = 24, fontSize = 19 }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <LogoMark size={size} />
      <Box component="span" sx={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 700, fontSize, letterSpacing: '-0.035em', lineHeight: 1, whiteSpace: 'nowrap' }}>
        {BRAND}
      </Box>
    </Box>
  );
}
