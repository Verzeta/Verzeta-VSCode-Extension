// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { RemoteRepository } from '../../../src/extension/wire/RemoteRepository.js';
import { RemoteOpError, type RemoteSession } from '../../../src/extension/wire/RemoteSession.js';

interface SentOp {
    readonly op: string;
    readonly params: Readonly<Record<string, unknown>>;
}

function scriptedSession(replies: Readonly<Record<string, unknown>>): {
    session: RemoteSession;
    sent: SentOp[];
} {
    const sent: SentOp[] = [];
    const session = {
        send: (op: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
            sent.push({ op, params });
            const reply = replies[op];
            if (reply instanceof Error) return Promise.reject(reply);
            return Promise.resolve(reply);
        },
    } as unknown as RemoteSession;
    return { session, sent };
}

test('upsertHeartbeatConfig accepts the bare-string id reply', async () => {
    const { session } = scriptedSession({ 'heartbeat.upsert': 'hb-1' });
    const repo = new RemoteRepository(session);
    const id = await repo.upsertHeartbeatConfig({
        agentId: 'a',
        scopeType: 'folder',
        scopeId: 'f',
        alias: 'x',
        enabled: true,
        schedule: '',
        goal: '',
    });
    assert.equal(id, 'hb-1');
});

test('upsertHeartbeatConfig still accepts an {id} object reply', async () => {
    const { session } = scriptedSession({ 'heartbeat.upsert': { id: 'hb-2' } });
    const repo = new RemoteRepository(session);
    const id = await repo.upsertHeartbeatConfig({
        agentId: 'a',
        scopeType: 'folder',
        scopeId: 'f',
        alias: 'x',
        enabled: true,
        schedule: '',
        goal: '',
    });
    assert.equal(id, 'hb-2');
});

test('upsertHeartbeatConfig sends surface criteria and self-config through', async () => {
    const { session, sent } = scriptedSession({ 'heartbeat.upsert': 'hb-1' });
    const repo = new RemoteRepository(session);
    await repo.upsertHeartbeatConfig({
        id: 'hb-1',
        agentId: 'a',
        scopeType: 'folder',
        scopeId: 'f',
        alias: 'x',
        enabled: true,
        schedule: '0 9 * * *',
        goal: 'g',
        surfaceCriteria: 'only failures',
        selfConfigAllowed: true,
    });
    assert.equal(sent[0]?.params['surface_criteria'], 'only failures');
    assert.equal(sent[0]?.params['self_config_allowed'], true);
    assert.equal(sent[0]?.params['id'], 'hb-1');
});

test('listFolderDocuments parses the bare array reply', async () => {
    const { session } = scriptedSession({
        'folder.documents': [
            { name: 'spec.md', path: '/x/spec.md', size: 120 },
            { name: 'notes.txt', path: '/x/notes.txt', size: 0 },
        ],
    });
    const docs = await new RemoteRepository(session).listFolderDocuments('f');
    assert.deepEqual(docs, [
        { name: 'spec.md', size: 120 },
        { name: 'notes.txt', size: 0 },
    ]);
});

test('listFolderDocuments still reads a {documents} object', async () => {
    const { session } = scriptedSession({ 'folder.documents': { documents: [{ name: 'a' }] } });
    const docs = await new RemoteRepository(session).listFolderDocuments('f');
    assert.deepEqual(docs, [{ name: 'a', size: 0 }]);
});

test('listPreferredSkills parses the bare array reply', async () => {
    const { session } = scriptedSession({ 'skill.preferred.list': ['s1', 's2'] });
    assert.deepEqual(await new RemoteRepository(session).listPreferredSkills('f'), ['s1', 's2']);
});

test('chat preferred skills use conversation_group for a group chat', async () => {
    const { session, sent } = scriptedSession({ 'skill.preferred.list': ['s1'] });
    const repo = new RemoteRepository(session);
    await repo.setConvPreferredSkills('c1', ['s1'], true);
    const ids = await repo.listConvPreferredSkills('c1', true);
    assert.deepEqual(ids, ['s1']);
    assert.equal(sent[0]?.params['scope_type'], 'conversation_group');
    assert.equal(sent[1]?.params['scope_type'], 'conversation_group');
});

test('chat preferred skills use conversation_1to1 for a 1:1 chat', async () => {
    const { session, sent } = scriptedSession({});
    await new RemoteRepository(session).setConvPreferredSkills('c1', [], false);
    assert.equal(sent[0]?.params['scope_type'], 'conversation_1to1');
});

test('chat preferred skills ask the host for the type when it is not known', async () => {
    const { session, sent } = scriptedSession({
        'conv.is_group': { is_group: true },
        'skill.preferred.list': [],
    });
    await new RemoteRepository(session).listConvPreferredSkills('c1');
    assert.equal(sent[0]?.op, 'conv.is_group');
    assert.equal(sent[1]?.params['scope_type'], 'conversation_group');
});

test('getConversationSettings takes ragEnabled from conv.get llm_config', async () => {
    const { session } = scriptedSession({
        'conv.settings.get': { ragEnabled: false, temperature: 0.5 },
        'conv.get': { id: 'c1', llm_config: { rag_enabled: true } },
    });
    const settings = await new RemoteRepository(session).getConversationSettings('c1');
    assert.equal(settings.ragEnabled, true);
    assert.equal(settings.temperature, 0.5);
});

test('getConversationSettings reports RAG off when the conversation has no config', async () => {
    const { session } = scriptedSession({
        'conv.settings.get': { ragEnabled: true },
        'conv.get': { id: 'c1', llm_config: null },
    });
    const settings = await new RemoteRepository(session).getConversationSettings('c1');
    assert.equal(settings.ragEnabled, false);
});

test('getConversationSettings keeps its own value when conv.get fails', async () => {
    const { session } = scriptedSession({
        'conv.settings.get': { ragEnabled: true },
        'conv.get': new Error('not_found'),
    });
    const settings = await new RemoteRepository(session).getConversationSettings('c1');
    assert.equal(settings.ragEnabled, true);
});

test('castPollVote throws when the host answers false', async () => {
    const { session } = scriptedSession({ 'poll.vote': false });
    await assert.rejects(
        new RemoteRepository(session).castPollVote('p', 'o', undefined),
        (e: unknown) => e instanceof RemoteOpError && e.kind === 'rejected',
    );
});

test('closePoll and step actions resolve when the host answers true', async () => {
    const { session } = scriptedSession({
        'poll.close': true,
        'step.retry': true,
        'step.skip': true,
        'step.override_done': true,
        'plan.stop': true,
    });
    const repo = new RemoteRepository(session);
    await repo.closePoll('p');
    await repo.retryStep('s');
    await repo.skipStep('s');
    await repo.overrideStepDone('s');
    await repo.stopPlan('p');
});

test('step retry throws when the host answers false', async () => {
    const { session } = scriptedSession({ 'step.retry': false });
    await assert.rejects(new RemoteRepository(session).retryStep('s'), RemoteOpError);
});

test('registerWorkspaceMount throws on an {ok:false} reply', async () => {
    const { session } = scriptedSession({
        'workspace.mount.register': { ok: false, error: "'owner_label' empty or too long" },
    });
    await assert.rejects(
        new RemoteRepository(session).registerWorkspaceMount({
            folderId: 'f',
            mountId: 'm',
            ownerLabel: 'x'.repeat(500),
            treeJson: '{}',
        }),
        (e: unknown) =>
            e instanceof RemoteOpError &&
            e.kind === 'mount_rejected' &&
            e.detail.includes('owner_label'),
    );
});

test('registerWorkspaceMount resolves on {ok:true}', async () => {
    const { session } = scriptedSession({ 'workspace.mount.register': { ok: true } });
    await new RemoteRepository(session).registerWorkspaceMount({
        folderId: 'f',
        mountId: 'm',
        ownerLabel: 'x',
        treeJson: '{}',
    });
});

test('unregisterWorkspaceMount treats "no mount registered" as already released', async () => {
    const { session } = scriptedSession({
        'workspace.mount.unregister': { ok: false, error: 'no mount registered for folder/client' },
    });
    await new RemoteRepository(session).unregisterWorkspaceMount('f');
});

test('unregisterWorkspaceMount throws on any other refusal', async () => {
    const { session } = scriptedSession({
        'workspace.mount.unregister': { ok: false, error: 'sql error' },
    });
    await assert.rejects(new RemoteRepository(session).unregisterWorkspaceMount('f'), /sql error/);
});

test('updateWorkspaceMountTree throws on an {ok:false} reply', async () => {
    const { session } = scriptedSession({
        'workspace.mount.update_tree': {
            ok: false,
            error: 'no mount registered for folder/client',
        },
    });
    await assert.rejects(
        new RemoteRepository(session).updateWorkspaceMountTree('f', '{}'),
        RemoteOpError,
    );
});

test('updateWorkspaceMountTier sends workspace.mount.update_tier', async () => {
    const { session, sent } = scriptedSession({ 'workspace.mount.update_tier': { ok: true } });
    await new RemoteRepository(session).updateWorkspaceMountTier('f', 'smart');
    assert.equal(sent[0]?.op, 'workspace.mount.update_tier');
    assert.equal(sent[0]?.params['folder_id'], 'f');
    assert.equal(sent[0]?.params['permission_tier'], 'smart');
});

test('listRecentHeartbeatRuns keeps only the asked-for heartbeat', async () => {
    const { session, sent } = scriptedSession({
        'heartbeat.recent_runs': [
            { id: 'r1', configId: 'h1', startedAtMs: 10, durationMs: 1, outcome: 'ok' },
            { id: 'r2', configId: 'h2', startedAtMs: 20, durationMs: 1, outcome: 'ok' },
            { id: 'r3', configId: 'h1', startedAtMs: 30, durationMs: 1, outcome: 'ok' },
        ],
    });
    const runs = await new RemoteRepository(session).listRecentHeartbeatRuns('h1');
    assert.deepEqual(
        runs.map((r) => r.id),
        ['r1', 'r3'],
    );
    assert.equal(sent[0]?.params['limit'], 200);
});

test('createFolder reports the type the host created', async () => {
    const { session } = scriptedSession({ 'folder.create': { id: 'f1', type: 'regular' } });
    const created = await new RemoteRepository(session).createFolder('Room');
    assert.deepEqual(created, { id: 'f1', type: 'regular' });
});
