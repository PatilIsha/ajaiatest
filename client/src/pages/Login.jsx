import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api.users().then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }, []);

  async function signIn(email) {
    setBusy(email);
    setError(null);
    try {
      const { user } = await api.login(email);
      onLogin(user);
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>
          <span className="brand-mark" aria-hidden="true" /> Ajaia Docs
        </h1>
        <p className="muted">
          Demo sign-in: pick a seeded account. Open a second browser (or a private window) as another user to try
          sharing.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <ul className="user-list">
          {users.map((u) => (
            <li key={u.id}>
              <button className="user-option" onClick={() => signIn(u.email)} disabled={!!busy}>
                <span className="avatar">{u.name[0]}</span>
                <span>
                  <strong>{u.name}</strong>
                  <span className="muted small">{u.email}</span>
                </span>
                <span className="muted small">{busy === u.email ? 'Signing in…' : 'Continue →'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
