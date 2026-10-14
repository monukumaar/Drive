// Thin fetch wrapper. The JWT is kept in localStorage so a refresh keeps you signed in.
let token = localStorage.getItem('token');

export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
};
export const hasToken = () => Boolean(token);

export async function api(path, { method = 'GET', body, form, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event('signed-out'));
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error.message; } catch { /* non-JSON error */ }
    throw new Error(message);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export async function downloadFile(id, name, version) {
  const res = await api(`/files/${id}/download${version ? `?version=${version}` : ''}`, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i += 1; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
};
