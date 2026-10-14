import { useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadFile, formatBytes } from './api.js';

function Modal({ title, onClose, children }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header><h2>{title}</h2><button className="link" onClick={onClose}>Close</button></header>
        {children}
      </section>
    </div>
  );
}

export function ShareDialog({ item, onClose }) {
  const base = `/${item.kind}s/${item.id}`;
  const [shares, setShares] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [link, setLink] = useState(null);
  const [maxDownloads, setMaxDownloads] = useState('');
  const [hours, setHours] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api(`${base}/shares`).then((r) => setShares(r.shares)).catch((e) => setError(e.message)), [base]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => { setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } };

  return (
    <Modal title={`Share "${item.name}"`} onClose={onClose}>
      <form className="inline" onSubmit={(e) => { e.preventDefault(); act(async () => { await api(`${base}/shares`, { method: 'POST', body: { email, role } }); setEmail(''); }); }}>
        <input type="email" placeholder="Email of a registered user" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
        <button className="primary">Share</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="list">
        {shares.length === 0 && <li className="empty">Not shared with anyone.</li>}
        {shares.map((s) => (
          <li key={s.userId}>
            <span>{s.name} <small>{s.email}</small></span>
            <span>
              <select value={s.role} aria-label={`Role for ${s.email}`} onChange={(e) => act(() => api(`${base}/shares`, { method: 'POST', body: { email: s.email, role: e.target.value } }))}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button className="danger" onClick={() => act(() => api(`${base}/shares/${s.userId}`, { method: 'DELETE' }))}>Remove</button>
            </span>
          </li>
        ))}
      </ul>

      {item.kind === 'file' && (
        <>
          <h3>Public link</h3>
          <form className="inline" onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const body = {};
              if (hours) body.expiresInHours = Number(hours);
              if (maxDownloads) body.maxDownloads = Number(maxDownloads);
              setLink(await api(`${base}/link`, { method: 'POST', body }));
            });
          }}>
            <input type="number" min="1" placeholder="Expires in (hours)" value={hours} onChange={(e) => setHours(e.target.value)} />
            <input type="number" min="1" placeholder="Max downloads" value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} />
            <button>Create link</button>
          </form>
          {link && (
            <p>
              <input readOnly value={`${window.location.origin}${link.url}`} onFocus={(e) => e.target.select()} aria-label="Public link" />
              <small>Shown once. Creating a new link replaces this one.</small>
              <button className="danger" onClick={() => act(async () => { await api(`${base}/link`, { method: 'DELETE' }); setLink(null); })}>Revoke link</button>
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

export function VersionsDialog({ item, user, onClose, onChanged }) {
  const [versions, setVersions] = useState([]);
  const [current, setCurrent] = useState(item.currentVersion);
  const [error, setError] = useState('');
  const input = useRef(null);
  const canEdit = item.ownerId === user.id || ['editor', 'owner'].includes(item.role);

  const load = useCallback(async () => {
    try { setVersions((await api(`/files/${item.id}/versions`)).versions); } catch (e) { setError(e.message); }
  }, [item.id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setError('');
    try { const res = await fn(); if (res?.currentVersion) setCurrent(res.currentVersion); await load(); onChanged(); } catch (e) { setError(e.message); }
  };

  const upload = (file) => act(() => {
    const form = new FormData();
    form.append('file', file);
    // If-Match makes the server reject the upload if someone else changed the file meanwhile.
    return api(`/files/${item.id}/content`, { method: 'PUT', form, headers: { 'If-Match': String(current) } });
  });

  return (
    <Modal title={`Versions of "${item.name}"`} onClose={onClose}>
      {canEdit && (
        <p>
          <button className="primary" onClick={() => input.current.click()}>Upload new version</button>
          <input ref={input} type="file" hidden onChange={(e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ''; }} />
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="list">
        {versions.map((v) => (
          <li key={v.number}>
            <span>
              Version {v.number} {v.isCurrent && <small className="badge">current</small>}<br />
              <small>{formatBytes(v.size)} · {new Date(v.createdAt).toLocaleString()}{v.createdBy ? ` · ${v.createdBy.name}` : ''}</small>
            </span>
            <span>
              <button onClick={() => downloadFile(item.id, item.name, v.number).catch((e) => setError(e.message))}>Download</button>
              {canEdit && !v.isCurrent && (
                <button onClick={() => act(() => api(`/files/${item.id}/versions/${v.number}/restore`, { method: 'POST', headers: { 'If-Match': String(current) } }))}>Restore</button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
