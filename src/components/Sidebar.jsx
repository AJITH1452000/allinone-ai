import { useEffect, useMemo, useState } from 'react';
import { Box, ButtonBase, Collapse, IconButton, List, ListItemButton, ListItemText, Menu, MenuItem, ListItemIcon, TextField, Tooltip, Typography } from '@mui/material';
import { BRAND_GRADIENT } from '../brand';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import PushPinIcon from '@mui/icons-material/PushPin';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import WidgetsOutlinedIcon from '@mui/icons-material/WidgetsOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import DataUsageOutlinedIcon from '@mui/icons-material/DataUsageOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import AccountMenu, { initials } from './AccountMenu';
import ChatMenu from './ChatMenu';
import Logo from './Logo';

const SectionTitle = ({ children, open, onToggle }) => (
  <ButtonBase onClick={onToggle} disabled={!onToggle} sx={{ gap: 0.25, mx: 1, mt: 2, mb: 0.5, px: 0.5, borderRadius: 1, fontSize: 12.5, color: 'text.secondary', fontWeight: 500, alignSelf: 'flex-start' }}>
    {children}
    {onToggle && <ExpandMoreIcon sx={{ fontSize: 16, transform: open ? 'none' : 'rotate(-90deg)', transition: '.15s' }} />}
  </ButtonBase>
);

// Today · Yesterday · Previous 7 days · Previous 30 days · Older (newest first, like ChatGPT)
function groupByDate(list) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const day = 864e5, t0 = start.getTime();
  const buckets = [['Today', t0], ['Yesterday', t0 - day], ['Previous 7 days', t0 - 7 * day], ['Previous 30 days', t0 - 30 * day], ['Older', -Infinity]];
  const at = (c) => c.updatedAt || c.createdAt || 0;
  const out = buckets.map(([label]) => [label, []]);
  [...list].sort((a, b) => at(b) - at(a)).forEach((c) => {
    const i = buckets.findIndex(([, from]) => at(c) >= from);
    out[i < 0 ? out.length - 1 : i][1].push(c);
  });
  return out.filter(([, items]) => items.length);
}

export const NAV = [
  ['new', AddIcon, 'New chat', 'Ctrl+Shift+O'],
  ['search', SearchIcon, 'Search', 'Ctrl+K'],
  ['projects', FolderOutlinedIcon, 'Projects'],
  ['artifacts', WidgetsOutlinedIcon, 'Artifacts'],
  ['assistants', SmartToyOutlinedIcon, 'Assistants'],
  ['usage', DataUsageOutlinedIcon, 'Usage'],
];

/**
 * Claude-style sidebar. collapsed = thin icon rail.
 * onNav(action): 'new' | 'search' | 'projects' | 'artifacts' | 'assistants' | 'usage' | 'apps'
 */
export default function Sidebar({
  chats, projects, activeId, activeProject, onOpenProject, onSelect, onChatAction, onProjectAction,
  settings, setSettings, onAction, onNav, collapsed, onToggleCollapse, renameProject, onRenameStarted,
}) {
  const [menu, setMenu] = useState(null); // { el, chat }
  const [pMenu, setPMenu] = useState(null); // { el, project }
  const [renaming, setRenaming] = useState(null); // chat id or `p:<projectId>`
  const [name, setName] = useState('');
  const [open, setOpen] = useState({ recents: true, archived: false });

  const project = projects.find((p) => p.id === activeProject);
  useEffect(() => {
    const p = projects.find((x) => x.id === renameProject);
    if (p) { setRenaming(`p:${p.id}`); setName(p.name); onRenameStarted?.(); }
  }, [renameProject, projects]); // eslint-disable-line

  const scoped = useMemo(() => chats.filter((c) => !activeProject || c.projectId === activeProject), [chats, activeProject]);
  const visible = scoped.filter((c) => !c.archived && (c.messages.length || c.id === activeId));
  const pinned = visible.filter((c) => c.pinned);
  const recent = visible.filter((c) => !c.pinned);
  const archived = scoped.filter((c) => c.archived);

  const startRename = (key, current) => { setRenaming(key); setName(current); };
  const finishRename = () => {
    if (renaming?.startsWith('p:')) onProjectAction(renaming.slice(2), 'rename', name.trim());
    else if (renaming) onChatAction(renaming, 'renameTo', name.trim());
    setRenaming(null);
  };
  const renameField = () => (
    <TextField size="small" variant="standard" autoFocus fullWidth value={name}
      onChange={(e) => setName(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={finishRename}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }} />
  );

  // ---------- collapsed: icon rail (like Claude / Gemini) ----------
  if (collapsed) {
    return (
      <Box sx={{ width: 56, height: '100%', bgcolor: 'background.side', backdropFilter: 'saturate(160%) blur(20px)', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1.25, gap: 0.5, borderRight: 1, borderColor: 'divider' }}>
        <Tooltip title="Open sidebar (Ctrl+B)" placement="right"><IconButton onClick={onToggleCollapse}><ViewSidebarOutlinedIcon sx={{ fontSize: 20 }} /></IconButton></Tooltip>
        <Box sx={{ height: 8 }} />
        {NAV.map(([id, Icon, label, key]) => (
          <Tooltip key={id} title={key ? `${label} (${key})` : label} placement="right">
            <IconButton onClick={() => onNav(id)} sx={id === 'new' ? { bgcolor: 'action.hover' } : undefined}><Icon sx={{ fontSize: 20 }} /></IconButton>
          </Tooltip>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={settings.profile?.name || 'Account'} placement="right">
          <ButtonBase onClick={() => onAction('settings')} sx={{ width: 32, height: 32, borderRadius: '50%', background: BRAND_GRADIENT, color: '#fff', fontSize: 13, fontWeight: 700 }}>
            {initials(settings.profile?.name || 'You')}
          </ButtonBase>
        </Tooltip>
      </Box>
    );
  }

  const ChatRow = (c) => (
    <ListItemButton key={c.id} selected={c.id === activeId} onClick={() => onSelect(c.id)}
      sx={{ borderRadius: '10px', py: 0.5, minHeight: 38, '&:hover .more, &.Mui-selected .more': { opacity: 1 }, '&.Mui-selected': { bgcolor: 'action.selected' } }}>
      {c.pinned && <PushPinIcon sx={{ fontSize: 13, color: 'text.secondary', mr: 0.75, transform: 'rotate(30deg)' }} />}
      {renaming === c.id ? renameField() : (
        <ListItemText primary={c.title} primaryTypographyProps={{ noWrap: true, fontSize: 14.5, color: c.archived ? 'text.secondary' : 'text.primary' }} />
      )}
      <IconButton className="more" size="small" sx={{ opacity: 0, mr: -0.5 }} onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, chat: c }); }}>
        <MoreHorizIcon fontSize="small" />
      </IconButton>
    </ListItemButton>
  );

  return (
    <Box sx={{ width: 272, height: '100%', bgcolor: 'background.side', backdropFilter: 'saturate(160%) blur(20px)', WebkitBackdropFilter: 'saturate(160%) blur(20px)', display: 'flex', flexDirection: 'column', borderRight: 1, borderColor: 'divider' }}>
      {/* Top: collapse + brand + new chat */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, pt: 1.5, pb: 1 }}>
        <Tooltip title="Close sidebar (Ctrl+B)"><IconButton size="small" onClick={onToggleCollapse}><ViewSidebarOutlinedIcon sx={{ fontSize: 20 }} /></IconButton></Tooltip>
        <Box sx={{ display: 'flex', alignItems: 'center', ml: 0.75, flex: 1, minWidth: 0 }}>
          <Logo size={24} fontSize={19} />
        </Box>
        <Tooltip title="New chat (Ctrl+Shift+O)"><IconButton size="small" onClick={() => onNav('new')}><ChatBubbleOutlineIcon sx={{ fontSize: 19 }} /></IconButton></Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pb: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Navigation */}
        <List dense disablePadding sx={{ mt: 0.5 }}>
          {NAV.map(([id, Icon, label]) => (
            <ListItemButton key={id} onClick={() => onNav(id)} sx={{ borderRadius: '10px', py: 0.75, gap: 1.5, minHeight: 40 }}>
              <Icon sx={{ fontSize: 21 }} />
              <Typography noWrap sx={{ fontSize: 15 }}>{id === 'new' && project ? `New chat in ${project.name}` : label}</Typography>
            </ListItemButton>
          ))}
        </List>

        {/* Inside a project */}
        {project && (
          <Box sx={{ mt: 1.5, mx: 0.5, p: 1, borderRadius: '12px', bgcolor: 'action.hover' }}>
            <ButtonBase onClick={() => onOpenProject(null)} sx={{ gap: 0.5, fontSize: 12.5, color: 'text.secondary', borderRadius: 1 }}>
              <ArrowBackIcon sx={{ fontSize: 15 }} /> All chats
            </ButtonBase>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 0.75 }}>
              <FolderOutlinedIcon sx={{ fontSize: 19, color: 'primary.main' }} />
              {renaming === `p:${project.id}` ? renameField() : <Typography noWrap sx={{ flex: 1, fontWeight: 600, fontSize: 14.5 }}>{project.name}</Typography>}
              <IconButton size="small" onClick={(e) => setPMenu({ el: e.currentTarget, project })}><MoreHorizIcon fontSize="small" /></IconButton>
            </Box>
          </Box>
        )}

        {pinned.length > 0 && (
          <>
            <SectionTitle>Pinned</SectionTitle>
            <List dense disablePadding>{pinned.map(ChatRow)}</List>
          </>
        )}
        <SectionTitle open={open.recents} onToggle={() => setOpen((o) => ({ ...o, recents: !o.recents }))}>{project ? 'Chats' : 'Recents'}</SectionTitle>
        <Collapse in={open.recents}>
          {groupByDate(recent).map(([label, items]) => (
            <Box key={label}>
              <Typography sx={{ px: 1.5, pt: 1, pb: 0.25, fontSize: 11.5, color: 'text.secondary', opacity: 0.8 }}>{label}</Typography>
              <List dense disablePadding>{items.map(ChatRow)}</List>
            </Box>
          ))}
          {!recent.length && <Typography sx={{ px: 1.5, py: 0.5, fontSize: 13, color: 'text.secondary' }}>No chats yet</Typography>}
        </Collapse>
        {archived.length > 0 && (
          <>
            <SectionTitle open={open.archived} onToggle={() => setOpen((o) => ({ ...o, archived: !o.archived }))}>Archived ({archived.length})</SectionTitle>
            <Collapse in={open.archived}><List dense disablePadding>{archived.map(ChatRow)}</List></Collapse>
          </>
        )}
      </Box>

      {/* Bottom: account + apps */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, borderTop: 1, borderColor: 'divider', p: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <AccountMenu profile={settings.profile} settings={settings} setSettings={setSettings} onAction={onAction} compact />
        </Box>
        <Tooltip title="Get apps"><IconButton size="small" onClick={() => onNav('apps')}><DevicesOutlinedIcon sx={{ fontSize: 20 }} /></IconButton></Tooltip>
      </Box>

      <ChatMenu anchorEl={menu?.el} open={!!menu} chat={menu?.chat} projects={projects} onClose={() => setMenu(null)}
        onAction={(type, value) => {
          const c = menu.chat;
          if (type === 'rename') startRename(c.id, c.title);
          else onChatAction(c.id, type, value);
        }} />

      <Menu anchorEl={pMenu?.el} open={!!pMenu} onClose={() => setPMenu(null)} PaperProps={{ sx: { borderRadius: '12px', minWidth: 200 } }} MenuListProps={{ dense: true }}>
        <MenuItem onClick={() => { startRename(`p:${pMenu.project.id}`, pMenu.project.name); setPMenu(null); }}>
          <ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>Rename project
        </MenuItem>
        <MenuItem sx={{ color: 'error.main' }} onClick={() => {
          if (confirm(`Delete project "${pMenu.project.name}"? Its chats are kept and moved back to Recents.`)) onProjectAction(pMenu.project.id, 'delete');
          setPMenu(null);
        }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>Delete project
        </MenuItem>
      </Menu>
    </Box>
  );
}
