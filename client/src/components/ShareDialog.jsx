import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function ShareDialog({ doc, currentUser, onClose, onSharesChange }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    api.users().then((r) => setUsers(r.users)).catch(() => {});
    inputRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shares = doc.shares ?? [];
  const suggestions = users.filter((u) => u.id !== currentUser.id && !shares.some((s) => s.userId === u.id));

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      const { shares: next } = await action();
      onSharesChange(next);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return setError('Enter an email address.');
    if (await run(() => api.share(doc.id, value, role))) setEmail('');
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="modal-head">
          <h2 id="share-title">Share "{doc.title}"</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form className="share-form" onSubmit={add}>
          <input
            ref={inputRef}
            type="email"
            list="share-users"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
          />
          <datalist id="share-users">
            {suggestions.map((u) => (
              <option key={u.id} value={u.email}>{u.name}</option>
            ))}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Permission">
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn btn-primary" disabled={busy}>Share</button>
        </form>
        {suggestions.length > 0 && (
          <p className="muted small">Demo accounts: {suggestions.map((u) => u.email).join(', ')}</p>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        <h3 className="small-heading">People with access</h3>
        <ul className="access-list">
          <li>
            <span className="avatar">{doc.owner.name[0]}</span>
            <span className="grow">
              {doc.owner.name} {doc.owner.id === currentUser.id && <span className="muted">(you)</span>}
              <span className="muted small">{doc.owner.email}</span>
            </span>
            <span className="muted small">Owner</span>
          </li>
          {shares.map((s) => (
            <li key={s.userId}>
              <span className="avatar">{s.name[0]}</span>
              <span className="grow">
                {s.name}
                <span className="muted small">{s.email}</span>
              </span>
              <select
                value={s.role}
                disabled={busy}
                onChange={(e) => run(() => api.share(doc.id, s.email, e.target.value))}
                aria-label={`Permission for ${s.name}`}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => run(() => api.unshare(doc.id, s.userId))}
                aria-label={`Remove ${s.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
