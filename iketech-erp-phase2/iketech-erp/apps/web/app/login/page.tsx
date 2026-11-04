'use client';
import { FormEvent, useState } from 'react';
import { api, errorText } from '@/lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api.post('/auth/login', { email, password }); window.location.href = '/'; }
    catch (err) { setError(errorText(err)); setBusy(false); }
  }

  return (
    <main className="login">
      <form className="box form" onSubmit={submit}>
        <div className="stripe" aria-hidden />
        <div>
          <h1>IKETECH AUTO</h1>
          <p className="muted">Sign in to the workshop system</p>
        </div>
        {error && <div className="alert err" role="alert">{error}</div>}
        <label className="field">Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted">Five wrong attempts lock the account for 15 minutes.</p>
      </form>
    </main>
  );
}
