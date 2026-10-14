import { useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadFile, formatBytes } from './api.js';
import { ShareDialog, VersionsDialog } from './Dialogs.jsx';

const TABS = [['drive', 'My files'], ['shared', 'Shared with me'], ['trash', 'Trash']];
const PAGE_SIZE = 20;

export default function Drive({ user, onUser, onSignOut }) {
  const [tab, setTab] = useState('drive');
  const [folderId, setFolderId] = useState(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], breadcrumbs: [], pagination: { total: 0, totalPages: 1 }, folder: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // { type: 'share' | 'versions', item }
  const fileInput = useRef(null);

  const canWrite = tab !== 'trash' && (tab === 'drive' || Boolean(folderId)) && (!data.folder || ['owner', 'editor'].includes(data.folder.role));

  const load = useCallback(async () => {
    setError('');
    try {
      const q = `page=${page}&limit=${PAGE_SIZE}`;
      let res;
      if (tab === 'trash') res = await api(`/trash?${q}`);
      else if (tab === 'shared' && !folderId) res = await api(`/shared-with-me?${q}`);
      else res = await api(`/folders/${folderId || 'root'}/items?${q}`);
      setData({ items: res.items, breadcrumbs: res.breadcrumbs || [], pagination: res.pagination, folder: res.folder || null });
    } catch (e) {
      setError(e.message);
    }
  }, [tab, folderId, page]);

  useEffect(() => { load(); }, [load]);

  const refreshUser = async () => onUser((await api('/auth/me')).user);
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); await load(); await refreshUser(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const openFolder = (id) => { setFolderId(id); setPage(1); };
  const switchTab = (t) => { setTab(t); setFolderId(null); setPage(1); };

  const upload = (files) => run(async () => {
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      const q = folderId ? `?folderId=${folderId}` : '';
      await api(`/files${q}`, { method: 'POST', form });
    }
  });

  const newFolder = () => {
    const name = window.prompt('Folder name');
    if (name) run(() => api('/folders', { method: 'POST', body: { name, parentId: folderId } }));
  };
  const rename = (item) => {
    const name = window.prompt('New name', item.name);
    if (name && name !== item.name) run(() => api(`/${item.kind}s/${item.id}`, { method: 'PATCH', body: { name } }));
  };
  const trash = (item) => run(() => api(`/${item.kind}s/${item.id}`, { method: 'DELETE' }));
  const restore = (item) => run(() => api(`/${item.kind}s/${item.id}/restore`, { method: 'POST' }));
  const purge = (item) => {
    if (window.confirm(`Delete "${item.name}" forever? This cannot be undone.`)) {
      run(() => api(`/trash/${item.kind}s/${item.id}`, { method: 'DELETE' }));
    }
  };
  const emptyTrash = () => {
    if (window.confirm('Delete everything in the trash forever?')) run(() => api('/trash', { method: 'DELETE' }));
  };

  const pct = Math.min(100, (user.storageUsed / user.quotaBytes) * 100);

  return (
    <div className="shell">
      <header>
        <strong className="brand">Drive</strong>
        <nav aria-label="Sections">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'tab active' : 'tab'} aria-current={tab === id} onClick={() => switchTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="account">
          <div className="usage" title={`${formatBytes(user.storageUsed)} of ${formatBytes(user.quotaBytes)} used`}>
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <small>{formatBytes(user.storageUsed)} of {formatBytes(user.quotaBytes)}</small>
          </div>
          <span>{user.name}</span>
          <button className="link" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main>
        <div className="toolbar">
          <ol className="crumbs" aria-label="Location">
            {tab === 'trash' && <li>Trash</li>}
            {tab !== 'trash' && (
              <>
                {tab === 'drive' ? (
                  <li><button className="link" onClick={() => openFolder(null)}>My files</button></li>
                ) : (
                  <li><button className="link" onClick={() => openFolder(null)}>Shared with me</button></li>
                )}
                {data.breadcrumbs.map((b) => (
                  <li key={b.id}><button className="link" onClick={() => openFolder(b.id)}>{b.name}</button></li>
                ))}
              </>
            )}
          </ol>
          {canWrite && (
            <div className="actions">
              <button onClick={newFolder} disabled={busy}>New folder</button>
              <button className="primary" onClick={() => fileInput.current.click()} disabled={busy}>Upload files</button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
            </div>
          )}
          {tab === 'trash' && data.items.length > 0 && <button onClick={emptyTrash}>Empty trash</button>}
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        {data.items.length === 0 ? (
          <p className="empty">
            {tab === 'trash' ? 'Trash is empty.' : tab === 'shared' && !folderId ? 'Nothing has been shared with you yet.' : 'This folder is empty. Upload files or create a folder to get started.'}
          </p>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {data.items.map((item) => {
                const mine = item.ownerId === user.id;
                const role = item.role || (mine ? 'owner' : (data.folder && data.folder.role) || 'viewer');
                return (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td>
                      {item.kind === 'folder' && tab !== 'trash'
                        ? <button className="link folder" onClick={() => openFolder(item.id)}>{item.name}</button>
                        : <span className={item.kind}>{item.name}</span>}
                      {item.kind === 'file' && item.currentVersion > 1 && <small className="badge">v{item.currentVersion}</small>}
                    </td>
                    <td>{item.kind === 'file' ? formatBytes(item.size) : '—'}</td>
                    <td>{new Date(item.updatedAt).toLocaleString()}</td>
                    <td className="row-actions">
                      {tab === 'trash' ? (
                        <>
                          <button onClick={() => restore(item)}>Restore</button>
                          <button className="danger" onClick={() => purge(item)}>Delete forever</button>
                        </>
                      ) : (
                        <>
                          {item.kind === 'file' && <button onClick={() => downloadFile(item.id, item.name).catch((e) => setError(e.message))}>Download</button>}
                          {item.kind === 'file' && <button onClick={() => setDialog({ type: 'versions', item })}>Versions</button>}
                          {mine && <button onClick={() => setDialog({ type: 'share', item })}>Share</button>}
                          {(tab === 'drive' || folderId) && role !== 'viewer' && <button onClick={() => rename(item)}>Rename</button>}
                          {(tab === 'drive' || folderId) && role !== 'viewer' && <button className="danger" onClick={() => trash(item)}>Delete</button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {data.pagination.totalPages > 1 && (
          <div className="pager">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {data.pagination.totalPages}</span>
            <button disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </main>

      {dialog?.type === 'share' && <ShareDialog item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === 'versions' && (
        <VersionsDialog item={dialog.item} user={user} onClose={() => setDialog(null)} onChanged={() => { load(); refreshUser(); }} />
      )}
    </div>
  );
}
