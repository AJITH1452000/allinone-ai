import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Divider, InputBase, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import IosShareIcon from '@mui/icons-material/IosShare';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

const Key = ({ k }) => <Typography sx={{ fontSize: 12.5, color: 'text.secondary', ml: 2 }}>{k}</Typography>;

/**
 * Claude-style chat menu: Pin (P) · Rename (R) · Add to project › · Share · Archive (A) · Delete (D)
 * onAction(type, value): 'pin' | 'rename' | 'project' (projectId|null) | 'newProject' (name) | 'share' | 'archive' | 'delete'
 */
export default function ChatMenu({ anchorEl, open, onClose, chat, projects = [], onAction }) {
  const [sub, setSub] = useState(null);
  const [q, setQ] = useState('');
  const inputRef = useRef();
  const subOpen = Boolean(sub);

  useEffect(() => { if (!open) { setSub(null); setQ(''); } }, [open]);

  const act = (type, value) => { onAction(type, value); onClose(); };

  // Single-key shortcuts while the menu is open (like Claude)
  useEffect(() => {
    if (!open || subOpen) return;
    const h = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); act('pin'); }
      else if (k === 'r') { e.preventDefault(); act('rename'); }
      else if (k === 'a') { e.preventDefault(); act('archive'); }
      else if (k === 'd') { e.preventDefault(); act('delete'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }); // eslint-disable-line

  const list = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [projects, q]);
  const exact = projects.some((p) => p.name.toLowerCase() === q.trim().toLowerCase());
  if (!chat) return null;

  const item = { borderRadius: '8px', mx: 0.75, py: 0.9, fontSize: 14.5 };
  return (
    <>
      <Menu anchorEl={anchorEl} open={open} onClose={onClose}
        PaperProps={{ sx: { width: 250, borderRadius: '14px', mt: 0.5 } }} MenuListProps={{ dense: true, sx: { py: 0.75 } }}>
        <MenuItem sx={item} onClick={() => act('pin')}>
          <ListItemIcon><PushPinOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>{chat.pinned ? 'Unpin' : 'Pin'}</ListItemText><Key k="P" />
        </MenuItem>
        <MenuItem sx={item} onClick={() => act('rename')}>
          <ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>Rename</ListItemText><Key k="R" />
        </MenuItem>
        <MenuItem sx={{ ...item, bgcolor: subOpen ? 'action.selected' : undefined }}
          onClick={(e) => { setSub(e.currentTarget); setTimeout(() => inputRef.current?.focus(), 60); }}
          onMouseEnter={(e) => { if (!subOpen) { setSub(e.currentTarget); setTimeout(() => inputRef.current?.focus(), 60); } }}>
          <ListItemIcon><FolderOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>{chat.projectId ? 'Move to project' : 'Add to project'}</ListItemText>
          <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        </MenuItem>
        <MenuItem sx={item} onClick={() => act('share')}>
          <ListItemIcon><IosShareIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>Share chat</ListItemText>
        </MenuItem>
        <Divider sx={{ my: 0.75, mx: 1.5 }} />
        <MenuItem sx={item} onClick={() => act('archive')}>
          <ListItemIcon>{chat.archived ? <UnarchiveOutlinedIcon fontSize="small" /> : <ArchiveOutlinedIcon fontSize="small" />}</ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>{chat.archived ? 'Unarchive' : 'Archive'}</ListItemText><Key k="A" />
        </MenuItem>
        <MenuItem sx={{ ...item, color: 'error.main' }} onClick={() => act('delete')}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>Delete</ListItemText><Key k="D" />
        </MenuItem>
      </Menu>

      {/* Add to project › */}
      <Menu anchorEl={sub} open={subOpen} onClose={() => setSub(null)} autoFocus={false} disableAutoFocusItem
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { width: 300, borderRadius: '14px', ml: 1 } }} MenuListProps={{ dense: true, sx: { py: 0 } }}>
        <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }} onKeyDown={(e) => e.stopPropagation()}>
          <InputBase inputRef={inputRef} fullWidth placeholder="Search or create a project" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim()) {
                const hit = projects.find((p) => p.name.toLowerCase() === q.trim().toLowerCase());
                hit ? act('project', hit.id) : act('newProject', q.trim());
              }
              if (e.key === 'Escape') setSub(null);
            }} sx={{ fontSize: 14.5 }} />
        </Box>
        <MenuItem sx={{ ...item, my: 0.75 }} onClick={() => act('newProject', q.trim() || 'New project')}>
          <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>{q.trim() && !exact ? `Create "${q.trim()}"` : 'New project'}</ListItemText>
        </MenuItem>
        <Divider sx={{ mx: 1.5 }} />
        <Box sx={{ py: 0.75, maxHeight: 260, overflowY: 'auto' }}>
          {list.map((p) => (
            <MenuItem key={p.id} sx={item} onClick={() => act('project', p.id)}>
              <ListItemIcon><FolderOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: 14.5, noWrap: true }}>{p.name}</ListItemText>
              {chat.projectId === p.id && <CheckIcon fontSize="small" sx={{ color: 'primary.main' }} />}
            </MenuItem>
          ))}
          {!projects.length && <Typography sx={{ px: 2.5, py: 1, fontSize: 13.5, color: 'text.secondary' }}>No projects yet</Typography>}
          {!!projects.length && !list.length && <Typography sx={{ px: 2.5, py: 1, fontSize: 13.5, color: 'text.secondary' }}>No match — press Enter to create it</Typography>}
          {chat.projectId && (
            <MenuItem sx={item} onClick={() => act('project', null)}>
              <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: 14.5 }}>Remove from project</ListItemText>
            </MenuItem>
          )}
        </Box>
      </Menu>
    </>
  );
}
