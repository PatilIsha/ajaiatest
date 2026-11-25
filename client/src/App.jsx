import { useEffect, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import DocList from './pages/DocList.jsx';
import EditorPage from './pages/EditorPage.jsx';

function EditorRoute({ user }) {
  const { id } = useParams();
  // key forces a fresh editor (and fresh save state) per document
  return <EditorPage key={id} id={id} user={user} />;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Ajaia Docs
        </Link>
        <div className="topbar-user">
          <span className="avatar" title={user.email}>{user.name[0]}</span>
          <span className="hide-sm">{user.name}</span>
          <button className="btn btn-ghost" onClick={signOut}>Switch user</button>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<DocList user={user} />} />
        <Route path="/d/:id" element={<EditorRoute user={user} />} />
        <Route path="*" element={<div className="center">Page not found. <Link to="/">Go home</Link></div>} />
      </Routes>
    </div>
  );
}
