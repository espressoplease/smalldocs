'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { createCloudStore, createLocalKeyProvider } = require('../../lib/cloud-store');
const { BASE_TIME, USERS, createCorpus, defaultMemberships } = require('./corpus');

function createContext(corpus, options, directory, metadata) {
  options = options || {};
  let clock = BASE_TIME;
  const store = createCloudStore({
    dbPath: path.join(directory, 'cloud.db'),
    keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 91), environment: 'test' }),
    idempotencySecret: 'search-eval-idempotency-secret-with-32-bytes',
    now: () => clock,
    ...options.storeOptions,
  });
  const context = { directory, store, memberships: defaultMemberships(), workspaces: {},
    projects: {}, corpus, seedMilliseconds: 0, bytes: 0, ...metadata };
  if (options.allVisible && !metadata) context.memberships[USERS.reader].push('closed');
  context.setClock = (value) => { clock = value; };
  context.close = () => {
    store.close();
    if (!options.keep) fs.rmSync(directory, { recursive: true, force: true });
  };
  context.seedDocument = async (document) => {
    clock = document.createdAt;
    const saved = await store.createDocument({ userId: document.author,
      projectId: context.projects[document.workspace][document.project], documentId: document.id,
      filename: document.filename, markdown: document.markdown,
      idempotencyKey: `seed-${document.id}` });
    document.revisionId = saved.current_revision_id;
    context.bytes += Buffer.byteLength(document.markdown);
    if (document.permission !== 'private') {
      store.setDocumentPermission({ userId: document.author, documentId: document.id,
        mode: document.permission === 'everyone' ? 'everyone' : 'custom',
        memberUserIds: document.permission === 'reader' && document.workspace !== 'closed'
          ? [USERS.reader] : [USERS.owner] });
    }
    return saved;
  };
  return context;
}

async function createFixture(corpus, options) {
  options = options || {};
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-search-eval-'));
  const context = createContext(corpus, options, directory);
  const { store } = context;
  try {
    for (const name of ['a', 'b', 'closed']) {
      const workspace = await store.createTeamWorkspace({ userId: USERS.owner,
        name: `Operations ${name}`, projectName: `Reference ${name} 0` });
      context.workspaces[name] = workspace.workspaceId;
      context.projects[name] = [workspace.projectId];
      for (let number = 1; number < 4; number += 1) {
        const project = await store.createProject({ userId: USERS.owner,
          workspaceId: workspace.workspaceId, name: `Reference ${name} ${number}` });
        context.projects[name].push(project.id);
      }
      for (const userId of Object.values(USERS)) {
        if (userId === USERS.owner || !context.memberships[userId].includes(name)) continue;
        store.addWorkspaceMember({ actorUserId: USERS.owner,
          workspaceId: workspace.workspaceId, userId, role: 'member' });
        for (const projectId of context.projects[name]) {
          store.grantProject({ actorUserId: USERS.owner, workspaceId: workspace.workspaceId,
            projectId, userId, role: 'editor' });
        }
      }
    }
    const start = performance.now();
    for (let index = 0; index < corpus.length; index += 1) {
      await context.seedDocument(corpus[index]);
      if (options.progress && (index + 1) % 10000 === 0) {
        options.progress({ seeded: index + 1, total: corpus.length,
          milliseconds: Math.round(performance.now() - start) });
      }
    }
    context.seedMilliseconds = Math.round(performance.now() - start);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
      documentCount: corpus.length, allVisible: Boolean(options.allVisible),
      memberships: context.memberships, workspaces: context.workspaces,
      projects: context.projects, bytes: context.bytes, seedMilliseconds: context.seedMilliseconds,
    }, null, 2));
    return context;
  } catch (error) {
    context.close();
    throw error;
  }
}

function openFixture(directory, options) {
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  return createContext(options && options.omitCorpus ? [] : createCorpus(metadata.documentCount, metadata),
    { ...options, keep: true }, directory, metadata);
}

module.exports = { createFixture, openFixture };
