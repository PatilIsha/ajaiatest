import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, SUPPORTED_UPLOAD_ACCEPT, SUPPORTED_UPLOAD_LABEL } from '../api.js';
import { ROLE_LABEL, timeAgo } from '../format.js';

export default function DocList() {
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.listDocs().then(setDocs).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function createDoc() {
    setBusy(true);
    setError(null);
    try {
      const doc = await api.createDoc();
      navigate(`/d/${doc.id}`, { state: { focusTitle: true } });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await api.importDoc(file);
      navigate(`/d/${doc.id}`);
    } catch (err) {
      setError(`Couldn't import "${file.name}": ${err.message}`);
      setBusy(false);
    }
  }

  async function deleteDoc(doc) {
    if (!window.confirm(`Delete "${doc.title}"? This also removes access for everyone it's shared with.`)) return;
    try {
      await api.deleteDoc(doc.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Documents</h1>
        <div className="actions">
          <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import file
          </button>
          <button className="btn btn-primary" onClick={createDoc} disabled={busy}>
            + New document
          </button>
          <input ref={fileInput} type="file" accept={SUPPORTED_UPLOAD_ACCEPT} hidden onChange={importFile} />
        </div>
      </div>
      <p className="muted small">Import turns a {SUPPORTED_UPLOAD_LABEL} file into a new editable document.</p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {!docs && !error && <p className="muted">Loading…</p>}

      {docs && (
        <>
          <section className="doc-section">
            <h2>My documents</h2>
            {docs.owned.length === 0 ? (
              <div className="empty">You don't own any documents yet. Create one or import a file.</div>
            ) : (
              <ul className="doc-list">
                {docs.owned.map((d) => (
                  <li key={d.id} className="doc-row">
                    <Link to={`/d/${d.id}`} className="doc-link">
                      <span className="doc-icon" aria-hidden="true" />
                      <span className="doc-title">{d.title}</span>
                    </Link>
                    <span className="badge badge-owner">Owner</span>
                    <span className="muted small hide-sm">
                      {d.shareCount > 0 ? `Shared with ${d.shareCount}` : 'Private'}
                    </span>
                    <span className="muted small hide-sm">Edited {timeAgo(d.updatedAt)}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => deleteDoc(d)} aria-label={`Delete ${d.title}`}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="doc-section">
            <h2>Shared with me</h2>
            {docs.shared.length === 0 ? (
              <div className="empty">Nothing has been shared with you yet.</div>
            ) : (
              <ul className="doc-list">
                {docs.shared.map((d) => (
                  <li key={d.id} className="doc-row">
                    <Link to={`/d/${d.id}`} className="doc-link">
                      <span className="doc-icon doc-icon-shared" aria-hidden="true" />
                      <span className="doc-title">{d.title}</span>
                    </Link>
                    <span className={`badge badge-${d.role}`}>{ROLE_LABEL[d.role]}</span>
                    <span className="muted small hide-sm">from {d.owner.name}</span>
                    <span className="muted small hide-sm">Edited {timeAgo(d.updatedAt)}</span>
                    <span />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
