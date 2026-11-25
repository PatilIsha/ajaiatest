/** Thin fetch wrapper: JSON in/out, errors carry the HTTP status and server payload. */
async function request(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    const err = new Error('Network error. Check your connection and try again.');
    err.status = 0;
    throw err;
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401) window.dispatchEvent(new Event('auth:expired'));
    throw err;
  }
  return data;
}

function fileForm(file) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const SUPPORTED_UPLOAD_ACCEPT = '.txt,.md,.markdown,.docx';
export const SUPPORTED_UPLOAD_LABEL = '.txt, .md or .docx, up to 5 MB';

export const api = {
  users: () => request('/api/users'),
  me: () => request('/api/auth/me'),
  login: (email) => request('/api/auth/login', { method: 'POST', body: { email } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  listDocs: () => request('/api/documents'),
  createDoc: (data = {}) => request('/api/documents', { method: 'POST', body: data }),
  getDoc: (id) => request(`/api/documents/${id}`),
  updateDoc: (id, patch) => request(`/api/documents/${id}`, { method: 'PATCH', body: patch }),
  deleteDoc: (id) => request(`/api/documents/${id}`, { method: 'DELETE' }),
  importDoc: (file) => request('/api/documents/import', { method: 'POST', form: fileForm(file) }),
  convertFile: (file) => request('/api/convert', { method: 'POST', form: fileForm(file) }),

  share: (id, email, role) => request(`/api/documents/${id}/shares`, { method: 'PUT', body: { email, role } }),
  unshare: (id, userId) => request(`/api/documents/${id}/shares/${userId}`, { method: 'DELETE' }),
};
