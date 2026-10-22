const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createCloudStore, createLocalKeyProvider } = require('../lib/cloud-store');

module.exports = function (h) {
  const { assert, testAsync } = h;
  const owner = 'legacy-owner', reader = 'legacy-reader', writer = 'legacy-writer';
  async function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-legacy-read-'));
    let clock = Date.parse('2026-10-22T12:00:00Z'), sequence = 0;
    const configuration = () => ({ dbPath: path.join(directory, 'store.db'),
      keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 77), environment: 'test' }),
      idempotencySecret: 'legacy-read-isolation-idempotency-secret', now: () => clock });
    const store = createCloudStore(configuration()), other = createCloudStore(configuration());
    const tick = (amount = 1000) => { clock += amount; return clock; };
    tick();
    const first = await store.createTeamWorkspace({ userId: owner, name: 'First private library', projectName: 'First project' });
    tick();
    const second = await store.createTeamWorkspace({ userId: owner, name: 'Second safe library', projectName: 'Second project' });
    for (const workspace of [first, second]) for (const userId of [reader, writer]) {
      store.addWorkspaceMember({ actorUserId: owner, workspaceId: workspace.workspaceId, userId, role: 'member' });
      store.grantProject({ actorUserId: owner, workspaceId: workspace.workspaceId,
        projectId: workspace.projectId, userId, role: 'editor' });
    }
    async function document(name, extra = {}) {
      tick();
      const userId = extra.userId || owner;
      const created = await store.createDocument({ userId, projectId: extra.projectId || first.projectId,
        markdown: '# ' + name + '\n' + name + ' private body.\n', filename: name + '.md',
        idempotencyKey: 'legacy-create-' + ++sequence });
      store.setDocumentPermission({ userId, documentId: created.id, mode: 'custom',
        memberUserIds: extra.members || [reader] });
      return created;
    }
    function order(documents, deleted = false) {
      const column = deleted ? 'deleted_at_ms' : 'updated_at_ms';
      documents.forEach((value, index) => store.db.prepare('UPDATE cloud_documents SET ' + column + '=? WHERE id=?').run(clock - index * 1000, value.id));
    }
    async function changedHead(document) {
      tick();
      return other.saveRevision({ userId: document.creator || owner, documentId: document.id,
        expectedHeadRevisionId: document.current_revision_id, markdown: '# FreshCurrentCanary\nFresh current body.\n',
        filename: 'fresh-current.md', idempotencyKey: 'legacy-fresh-' + ++sequence });
    }
    async function invitation(email) {
      tick();
      return store.createInvitation({ userId: owner, workspaceId: first.workspaceId, email, role: 'member' });
    }
    return { store, other, first, second, tick, document, order, changedHead, invitation,
      close() { other.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
  }
  async function scenario(name, run) {
    await testAsync(name, async () => { const f = await fixture(); try { await run(f); } finally { f.close(); } });
  }
  async function during(target, name, predicate, mutate, operation) {
    const original = target[name];
    let changed = false, value, error;
    target[name] = async function (...args) {
      const result = await original.apply(this, args);
      if (!changed && predicate(args, result)) { changed = true; await mutate(args, result); }
      return result;
    };
    try { value = await operation(); } catch (failure) {
      if (!['resource_unavailable', 'temporary_service_failure', 'permission_denied'].includes(failure.code)) throw failure;
      error = failure;
    } finally { target[name] = original; }
    assert.strictEqual(changed, true, 'the intended race did not run');
    return { value, error };
  }
  function concealed(value, document) {
    const text = JSON.stringify(value);
    for (const secret of [document.id, document.title, document.filename]) {
      assert.strictEqual(text.includes(secret), false, 'disclosed stale record ' + secret);
    }
  }
  const byDocument = document => args => args[0].document_id === document.id;
  function routeHarness(f) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const helpers = source.slice(source.indexOf('function cloudReadUnavailable()'), source.indexOf('async function cloudJoinReview('));
    const handler = source.slice(source.indexOf('async function handleCloudApi('), source.indexOf('async function handleCloudEmailRequest('));
    assert.ok(helpers && handler);
    const denied = new Set();
    const calls = [];
    let actor = reader;
    const entitlement = workspaceId => ({ plan: 'team', subscriptionStatus: denied.has(workspaceId) ? 'expired' : 'active',
      access: { read: !denied.has(workspaceId), write: !denied.has(workspaceId) } });
    const context = vm.createContext({ URL, console,
      cloudStore: f.store, cloudSinglePlan: null, SINGLE_PLAN_ENABLED: false,
      cloudBilling: { computeEntitlements: entitlement },
      cloudWorkspaceUsage(userId, workspaceId) {
        f.store._requireWorkspaceRole(userId, workspaceId, ['owner', 'admin', 'member']);
        return {};
      },
      requireCloudEntitlement(userId, workspaceId, operation) {
        calls.push({ userId, workspaceId, operation });
        f.store._requireWorkspaceRole(userId, workspaceId, ['owner', 'admin', 'member']);
        if (denied.has(workspaceId)) throw Object.assign(new Error('subscription_read_only'), { code: 'subscription_read_only' });
        return entitlement(workspaceId);
      },
      cloudApiPrincipal() { return { user: { id: actor, identities: [] }, credential: null }; },
      cloudApiMutationAllowed() { return true; }, requireRecentBrowser() {},
      verifiedCloudEmail() { return 'owner@example.test'; }, cloudUserProfile(user) { return { id: user.id }; },
      normalizeLimit: require('../lib/cloud-cursor').normalizeLimit,
      cloudCursor: require('../lib/cloud-cursor').createCursorCodec({ secret: 'legacy-read-route-cursor-secret' }),
      CLOUD_AUTH_PUBLIC_ORIGIN: 'http://legacy-read.test',
      sendJson(res, status, data) { res.status = status; res.data = JSON.parse(JSON.stringify(data)); },
      cloudApiError(res, error) {
        res.status = ({ resource_unavailable: 404, permission_denied: 403,
          subscription_read_only: 402, temporary_service_failure: 503 })[error.code] || 500;
        res.data = { ok: false, error: error.code || 'temporary_service_failure' };
        if (error.accounts) res.data.accounts = JSON.parse(JSON.stringify(error.accounts));
      },
    });
    // Execute the production helper and dispatcher source. Transport/session
    // authentication is stubbed; stores, decryption and race mutations are real.
    new vm.Script(helpers + '\n' + handler + '\nthis.dispatch = handleCloudApi;').runInContext(context);
    return { denied, calls,
      async api(userId, endpoint, method = 'GET') {
        actor = userId;
        const response = {};
        await context.dispatch({ method, headers: {} }, response, new URL(endpoint, 'http://legacy-read.test'));
        return response;
      } };
  }
  return async function () {
    for (const [kind, atEarlier] of [['revoke', true], ['revoke', false], ['delete', false], ['move', false], ['head', false]]) {
      await scenario('legacy listDocuments excludes ' + kind + ' changes during ' + (atEarlier ? 'its own' : 'a later') + ' document decrypt', async f => {
        const earlier = await f.document('EarlierListCanary'), later = await f.document('Later safe');
        f.order([earlier, later]);
        let fresh;
        const raced = await during(f.store, '_decryptRevision', byDocument(atEarlier ? earlier : later), async () => {
          if (kind === 'revoke') f.other.setDocumentPermission({ userId: owner, documentId: earlier.id, mode: 'custom', memberUserIds: [] });
          if (kind === 'delete') f.other.deleteDocument({ userId: owner, documentId: earlier.id, expectedHeadRevisionId: earlier.current_revision_id });
          if (kind === 'move') await f.other.moveDocument({ userId: owner, documentId: earlier.id,
            projectId: f.second.projectId, expectedHeadRevisionId: earlier.current_revision_id });
          if (kind === 'head') fresh = await f.changedHead(earlier);
        }, () => f.store.listDocuments({ userId: reader, workspaceId: f.first.workspaceId }));
        if (raced.error) return;
        if (kind === 'head') {
          const returned = raced.value.find(value => value.id === earlier.id);
          if (returned) {
            assert.strictEqual(returned.current_revision_id, fresh.current_revision_id);
            assert.strictEqual(returned.title, 'FreshCurrentCanary');
          }
          assert.strictEqual(JSON.stringify(raced.value).includes(earlier.title), false);
        } else concealed(raced.value, earlier);
      });
    }
    for (const kind of ['revoke', 'delete', 'move', 'head']) {
      await scenario('current document reads cannot return stale ' + kind + ' state after project-name decryption', async f => {
        const document = await f.document('CurrentReadCanary');
        let fresh;
        const raced = await during(f.store, '_decryptProjectName', () => true, async () => {
          if (kind === 'revoke') f.other.setDocumentPermission({ userId: owner, documentId: document.id, mode: 'custom', memberUserIds: [] });
          if (kind === 'delete') f.other.deleteDocument({ userId: owner, documentId: document.id, expectedHeadRevisionId: document.current_revision_id });
          if (kind === 'move') await f.other.moveDocument({ userId: owner, documentId: document.id,
            projectId: f.second.projectId, expectedHeadRevisionId: document.current_revision_id });
          if (kind === 'head') fresh = await f.changedHead(document);
        }, () => f.store.getDocument({ userId: kind === 'move' ? owner : reader, documentId: document.id }));
        if (raced.error) return;
        if (kind === 'move') {
          assert.strictEqual(raced.value.workspace_id, f.second.workspaceId);
          assert.strictEqual(raced.value.project_id, f.second.projectId);
        } else if (kind === 'head') {
          assert.strictEqual(raced.value.current_revision_id, fresh.current_revision_id);
          assert.strictEqual(raced.value.title, 'FreshCurrentCanary');
        } else assert.fail('a revoked or deleted document read succeeded');
      });
    }
    await scenario('legacy literal search excludes a document moved out of the requested library during a later decrypt', async f => {
      const earlier = await f.document('LegacySearchEarlierCanary'), later = await f.document('LegacySearch safe');
      f.order([earlier, later]);
      const raced = await during(f.store, '_decryptRevision', byDocument(later),
        () => f.other.moveDocument({ userId: owner, documentId: earlier.id, projectId: f.second.projectId,
          expectedHeadRevisionId: earlier.current_revision_id }),
        () => f.store.search({ userId: owner, workspaceId: f.first.workspaceId, query: 'private body' }));
      if (!raced.error) concealed(raced.value, earlier);
    });
    await scenario('an explicit retained historical read succeeds across a newer head in the same scope', async f => {
      const document = await f.document('HistoricalReadCanary');
      const raced = await during(f.store, '_decryptProjectName', () => true, () => f.changedHead(document),
        () => f.store.getDocument({ userId: reader, documentId: document.id, revisionId: document.current_revision_id }));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.current_revision_id, document.current_revision_id);
      assert.strictEqual(raced.value.title, document.title);
    });
    await scenario('historical content pruned during its name await cannot be published after retention removes it', async f => {
      const document = await f.document('PrunedHistoricalCanary');
      await f.changedHead(document);
      const raced = await during(f.store, '_decryptProjectName', () => true,
        () => f.other.pruneRevisions({ documentId: document.id, keepPrevious: 0, retainAfterMs: f.tick() }),
        () => f.store.getDocument({ userId: reader, documentId: document.id, revisionId: document.current_revision_id }));
      assert.ok(raced.error);
    });
    for (const kind of ['name', 'project-deletion']) {
      await scenario('current reads reject ' + kind + ' changes after name decryption', async f => {
        const document = await f.document('ProjectStateCanary');
        const raced = await during(f.store, '_decryptProjectName', () => true, async () => {
          if (kind === 'project-deletion') f.other.db.prepare('UPDATE cloud_projects SET deleted_at_ms=? WHERE id=?').run(f.tick(), f.first.projectId);
          else {
            const key = await f.other._projectKey(f.first.projectId, 1);
            try {
              const encrypted = f.other._encryptProjectName(f.first.workspaceId, f.first.projectId, 'Changed project name', key);
              f.other.db.prepare('UPDATE cloud_projects SET name_ciphertext=?,name_nonce=? WHERE id=?').run(encrypted.ciphertext, encrypted.nonce, f.first.projectId);
            } finally { key.fill(0); }
          }
        }, () => f.store.getDocument({ userId: reader, documentId: document.id }));
        assert.ok(raced.error);
      });
    }
    for (const kind of ['revoke-own', 'revoke-earlier', 'restore-earlier', 'expire-earlier']) {
      await scenario('legacy deleted-document lists remove ' + kind + ' records after later awaits', async f => {
        const earlier = await f.document('DeletedEarlierCanary'), later = await f.document('Deleted safe');
        f.other.deleteDocument({ userId: owner, documentId: earlier.id,
          expectedHeadRevisionId: earlier.current_revision_id, restoreWindowMs: kind === 'expire-earlier' ? 10 : 100000 });
        f.other.deleteDocument({ userId: owner, documentId: later.id, expectedHeadRevisionId: later.current_revision_id, restoreWindowMs: 100000 });
        f.order([earlier, later], true);
        const raced = await during(f.store, '_decryptRevision', byDocument(kind === 'revoke-own' ? earlier : later), async () => {
          // Permission edits require a live document, so revoke the deleted
          // record's group membership on the independent connection directly.
          if (kind.startsWith('revoke')) f.other.db.prepare(`DELETE FROM cloud_permission_group_members
            WHERE user_id=? AND permission_group_id=(SELECT id FROM cloud_permission_groups WHERE document_id=?)`).run(reader, earlier.id);
          if (kind === 'restore-earlier') await f.other.restoreDeletedDocument({ userId: owner, documentId: earlier.id, expectedHeadRevisionId: earlier.current_revision_id });
          if (kind === 'expire-earlier') f.tick(11);
        }, () => f.store.listDeletedDocuments({ userId: reader, workspaceId: f.first.workspaceId }));
        if (!raced.error) concealed(raced.value, earlier);
      });
    }
    for (const kind of ['membership', 'deletion']) {
      await scenario('workspace names accumulated before a later name await are removed after ' + kind, async f => {
        const raced = await during(f.store, '_workspaceName', args => args[0].id === f.second.workspaceId, () => {
          if (kind === 'membership') f.other.removeWorkspaceMember({ actorUserId: owner, workspaceId: f.first.workspaceId, userId: reader });
          else f.other.deleteWorkspace({ userId: owner, workspaceId: f.first.workspaceId });
        }, () => f.store.listWorkspaces(reader));
        if (!raced.error) {
          assert.deepStrictEqual(raced.value.map(value => value.id), [f.second.workspaceId]);
          assert.strictEqual(JSON.stringify(raced.value).includes('First private library'), false);
        }
      });
    }
    for (const kind of ['deletion', 'name']) {
      await scenario('billing context drops a workspace whose captured ' + kind + ' state changes during decryption', async f => {
        const raced = await during(f.store, '_workspaceName', args => args[0].id === f.first.workspaceId, async () => {
          if (kind === 'deletion') f.other.deleteWorkspace({ userId: owner, workspaceId: f.first.workspaceId });
          else {
            const encrypted = await f.other.keyProvider.encryptWorkspaceName(f.first.workspaceId, 'Changed billing name');
            f.other.db.prepare('UPDATE cloud_workspaces SET name_ciphertext=?,name_nonce=? WHERE id=?').run(encrypted.ciphertext, encrypted.nonce, f.first.workspaceId);
          }
        }, () => f.store.getWorkspaceBillingContext(f.first.workspaceId));
        assert.strictEqual(raced.error, undefined);
        assert.strictEqual(raced.value, null);
      });
    }
    await scenario('unchanged soft-deleted billing context preserves existing owner-notification eligibility', async f => {
      f.other.deleteWorkspace({ userId: owner, workspaceId: f.first.workspaceId });
      const value = await f.store.getWorkspaceBillingContext(f.first.workspaceId);
      assert.strictEqual(value.id, f.first.workspaceId);
      assert.strictEqual(value.name, 'First private library');
      assert.deepStrictEqual(value.ownerUserIds, [owner]);
    });
    await scenario('deleted workspace names do not survive restoration during a later name decrypt', async f => {
      f.other.deleteWorkspace({ userId: owner, workspaceId: f.first.workspaceId });
      f.tick();
      f.other.deleteWorkspace({ userId: owner, workspaceId: f.second.workspaceId });
      const raced = await during(f.store, '_workspaceName', args => args[0].id === f.first.workspaceId,
        () => f.other.restoreWorkspace({ userId: owner, workspaceId: f.second.workspaceId }),
        () => f.store.listDeletedWorkspaces(owner));
      if (!raced.error) assert.deepStrictEqual(raced.value.map(value => value.id), [f.first.workspaceId]);
    });
    for (const kind of ['grant', 'deletion']) {
      await scenario('project names accumulated before a later decrypt cannot survive ' + kind, async f => {
        f.tick();
        const later = await f.store.createProject({ userId: owner, workspaceId: f.first.workspaceId, name: 'Later safe project' });
        f.store.grantProject({ actorUserId: owner, workspaceId: f.first.workspaceId, projectId: later.id, userId: reader, role: 'viewer' });
        const raced = await during(f.store, '_decryptProjectName', args => args[0].id === later.id, () => {
          if (kind === 'grant') f.other.db.prepare('UPDATE cloud_project_grants SET revoked_at_ms=? WHERE project_id=? AND user_id=?').run(f.tick(), f.first.projectId, reader);
          else f.other.db.prepare('UPDATE cloud_projects SET deleted_at_ms=? WHERE id=?').run(f.tick(), f.first.projectId);
        }, () => f.store.listProjects(reader, f.first.workspaceId));
        if (!raced.error) {
          assert.deepStrictEqual(raced.value.map(value => value.id), [later.id]);
          assert.strictEqual(JSON.stringify(raced.value).includes('First project'), false);
        }
      });
    }
    await scenario('pending invitation lists exclude an earlier invitation revoked during a later email decrypt', async f => {
      const later = await f.invitation('later-safe@example.test');
      const earlier = await f.invitation('earlier-private-canary@example.test');
      const raced = await during(f.store.keyProvider, 'decryptWorkspaceValue', (args, result) => args[1] === 'invitation-email' && result === 'later-safe@example.test',
        () => f.other.revokeWorkspaceInvitation({ userId: owner, workspaceId: f.first.workspaceId, invitationId: earlier.id }),
        () => f.store.listWorkspaceInvitations({ userId: owner, workspaceId: f.first.workspaceId }));
      if (!raced.error) {
        assert.deepStrictEqual(raced.value.map(value => value.id), [later.id]);
        assert.strictEqual(JSON.stringify(raced.value).includes('earlier-private-canary@example.test'), false);
      }
    });
    await scenario('invitation details cannot reveal a workspace deleted during its name decrypt', async f => {
      const invitation = await f.invitation('invited@example.test');
      const raced = await during(f.store, '_workspaceName', args => args[0].id === f.first.workspaceId,
        () => f.other.deleteWorkspace({ userId: owner, workspaceId: f.first.workspaceId }),
        () => f.store.getInvitationDetails({ token: invitation.token, userId: reader, verifiedEmails: ['invited@example.test'] }));
      assert.ok(raced.error, 'deleted workspace details were returned');
    });
    for (const kind of ['revoke', 'move', 'delete', 'head']) {
      await scenario('workspace exports cannot retain an earlier document after ' + kind + ' during a later content read', async f => {
        const earlier = await f.document('ExportEarlierCanary', { userId: kind === 'revoke' ? writer : owner, members: [owner] });
        const later = await f.document('Export later safe', { members: [owner] });
        f.order([earlier, later]);
        let calls = 0, fresh;
        const raced = await during(f.store, '_decryptRevision', args => args[0].document_id === later.id && ++calls === 2, async () => {
          if (kind === 'revoke') f.other.setDocumentPermission({ userId: writer, documentId: earlier.id, mode: 'custom', memberUserIds: [] });
          if (kind === 'move') await f.other.moveDocument({ userId: owner, documentId: earlier.id,
            projectId: f.second.projectId, expectedHeadRevisionId: earlier.current_revision_id });
          if (kind === 'delete') f.other.deleteDocument({ userId: owner, documentId: earlier.id, expectedHeadRevisionId: earlier.current_revision_id });
          if (kind === 'head') fresh = await f.changedHead(earlier);
        }, () => f.store.exportWorkspace({ userId: owner, workspaceId: f.first.workspaceId, includeRevisions: true }));
        if (raced.error) return;
        const returned = raced.value.documents.find(value => value.id === earlier.id);
        if (kind === 'head') {
          if (returned) assert.strictEqual(returned.current_revision_id, fresh.current_revision_id);
        } else concealed(raced.value, earlier);
      });
    }
    for (const kind of ['revoke-earlier', 'move-earlier', 'head-earlier', 'revoke-during-note']) {
      await scenario('notification delivery removes stale records for ' + kind + ' before returning titles or notes', async f => {
        const earlier = await f.document('NotificationEarlierCanary'), later = await f.document('Notification later safe');
        const batch = await f.store.createDocumentNotification({ userId: owner, documentIds: [earlier.id, later.id],
          recipientUserIds: [reader], note: 'PrivateNotificationNoteCanary', idempotencyKey: 'notification-race' });
        let fresh;
        const mutate = async () => {
          if (kind.startsWith('revoke')) for (const value of kind === 'revoke-during-note' ? [earlier, later] : [earlier]) {
            f.other.setDocumentPermission({ userId: owner, documentId: value.id, mode: 'custom', memberUserIds: [] });
          }
          if (kind === 'move-earlier') await f.other.moveDocument({ userId: owner, documentId: earlier.id,
            projectId: f.second.projectId, expectedHeadRevisionId: earlier.current_revision_id });
          if (kind === 'head-earlier') fresh = await f.changedHead(earlier);
        };
        const raced = kind === 'revoke-during-note'
          ? await during(f.store.keyProvider, 'decryptWorkspaceValue', args => args[1] === 'notification-note', mutate,
            () => f.store.getDocumentNotificationDelivery({ batchId: batch.id, recipientUserId: reader }))
          : await during(f.store, '_decryptRevision', byDocument(later), mutate,
            () => f.store.getDocumentNotificationDelivery({ batchId: batch.id, recipientUserId: reader }));
        if (raced.error) return;
        if (kind === 'revoke-during-note') {
          assert.strictEqual(raced.value.skipped, true);
          assert.strictEqual(JSON.stringify(raced.value).includes('PrivateNotificationNoteCanary'), false);
        } else if (!raced.value.skipped) {
          if (kind === 'head-earlier') {
            const returned = raced.value.documents.find(value => value.id === earlier.id);
            if (returned) assert.strictEqual(returned.title, fresh.title);
          } else concealed(raced.value, earlier);
        }
      });
    }
    for (const kind of ['membership', 'name', 'project-deletion', 'billing']) {
      await scenario('GET /api/cloud/v1/account revalidates an earlier company after later project awaits: ' + kind, async f => {
        const routes = routeHarness(f);
        const raced = await during(f.store, 'listProjects', args => args[1] === f.second.workspaceId, async () => {
          if (kind === 'membership') f.other.removeWorkspaceMember({ actorUserId: owner, workspaceId: f.first.workspaceId, userId: reader });
          if (kind === 'name') {
            const encrypted = await f.other.keyProvider.encryptWorkspaceName(f.first.workspaceId, 'Changed composite name');
            f.other.db.prepare('UPDATE cloud_workspaces SET name_ciphertext=?,name_nonce=? WHERE id=?').run(encrypted.ciphertext, encrypted.nonce, f.first.workspaceId);
          }
          if (kind === 'project-deletion') f.other.db.prepare('UPDATE cloud_projects SET deleted_at_ms=? WHERE id=?').run(f.tick(), f.first.projectId);
          if (kind === 'billing') routes.denied.add(f.first.workspaceId);
        }, () => routes.api(reader, '/api/cloud/v1/account?account_id=' + (kind === 'billing' || kind === 'project-deletion' ? f.first.workspaceId : f.second.workspaceId)));
        assert.strictEqual(raced.error, undefined);
        assert.strictEqual(raced.value.status, 200, JSON.stringify(raced.value.data));
        if (kind === 'membership' || kind === 'name') {
          assert.deepStrictEqual(raced.value.data.accounts.map(value => value.id), [f.second.workspaceId]);
          assert.strictEqual(JSON.stringify(raced.value.data).includes('First private library'), false);
        } else {
          assert.strictEqual(raced.value.data.account.can_write, false);
          assert.strictEqual(raced.value.data.account.can_create_document, false);
          if (kind === 'billing') assert.strictEqual(raced.value.data.account.can_read, false);
        }
      });
    }
    await scenario('GET /api/cloud/v1/account never includes a revoked library in account-selection guidance', async f => {
      const routes = routeHarness(f);
      const raced = await during(f.store, 'listProjects', args => args[1] === f.second.workspaceId,
        () => f.other.removeWorkspaceMember({ actorUserId: owner, workspaceId: f.first.workspaceId, userId: reader }),
        () => routes.api(reader, '/api/cloud/v1/account'));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 200, JSON.stringify(raced.value.data));
      assert.strictEqual(raced.value.data.account.id, f.second.workspaceId);
      assert.deepStrictEqual(raced.value.data.accounts.map(value => value.id), [f.second.workspaceId]);
      assert.strictEqual(JSON.stringify(raced.value.data).includes('First private library'), false);
    });
    await scenario('unchanged authorized current, historical, live-list, deleted-list and export API reads retain valid content', async f => {
      const document = await f.document('ValidHistoricalCanary');
      const fresh = await f.changedHead(document);
      const deleted = await f.document('ValidDeletedCanary');
      f.store.deleteDocument({ userId: owner, documentId: deleted.id, expectedHeadRevisionId: deleted.current_revision_id });
      const routes = routeHarness(f);
      const current = await routes.api(reader, '/api/cloud/v1/documents/' + document.id);
      assert.strictEqual(current.status, 200, JSON.stringify(current.data));
      assert.strictEqual(current.data.document.current_revision_id, fresh.current_revision_id);
      assert.strictEqual(current.data.document.title, fresh.title);
      const historical = await routes.api(reader, '/api/cloud/v1/documents/' + document.id + '/revisions/' + document.current_revision_id);
      assert.strictEqual(historical.status, 200, JSON.stringify(historical.data));
      assert.strictEqual(historical.data.document.title, document.title);
      const listed = await routes.api(reader, '/api/cloud/v1/documents?workspace_id=' + f.first.workspaceId);
      assert.strictEqual(listed.status, 200, JSON.stringify(listed.data));
      assert.deepStrictEqual(listed.data.documents.map(value => value.id), [document.id]);
      const recoverable = await routes.api(reader, '/api/cloud/v1/documents/deleted?workspace_id=' + f.first.workspaceId);
      assert.strictEqual(recoverable.status, 200, JSON.stringify(recoverable.data));
      assert.deepStrictEqual(recoverable.data.documents.map(value => value.id), [deleted.id]);
      const exported = await routes.api(owner, '/api/cloud/v1/workspaces/' + f.first.workspaceId + '/export', 'POST');
      assert.strictEqual(exported.status, 200, JSON.stringify(exported.data));
      assert.deepStrictEqual(exported.data.export.documents.map(value => value.id), [document.id]);
      assert.strictEqual(exported.data.export.documents[0].current_revision_id, fresh.current_revision_id);
      assert.ok(exported.data.export.documents[0].revisions.some(value => value.current_revision_id === document.current_revision_id));
    });
    for (const historical of [false, true]) {
      await scenario('GET /api/cloud/v1/documents/:id' + (historical ? '/revisions/:revision' : '') + ' rechecks read entitlement after decryption', async f => {
        const document = await f.document('RouteEntitlementCanary');
        if (historical) await f.changedHead(document);
        const routes = routeHarness(f);
        const raced = await during(f.store, '_decryptProjectName', () => true,
          () => routes.denied.add(f.first.workspaceId),
          () => routes.api(reader, '/api/cloud/v1/documents/' + document.id + (historical ? '/revisions/' + document.current_revision_id : '')));
        assert.strictEqual(raced.error, undefined);
        assert.strictEqual(raced.value.status, 402, JSON.stringify(raced.value.data));
        assert.strictEqual(raced.value.data.document, undefined);
        assert.strictEqual(JSON.stringify(raced.value.data).includes(document.title), false);
      });
    }
    await scenario('GET /api/cloud/v1/documents binds list metadata to its source library after the helper returns', async f => {
      const document = await f.document('RouteMovedListCanary');
      const routes = routeHarness(f);
      const raced = await during(f.store, 'listDocuments', () => true,
        () => f.other.moveDocument({ userId: owner, documentId: document.id, projectId: f.second.projectId,
          expectedHeadRevisionId: document.current_revision_id }),
        () => routes.api(owner, '/api/cloud/v1/documents?workspace_id=' + f.first.workspaceId));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 200);
      assert.deepStrictEqual(raced.value.data.documents, []);
      assert.strictEqual(raced.value.data.next_cursor, null);
      concealed(raced.value.data, document);
    });
    await scenario('GET /api/cloud/v1/documents/:id rejects a stale current payload when its source moves after the helper returns', async f => {
      const document = await f.document('RouteMovedReadCanary');
      const routes = routeHarness(f);
      const raced = await during(f.store, 'getDocument', () => true,
        () => f.other.moveDocument({ userId: owner, documentId: document.id, projectId: f.second.projectId,
          expectedHeadRevisionId: document.current_revision_id }),
        () => routes.api(owner, '/api/cloud/v1/documents/' + document.id));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 404, JSON.stringify(raced.value.data));
      assert.strictEqual(raced.value.data.document, undefined);
      assert.ok(!routes.calls.some(call => call.workspaceId === f.second.workspaceId), 'used moved destination to authorize stale source payload');
    });
    await scenario('GET /api/cloud/v1/documents/deleted rechecks source read entitlement after its helper returns', async f => {
      const document = await f.document('RouteDeletedCanary');
      f.store.deleteDocument({ userId: owner, documentId: document.id, expectedHeadRevisionId: document.current_revision_id });
      const routes = routeHarness(f);
      const raced = await during(f.store, 'listDeletedDocuments', () => true,
        () => routes.denied.add(f.first.workspaceId),
        () => routes.api(reader, '/api/cloud/v1/documents/deleted?workspace_id=' + f.first.workspaceId));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 200, JSON.stringify(raced.value.data));
      assert.deepStrictEqual(raced.value.data.documents, []);
      concealed(raced.value.data, document);
    });
    await scenario('POST /api/cloud/v1/workspaces/:id/export rechecks entitlement before serializing the export', async f => {
      const document = await f.document('RouteExportCanary');
      const routes = routeHarness(f);
      const raced = await during(f.store, 'exportWorkspace', () => true,
        () => routes.denied.add(f.first.workspaceId),
        () => routes.api(owner, '/api/cloud/v1/workspaces/' + f.first.workspaceId + '/export', 'POST'));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 402, JSON.stringify(raced.value.data));
      assert.strictEqual(raced.value.data.export, undefined);
      assert.strictEqual(JSON.stringify(raced.value.data).includes(document.title), false);
    });
    await scenario('POST /api/cloud/v1/workspaces/:id/export rechecks the existing owner-only role after its helper returns', async f => {
      const document = await f.document('RouteExportOwnerCanary');
      const routes = routeHarness(f);
      const raced = await during(f.store, 'exportWorkspace', () => true, () => {
        f.other.transferWorkspaceOwnership({ actorUserId: owner, workspaceId: f.first.workspaceId, targetUserId: reader });
        f.other.addWorkspaceMember({ actorUserId: reader, workspaceId: f.first.workspaceId, userId: owner, role: 'member' });
      }, () => routes.api(owner, '/api/cloud/v1/workspaces/' + f.first.workspaceId + '/export', 'POST'));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 403, JSON.stringify(raced.value.data));
      assert.strictEqual(raced.value.data.export, undefined);
      assert.strictEqual(JSON.stringify(raced.value.data).includes(document.title), false);
    });
    await scenario('POST /api/cloud/v1/workspaces/:id/export removes documents revoked after its helper returns', async f => {
      const document = await f.document('RouteExportRevokedCanary', { userId: writer, members: [owner] });
      const routes = routeHarness(f);
      const raced = await during(f.store, 'exportWorkspace', () => true,
        () => f.other.setDocumentPermission({ userId: writer, documentId: document.id, mode: 'custom', memberUserIds: [] }),
        () => routes.api(owner, '/api/cloud/v1/workspaces/' + f.first.workspaceId + '/export', 'POST'));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 200, JSON.stringify(raced.value.data));
      assert.deepStrictEqual(raced.value.data.export.documents, []);
      concealed(raced.value.data, document);
    });
    await scenario('POST /api/cloud/v1/workspaces/:id/export removes historical revisions pruned after its helper returns', async f => {
      const document = await f.document('RouteExportPrunedCanary');
      const fresh = await f.changedHead(document);
      const routes = routeHarness(f);
      const raced = await during(f.store, 'exportWorkspace', () => true,
        () => f.other.pruneRevisions({ documentId: document.id, keepPrevious: 0, retainAfterMs: f.tick() }),
        () => routes.api(owner, '/api/cloud/v1/workspaces/' + f.first.workspaceId + '/export', 'POST'));
      assert.strictEqual(raced.error, undefined);
      assert.strictEqual(raced.value.status, 200, JSON.stringify(raced.value.data));
      assert.deepStrictEqual(raced.value.data.export.documents.map(value => value.current_revision_id), [fresh.current_revision_id]);
      assert.deepStrictEqual(raced.value.data.export.documents[0].revisions.map(value => value.current_revision_id), [fresh.current_revision_id]);
      assert.strictEqual(JSON.stringify(raced.value.data).includes(document.title), false);
    });
  };
};

if (require.main === module) {
  const harness = require('./runner');
  module.exports(harness)().then(() => harness.report()).catch(error => { console.error(error); process.exitCode = 1; });
}
