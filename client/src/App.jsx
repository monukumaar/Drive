import { useEffect, useState } from 'react';
import { api, setToken, hasToken } from './api.js';
import Drive from './Drive.jsx';

function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const res = await api(`/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', body });
      setToken(res.token);
      onAuth(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form onSubmit={submit}>
        <h1>{mode === 'login' ? 'Sign in to Drive' : 'Create your Drive'}</h1>
        {mode === 'register' && (
          <label>Name<input value={form.name} onChange={set('name')} required autoComplete="name" /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} required minLength={8}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(hasToken());

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('signed-out', out);
    if (hasToken()) {
      api('/auth/me').then((r) => setUser(r.user)).catch(() => {}).finally(() => setChecking(false));
    }
    return () => window.removeEventListener('signed-out', out);
  }, []);

  if (checking) return <p className="center">Loading…</p>;
  if (!user) return <AuthForm onAuth={setUser} />;
  return <Drive user={user} onUser={setUser} onSignOut={() => { setToken(null); setUser(null); }} />;
}
