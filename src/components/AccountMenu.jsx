import { useState } from 'react';
import { Box, ButtonBase, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { BRAND_GRADIENT } from '../brand';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import DataUsageOutlinedIcon from '@mui/icons-material/DataUsageOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckIcon from '@mui/icons-material/Check';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { LANG_MODES } from '../lib/personas';

export const initials = (name = '') => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'U';

/** Profile button at the bottom of the sidebar + the account menu (Settings, Usage, Language, Help…) */
export default function AccountMenu({ profile = {}, settings, setSettings, onAction, compact }) {
  const [anchor, setAnchor] = useState(null);
  const [sub, setSub] = useState(null); // { el, kind: 'lang' | 'more' }
  const close = () => { setAnchor(null); setSub(null); };
  const go = (action) => { close(); onAction(action); };
  const name = profile.name || 'You';

  const Item = ({ Icon, label, hint, action, onClick, end }) => (
    <MenuItem onClick={onClick || (() => go(action))} sx={{ py: 0.9, borderRadius: '8px', mx: 0.75, fontSize: 14 }}>
      <ListItemIcon><Icon sx={{ fontSize: 19 }} /></ListItemIcon>
      <ListItemText primaryTypographyProps={{ fontSize: 14 }}>{label}</ListItemText>
      {hint && <Typography sx={{ fontSize: 12, color: 'text.secondary', ml: 2 }}>{hint}</Typography>}
      {end}
    </MenuItem>
  );

  return (
    <>
      {compact ? (
        <ButtonBase onClick={(e) => setAnchor(e.currentTarget)} sx={{
          maxWidth: '100%', gap: 1, px: 0.75, py: 0.75, borderRadius: '10px', '&:hover': { bgcolor: 'action.hover' }, bgcolor: anchor ? 'action.selected' : 'transparent',
        }}>
          <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
            background: BRAND_GRADIENT, color: '#fff', fontSize: 11.5, fontWeight: 700 }}>{initials(name)}</Box>
          <Typography noWrap sx={{ fontSize: 14.5, fontWeight: 600 }}>{name}</Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }}>· Free</Typography>
          <ExpandMoreRoundedIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
        </ButtonBase>
      ) : (
      <ButtonBase onClick={(e) => setAnchor(e.currentTarget)} sx={{
        width: '100%', justifyContent: 'flex-start', gap: 1.25, p: 1, borderRadius: '12px', textAlign: 'left',
        '&:hover': { bgcolor: 'action.hover' }, bgcolor: anchor ? 'action.selected' : 'transparent',
      }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
          background: BRAND_GRADIENT, color: '#fff', fontSize: 13, fontWeight: 700 }}>{initials(name)}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600 }}>{name}</Typography>
          <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary' }}>Free · Local</Typography>
        </Box>
        <UnfoldMoreIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
      </ButtonBase>
      )}

      <Menu anchorEl={anchor} open={!!anchor} onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ sx: { width: 300, borderRadius: '14px', mt: -1, py: 0.5 } }} MenuListProps={{ dense: true, sx: { py: 0.5 } }}>
        <Typography sx={{ px: 2, py: 1, fontSize: 12.5, color: 'text.secondary' }} noWrap>{profile.email || profile.work || 'Personal account · this PC'}</Typography>
        <Item Icon={SettingsOutlinedIcon} label="Settings" hint="Ctrl+Shift+," action="settings" />
        <Item Icon={DataUsageOutlinedIcon} label="Usage" action="usage" />
        <Item Icon={LanguageOutlinedIcon} label="Language" onClick={(e) => setSub({ el: e.currentTarget, kind: 'lang' })} end={<ChevronRightIcon sx={{ fontSize: 18, color: 'text.secondary' }} />} />
        <Item Icon={HelpOutlineIcon} label="Get help" action="help" />
        <Item Icon={InfoOutlinedIcon} label="Learn more" onClick={(e) => setSub({ el: e.currentTarget, kind: 'more' })} end={<ChevronRightIcon sx={{ fontSize: 18, color: 'text.secondary' }} />} />
        <Divider sx={{ my: 0.5 }} />
        <Item Icon={ChecklistIcon} label="View all plans" action="plans" />
        <Item Icon={DevicesOutlinedIcon} label="Get apps and extensions" action="apps" />
        <Divider sx={{ my: 0.5 }} />
        <Item Icon={KeyOutlinedIcon} label="Get API keys" action="keys" end={<OpenInNewIcon sx={{ fontSize: 16, color: 'text.secondary' }} />} />
        <Divider sx={{ my: 0.5 }} />
        <Item Icon={LogoutIcon} label="Log out" action="logout" />
      </Menu>

      {/* Sub-menus */}
      <Menu anchorEl={sub?.el} open={!!sub} onClose={() => setSub(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { minWidth: 220, borderRadius: '14px', ml: 0.5 } }} MenuListProps={{ dense: true }}>
        {sub?.kind === 'lang' && [
          <Typography key="h" sx={{ px: 2, py: 0.75, fontSize: 12, color: 'text.secondary' }}>AI reply language</Typography>,
          ...LANG_MODES.map((l) => (
            <MenuItem key={l.id} onClick={() => { setSettings((s) => ({ ...s, lang: l.id })); close(); }} sx={{ borderRadius: '8px', mx: 0.75 }}>
              <ListItemText primaryTypographyProps={{ fontSize: 14 }}>{l.id === 'auto' ? 'Auto (match me)' : l.label}</ListItemText>
              {settings.lang === l.id && <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
            </MenuItem>
          )),
        ]}
        {sub?.kind === 'more' && [
          ['about', 'About Evolvix'], ['shortcuts', 'Keyboard shortcuts'], ['privacy', 'Privacy & your data'], ['models', 'About your Learn models'],
        ].map(([a, l]) => (
          <MenuItem key={a} onClick={() => go(a)} sx={{ borderRadius: '8px', mx: 0.75 }}>
            <ListItemText primaryTypographyProps={{ fontSize: 14 }}>{l}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
