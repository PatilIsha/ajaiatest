import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { api, SUPPORTED_UPLOAD_ACCEPT } from '../api.js';
import { ROLE_LABEL, timeAgo } from '../format.js';
import Toolbar from '../components/Toolbar.jsx';
import ShareDialog from '../components/ShareDialog.jsx';

const AUTOSAVE_DELAY_MS = 800;

const STATUS_TEXT = {
  saved: 'All changes saved',
  dirty: 'Unsaved changes…',
  saving: 'Saving…',
  error: 'Save failed',
  conflict: 'Not saved: newer version exists',
};

export default function EditorPage({ id, user }) {
  const location = useLocation();
  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('saved');
  const [saveError, setSaveError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Save pipeline state lives in refs so the TipTap callbacks always see current values.
  const versionRef = useRef(0);
  const pendingRef = useRef({}); // fields not yet sent: { title?, content? }
  const inFlightRef = useRef(false);
  const conflictRef = useRef(false);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);
  const titleInputRef = useRef(null);

  /**
   * Sends pending changes one request at a time. Each save carries the version it
   * was based on; the server rejects stale saves (409) so concurrent editors never
   * silently overwrite each other.
   */
  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    if (inFlightRef.current || conflictRef.current) return;
    inFlightRef.current = true;
    try {
      while (Object.keys(pendingRef.current).length > 0) {
        const patch = pendingRef.current;
        pendingRef.current = {};
        setStatus('saving');
        try {
          const updated = await api.updateDoc(id, { ...patch, baseVersion: versionRef.current });
          versionRef.current = updated.version;
          setDoc((d) => ({ ...d, ...updated, shares: d?.shares }));
          setSaveError(null);
        } catch (err) {
          if (err.status === 409) {
            conflictRef.current = true;
            setStatus('conflict');
          } else {
            // Put the failed changes back (newer edits win) so the next attempt includes them.
            pendingRef.current = { ...patch, ...pendingRef.current };
            setSaveError(err.message);
            setStatus('error');
          }
          return;
        }
      }
      setStatus('saved');
    } finally {
      inFlightRef.current = false;
    }
  }, [id]);

  const queue = useCallback(
    (patch) => {
      if (conflictRef.current) return;
      pendingRef.current = { ...pendingRef.current, ...patch };
      setStatus('dirty');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
    },
    [flush]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    editable: false,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: ed }) => {
      if (ed.isEditable) queue({ content: ed.getHTML() });
    },
  });

  const applyDoc = useCallback(
    (d) => {
      setDoc(d);
      setTitle(d.title);
      versionRef.current = d.version;
      if (editor) {
        editor.commands.setContent(d.content || '', false); // false: don't trigger a save
        editor.setEditable(d.role !== 'viewer', false);
      }
    },
    [editor]
  );

  // Load the document once the editor instance exists.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    api
      .getDoc(id)
      .then((d) => {
        if (cancelled) return;
        applyDoc(d);
        if (location.state?.focusTitle) titleInputRef.current?.select();
        else if (d.role !== 'viewer') editor.commands.focus('end');
      })
      .catch((e) => !cancelled && setLoadError(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id]);

  // Warn before closing the tab with unsaved work; flush when leaving the page in-app.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (Object.keys(pendingRef.current).length || inFlightRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (Object.keys(pendingRef.current).length) flush();
    };
  }, [flush]);

  function commitTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(doc.title);
      return;
    }
    if (next.length > 200) {
      setSaveError('Title must be at most 200 characters.');
      setStatus('error');
      return;
    }
    if (next !== doc.title) {
      queue({ title: next });
      flush();
    }
  }

  async function reloadLatest() {
    try {
      const d = await api.getDoc(id);
      pendingRef.current = {};
      conflictRef.current = false;
      applyDoc(d);
      setStatus('saved');
      setSaveError(null);
    } catch (e) {
      setSaveError(e.message);
    }
  }

  async function insertFromFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNotice(null);
    try {
      const { html } = await api.convertFile(file);
      editor.chain().focus().insertContent(html).run(); // triggers onUpdate -> autosave
      setNotice(`Inserted content from "${file.name}".`);
    } catch (err) {
      setNotice(`Couldn't insert "${file.name}": ${err.message}`);
    }
  }

  if (loadError) {
    return (
      <main className="page">
        <div className="alert alert-error">
          {loadError.status === 404
            ? "This document doesn't exist or hasn't been shared with you."
            : `Couldn't load the document: ${loadError.message}`}
        </div>
        <Link to="/">← Back to documents</Link>
      </main>
    );
  }

  const canEdit = doc && doc.role !== 'viewer';
  const isOwner = doc?.role === 'owner';

  return (
    <div className="editor-page">
      <div className="editor-head">
        <Link to="/" className="btn btn-ghost btn-sm" aria-label="Back to documents">←</Link>
        <div className="title-block">
          <input
            ref={titleInputRef}
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor?.commands.focus();
              }
              if (e.key === 'Escape') {
                setTitle(doc.title);
                e.currentTarget.blur();
              }
            }}
            readOnly={!canEdit}
            maxLength={200}
            aria-label="Document title"
            placeholder="Untitled document"
          />
          {doc && (
            <div className="meta muted small">
              {isOwner ? 'Owned by you' : `Owned by ${doc.owner.name}`}
              {' · '}
              <span className={`badge badge-${doc.role}`}>{ROLE_LABEL[doc.role]}</span>
              {doc.updatedBy && (
                <>
                  {' · '}Last edited {timeAgo(doc.updatedAt)} by{' '}
                  {doc.updatedBy.id === user.id ? 'you' : doc.updatedBy.name}
                </>
              )}
            </div>
          )}
        </div>
        <div className="editor-actions">
          {canEdit && (
            <span className={`save-status status-${status}`} role="status" aria-live="polite">
              {STATUS_TEXT[status]}
              {status === 'error' && (
                <button className="link-btn" onClick={flush}>Retry</button>
              )}
            </span>
          )}
          {isOwner && (
            <button className="btn btn-primary" onClick={() => setShareOpen(true)}>
              Share{doc.shares?.length ? ` · ${doc.shares.length}` : ''}
            </button>
          )}
        </div>
      </div>

      {status === 'conflict' && (
        <div className="alert alert-warn banner">
          Someone else saved a newer version while you were editing, so your latest changes were not saved.
          Copy anything you need, then{' '}
          <button className="link-btn" onClick={reloadLatest}>load the latest version</button>.
        </div>
      )}
      {saveError && status === 'error' && <div className="alert alert-error banner">{saveError}</div>}
      {doc && !canEdit && (
        <div className="alert alert-info banner">
          You have view-only access. Ask {doc.owner.name} for edit access.
        </div>
      )}
      {notice && (
        <div className="alert alert-info banner">
          {notice} <button className="link-btn" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {canEdit && <Toolbar editor={editor} onInsertFile={() => fileInputRef.current?.click()} />}
      <input ref={fileInputRef} type="file" accept={SUPPORTED_UPLOAD_ACCEPT} hidden onChange={insertFromFile} />

      <div className="paper-wrap">
        <div className="paper">
          {!doc && <p className="muted">Loading…</p>}
          <EditorContent editor={editor} className={doc ? '' : 'hidden'} />
        </div>
      </div>

      {shareOpen && doc && (
        <ShareDialog
          doc={doc}
          currentUser={user}
          onClose={() => setShareOpen(false)}
          onSharesChange={(shares) => setDoc((d) => ({ ...d, shares }))}
        />
      )}
    </div>
  );
}
