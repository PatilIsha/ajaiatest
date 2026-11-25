import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let app;

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email }).expect(200);
  return agent;
}

beforeEach(() => {
  app = createApp({ db: openDb(':memory:'), secret: 'test-secret' });
});

describe('auth', () => {
  it('rejects unauthenticated access to documents', async () => {
    await request(app).get('/api/documents').expect(401);
  });

  it('rejects unknown accounts', async () => {
    await request(app).post('/api/auth/login').send({ email: 'mallory@evil.test' }).expect(401);
  });

  it('rejects a forged (unsigned) session cookie', async () => {
    await request(app).get('/api/auth/me').set('Cookie', 'uid=u_alice').expect(401);
  });
});

describe('documents', () => {
  it('creates, renames, edits and reopens a document with formatting preserved', async () => {
    const alice = await login('alice@ajaia.test');
    const created = (await alice.post('/api/documents').send({}).expect(201)).body;
    assert.equal(created.title, 'Untitled document');
    assert.equal(created.role, 'owner');

    const html = '<h2>Agenda</h2><p><strong>Bold</strong> <em>it</em> <u>under</u></p><ol><li>One</li></ol>';
    const saved = (
      await alice
        .patch(`/api/documents/${created.id}`)
        .send({ title: '  Weekly sync ', content: html, baseVersion: created.version })
        .expect(200)
    ).body;
    assert.equal(saved.version, created.version + 1);

    const reopened = (await alice.get(`/api/documents/${created.id}`).expect(200)).body;
    assert.equal(reopened.title, 'Weekly sync');
    assert.equal(reopened.content, html);

    const list = (await alice.get('/api/documents').expect(200)).body;
    assert.ok(list.owned.some((d) => d.id === created.id));
  });

  it('sanitizes stored HTML', async () => {
    const alice = await login('alice@ajaia.test');
    const res = await alice
      .post('/api/documents')
      .send({ content: '<p onclick="steal()">Hi<script>alert(1)</script><img src=x onerror=alert(1)></p>' })
      .expect(201);
    assert.equal(res.body.content, '<p>Hi</p>');
  });

  it('validates titles', async () => {
    const alice = await login('alice@ajaia.test');
    await alice.post('/api/documents').send({ title: '   ' }).expect(400);
    await alice.post('/api/documents').send({ title: 'x'.repeat(201) }).expect(400);
  });

  it('rejects a save based on a stale version instead of silently overwriting', async () => {
    const alice = await login('alice@ajaia.test');
    const doc = (await alice.post('/api/documents').send({}).expect(201)).body;
    await alice.patch(`/api/documents/${doc.id}`).send({ content: '<p>first</p>', baseVersion: doc.version }).expect(200);
    const stale = await alice
      .patch(`/api/documents/${doc.id}`)
      .send({ content: '<p>second</p>', baseVersion: doc.version })
      .expect(409);
    assert.equal(stale.body.current.content, '<p>first</p>');
  });
});

describe('sharing and access control', () => {
  it('enforces owner / editor / viewer permissions end to end', async () => {
    const alice = await login('alice@ajaia.test');
    const bob = await login('bob@ajaia.test');
    const doc = (await alice.post('/api/documents').send({ title: 'Roadmap' }).expect(201)).body;

    // Not shared yet: Bob cannot even see that it exists.
    await bob.get(`/api/documents/${doc.id}`).expect(404);

    // Share as viewer: visible under "shared", but read-only.
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'bob@ajaia.test', role: 'viewer' }).expect(200);
    const bobList = (await bob.get('/api/documents').expect(200)).body;
    assert.equal(bobList.owned.length, 0);
    assert.equal(bobList.shared.length, 1);
    assert.equal(bobList.shared[0].id, doc.id);
    assert.equal(bobList.shared[0].role, 'viewer');
    assert.equal(bobList.shared[0].owner.name, 'Alice Chen');

    const asViewer = (await bob.get(`/api/documents/${doc.id}`).expect(200)).body;
    assert.equal(asViewer.role, 'viewer');
    assert.equal(asViewer.shares, undefined); // share list is owner-only
    await bob.patch(`/api/documents/${doc.id}`).send({ content: '<p>hack</p>', baseVersion: doc.version }).expect(403);

    // Upgrade to editor: Bob can now save.
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'bob@ajaia.test', role: 'editor' }).expect(200);
    const edited = await bob
      .patch(`/api/documents/${doc.id}`)
      .send({ content: '<p>Bob was here</p>', baseVersion: doc.version })
      .expect(200);
    assert.equal(edited.body.updatedBy.name, 'Bob Rivera');

    // Editors still cannot share or delete.
    await bob.put(`/api/documents/${doc.id}/shares`).send({ email: 'carol@ajaia.test', role: 'viewer' }).expect(403);
    await bob.delete(`/api/documents/${doc.id}`).expect(403);

    // Revoke: access disappears.
    await alice.delete(`/api/documents/${doc.id}/shares/u_bob`).expect(200);
    await bob.get(`/api/documents/${doc.id}`).expect(404);
  });

  it('validates share requests', async () => {
    const alice = await login('alice@ajaia.test');
    const doc = (await alice.post('/api/documents').send({}).expect(201)).body;
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'nobody@ajaia.test' }).expect(404);
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'alice@ajaia.test' }).expect(400);
    await alice.put(`/api/documents/${doc.id}/shares`).send({ email: 'bob@ajaia.test', role: 'admin' }).expect(400);
  });
});

describe('file upload', () => {
  it('imports a Markdown file as a new formatted document', async () => {
    const alice = await login('alice@ajaia.test');
    const md = '# Launch plan\n\nShip **fast**, _iterate_.\n\n- one\n- two\n';
    const res = await alice
      .post('/api/documents/import')
      .attach('file', Buffer.from(md), 'launch-plan.md')
      .expect(201);
    assert.equal(res.body.title, 'launch-plan');
    assert.match(res.body.content, /<h1>Launch plan<\/h1>/);
    assert.match(res.body.content, /<strong>fast<\/strong>/);
    assert.match(res.body.content, /<li>one<\/li>/);
  });

  it('converts plain text into paragraphs, escaping HTML', async () => {
    const alice = await login('alice@ajaia.test');
    const res = await alice
      .post('/api/convert')
      .attach('file', Buffer.from('Line <b>one</b>\nline two\n\nSecond para'), 'notes.txt')
      .expect(200);
    assert.equal(res.body.html, '<p>Line &lt;b&gt;one&lt;/b&gt;<br />line two</p><p>Second para</p>');
  });

  it('rejects unsupported file types with a clear message', async () => {
    const alice = await login('alice@ajaia.test');
    const res = await alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('%PDF-1.4'), 'report.pdf')
      .expect(415);
    assert.match(res.body.error, /Supported: \.txt, \.md, \.docx/);
  });

  it('rejects files over the size limit', async () => {
    const alice = await login('alice@ajaia.test');
    await alice
      .post('/api/documents/import')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 'a'), 'big.txt')
      .expect(413);
  });
});
