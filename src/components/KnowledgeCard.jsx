import { useEffect, useState } from 'react';
import { Box, ButtonBase, Link, Typography } from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import NewspaperOutlinedIcon from '@mui/icons-material/NewspaperOutlined';

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const ago = (iso) => {
  const d = (Date.now() - new Date(iso)) / 864e5;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)}h ago`;
  if (d < 30) return `${Math.round(d)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const favicon = (u) => `https://www.google.com/s2/favicons?domain=${host(u)}&sz=32`;

/** Shown the moment search finishes: photo, summary, latest news, web results and related topics. */
export default function KnowledgeCard({ search, onAsk }) {
  const [more, setMore] = useState(false);
  const results = search.results || [];
  const main = results.find((r) => r.kind === 'wiki');
  const news = results.filter((r) => r.kind === 'news');
  const web = results.filter((r) => !r.kind);
  const related = (search.related || []).filter((r) => r.url !== main?.url);
  const summary = main?.text || '';

  // Nothing relevant found → show no card at all (the answer itself explains it)
  if (!main && !news.length && !web.length && !related.length) return null;

  return (
    <Box sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: '16px', overflow: 'hidden', bgcolor: 'background.paper', animation: 'fadeUp .3s ease both' }}>
      {main && (
        <Box sx={{ display: 'flex', gap: 2, p: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
          {main.image && (
            <Box component="a" href={main.url} target="_blank" rel="noreferrer" sx={{ flexShrink: 0 }}>
              <Box component="img" src={main.image} alt={main.name} loading="lazy" onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                sx={{ width: { xs: '100%', sm: 150 }, height: { xs: 220, sm: 180 }, objectFit: 'cover', objectPosition: 'top', borderRadius: '12px', display: 'block', bgcolor: 'action.hover' }} />
            </Box>
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em', lineHeight: 1.25 }}>{main.name}</Typography>
            {main.description && <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>{main.description}</Typography>}
            <Typography sx={{ fontSize: 14, lineHeight: 1.65, mt: 1, whiteSpace: 'pre-line' }}>
              {more || summary.length < 420 ? summary : `${summary.slice(0, 420).replace(/\s+\S*$/, '')}… `}
              {summary.length >= 420 && (
                <Link component="button" onClick={() => setMore((v) => !v)} sx={{ fontSize: 13.5, verticalAlign: 'baseline' }}>
                  {more ? ' Show less' : 'Show more'}
                </Link>
              )}
            </Typography>
            {main.facts?.length > 0 && (
              <Box component="dl" sx={{
                display: 'grid', gridTemplateColumns: 'minmax(110px, max-content) 1fr', columnGap: 2, rowGap: 0.6, m: 0, mt: 1.5,
                pt: 1.25, borderTop: 1, borderColor: 'divider', fontSize: 13.5,
                '& dt': { color: 'text.secondary', fontWeight: 500 }, '& dd': { m: 0, lineHeight: 1.45 },
              }}>
                {main.facts.slice(0, more ? 30 : 8).map((f) => (
                  <Box key={f.label} sx={{ display: 'contents' }}>
                    <dt>{f.label}</dt>
                    <dd>{/^https?:\/\//.test(f.value) ? <Link href={f.value} target="_blank" rel="noreferrer">{f.value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</Link> : f.value}</dd>
                  </Box>
                ))}
              </Box>
            )}
            <Link href={main.url} target="_blank" rel="noreferrer" underline="hover"
              sx={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 1, color: 'text.secondary' }}>
              <Box component="img" src={favicon(main.url)} sx={{ width: 14, height: 14 }} /> Wikipedia{main.facts?.length ? ' · Wikidata' : ''} <OpenInNewIcon sx={{ fontSize: 13 }} />
            </Link>
          </Box>
        </Box>
      )}

      {news.length > 0 && (
        <Box sx={{ px: 2, py: 1.5, borderTop: main ? 1 : 0, borderColor: 'divider' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <NewspaperOutlinedIcon sx={{ fontSize: 15 }} /> Latest news
          </Typography>
          {news.map((n) => (
            <Link key={n.url} href={n.url} target="_blank" rel="noreferrer" underline="none" color="inherit"
              sx={{ display: 'flex', gap: 1, py: 0.75, alignItems: 'baseline', '&:hover .t': { textDecoration: 'underline' } }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0, width: 64 }}>{ago(n.date)}</Typography>
              <Box sx={{ minWidth: 0 }}>
                <Typography className="t" sx={{ fontSize: 13.5, lineHeight: 1.4 }}>{n.title.replace(new RegExp(`\\s+-\\s+${(n.source || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '')}</Typography>
                {n.source && <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{n.source}</Typography>}
              </Box>
            </Link>
          ))}
        </Box>
      )}

      {web.length > 0 && (
        <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <LanguageIcon sx={{ fontSize: 15 }} /> From the web
          </Typography>
          {web.map((w) => (
            <Link key={w.url} href={w.url} target="_blank" rel="noreferrer" underline="hover" color="inherit" sx={{ display: 'flex', gap: 1, py: 0.5, alignItems: 'center' }}>
              <Box component="img" src={favicon(w.url)} sx={{ width: 14, height: 14, flexShrink: 0 }} />
              <Typography noWrap sx={{ fontSize: 13.5 }}>{w.title}</Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', flexShrink: 0 }}>{host(w.url)}</Typography>
            </Link>
          ))}
        </Box>
      )}

      {related.length > 0 && (
        <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>People also search for</Typography>
          <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }}>
            {[...related].sort((a, b) => Boolean(b.image) - Boolean(a.image)).map((r) => (
              <ButtonBase key={r.url} onClick={() => onAsk?.(r.name)} sx={{
                width: 132, flexShrink: 0, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', textAlign: 'left', borderRadius: '12px',
                border: 1, borderColor: 'divider', overflow: 'hidden', '&:hover': { borderColor: 'text.secondary' },
              }}>
                {r.image && (
                  <Box component="img" src={r.image} alt={r.name} loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    sx={{ width: '100%', height: 96, objectFit: 'cover', objectPosition: 'center 20%', bgcolor: 'action.hover' }} />
                )}
                <Box sx={{ p: 1 }}>
                  {!r.image && (
                    <Box sx={{ width: 28, height: 28, borderRadius: '8px', display: 'grid', placeItems: 'center', mb: 0.75, fontSize: 13, fontWeight: 700, color: '#fff',
                      background: 'linear-gradient(135deg,#c96442,#7c5cff)' }}>{r.name[0]}</Box>
                  )}
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{r.name}</Typography>
                  {r.description && <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.3, mt: 0.25 }}>{r.description}</Typography>}
                </Box>
              </ButtonBase>
            ))}
          </Box>
        </Box>
      )}

      {!main && !news.length && !web.length && (
        <Typography sx={{ p: 2, fontSize: 13.5, color: 'text.secondary' }}>I could not find verified, accurate information on that specific topic.</Typography>
      )}
    </Box>
  );
}

/** "Writing the answer… 12s" — so a slow local model never looks stuck. */
export function WaitingNote({ sources }) {
  const [s, setS] = useState(0);
  useEffect(() => { const t = setInterval(() => setS((v) => v + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <Typography sx={{ fontSize: 13, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'primary.main', animation: 'pulse 1s ease-in-out infinite', '@keyframes pulse': { '50%': { opacity: 0.25 } } }} />
      {sources ? `Reading ${sources} sources and writing a detailed answer…` : 'Thinking…'} {s}s
      {s > 8 && <Box component="span" sx={{ fontSize: 12 }}>· local models on a CPU can take 15–60s</Box>}
    </Typography>
  );
}
