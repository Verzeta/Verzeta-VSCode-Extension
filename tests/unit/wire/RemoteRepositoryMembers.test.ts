// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    RemoteRepository,
    folderMemberWireRow,
    type FolderMemberRow,
} from '../../../src/extension/wire/RemoteRepository.js';
import type { RemoteSession } from '../../../src/extension/wire/RemoteSession.js';
import { parseAddedByKind, parseMember } from '../../../src/extension/wire/RemoteJson.js';

interface SentOp {
    readonly op: string;
    readonly params: Readonly<Record<string, unknown>>;
}

function recordingSession(reply: unknown = {}): { session: RemoteSession; sent: SentOp[] } {
    const sent: SentOp[] = [];
    const session = {
        send: (op: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
            sent.push({ op, params });
            return Promise.resolve(reply);
        },
    } as unknown as RemoteSession;
    return { session, sent };
}

const AGENT = '11111111-1111-1111-1111-111111111111';
const OTHER_AGENT = '22222222-2222-2222-2222-222222222222';
const FOLDER = '33333333-3333-3333-3333-333333333333';

test('folderMemberWireRow sends overrides and provenance in snake_case', () => {
    const row = folderMemberWireRow({
        agentId: AGENT,
        alias: 'Writer',
        isCoordinator: true,
        modelProvider: 'ollama',
        modelName: 'qwen3',
        allowedTools: ['read_file', 'web_search'],
        addedByKind: 'agent',
        addedByAgentId: OTHER_AGENT,
    });
    assert.deepEqual(row, {
        agent_id: AGENT,
        alias: 'Writer',
        is_coordinator: true,
        model_provider: 'ollama',
        model_name: 'qwen3',
        allowed_tools: ['read_file', 'web_search'],
        added_by_kind: 'agent',
        added_by_agent_id: OTHER_AGENT,
    });
});

test('folderMemberWireRow omits every optional field the row does not have', () => {
    const row = folderMemberWireRow({ agentId: AGENT, alias: 'Coord', isCoordinator: false });
    assert.deepEqual(row, { agent_id: AGENT, alias: 'Coord', is_coordinator: false });
});

test('folderMemberWireRow keeps empty overrides, which is how a cleared override is written', () => {
    const row = folderMemberWireRow({
        agentId: AGENT,
        alias: 'Coord',
        isCoordinator: false,
        modelProvider: '',
        modelName: '',
        allowedTools: [],
    });
    assert.equal(row['model_provider'], '');
    assert.equal(row['model_name'], '');
    assert.deepEqual(row['allowed_tools'], []);
});

test('folderMemberWireRow never sends an unknown provenance kind or an empty agent id', () => {
    const row = folderMemberWireRow({
        agentId: AGENT,
        alias: 'Coord',
        isCoordinator: false,
        addedByKind: 'robot' as unknown as FolderMemberRow['addedByKind'],
        addedByAgentId: '',
    });
    assert.ok(!('added_by_kind' in row));
    assert.ok(!('added_by_agent_id' in row));
});

test('setFolderMembers sends one folder.members.set carrying each member as it has it', async () => {
    const { session, sent } = recordingSession(true);
    const repo = new RemoteRepository(session);

    await repo.setFolderMembers(FOLDER, [
        {
            agentId: AGENT,
            alias: 'Writer',
            isCoordinator: false,
            modelProvider: 'ollama',
            modelName: 'qwen3',
            allowedTools: ['read_file'],
            addedByKind: 'user',
        },
        { agentId: OTHER_AGENT, alias: 'Critic', isCoordinator: true },
    ]);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.op, 'folder.members.set');
    assert.equal(sent[0]?.params['folder_id'], FOLDER);
    assert.deepEqual(sent[0]?.params['members'], [
        {
            agent_id: AGENT,
            alias: 'Writer',
            is_coordinator: false,
            model_provider: 'ollama',
            model_name: 'qwen3',
            allowed_tools: ['read_file'],
            added_by_kind: 'user',
        },
        { agent_id: OTHER_AGENT, alias: 'Critic', is_coordinator: true },
    ]);
});

test('setFolderMemberOverride calls folder.member.override.set with the snake_case shape', async () => {
    const { session, sent } = recordingSession(true);
    const repo = new RemoteRepository(session);

    const ok = await repo.setFolderMemberOverride(FOLDER, 'Writer', {
        modelProvider: 'openai',
        modelName: 'gpt-x',
        allowedTools: ['web_search'],
    });

    assert.equal(ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.op, 'folder.member.override.set');
    assert.deepEqual(sent[0]?.params, {
        folder_id: FOLDER,
        alias: 'Writer',
        model_provider: 'openai',
        model_name: 'gpt-x',
        allowed_tools: ['web_search'],
    });
});

test('setFolderMemberOverride sends empty values to clear the override', async () => {
    const { session, sent } = recordingSession(true);
    const repo = new RemoteRepository(session);

    await repo.setFolderMemberOverride(FOLDER, 'Writer', {
        modelProvider: '',
        modelName: '',
        allowedTools: [],
    });

    assert.equal(sent[0]?.params['model_provider'], '');
    assert.equal(sent[0]?.params['model_name'], '');
    assert.deepEqual(sent[0]?.params['allowed_tools'], []);
});

test('setFolderMemberOverride reports false when the host matches no member', async () => {
    const repo = new RemoteRepository(recordingSession(false).session);
    const ok = await repo.setFolderMemberOverride(FOLDER, 'Nobody', {
        modelProvider: '',
        modelName: '',
        allowedTools: [],
    });
    assert.equal(ok, false);
});

test('setFolderMemberOverride treats a reply that is not true as a failure', async () => {
    const repo = new RemoteRepository(recordingSession({}).session);
    const ok = await repo.setFolderMemberOverride(FOLDER, 'Writer', {
        modelProvider: 'ollama',
        modelName: 'qwen3',
        allowedTools: [],
    });
    assert.equal(ok, false);
});

test('parseMember reads provenance from the host projection keys', () => {
    const m = parseMember({
        agentId: AGENT,
        alias: 'Writer',
        isCoordinator: false,
        addedByKind: 'agent',
        addedByAgentId: OTHER_AGENT,
        modelProvider: 'ollama',
        modelName: 'qwen3',
        allowedTools: ['read_file'],
    });
    assert.ok(m !== undefined);
    assert.equal(m.addedByKind, 'agent');
    assert.equal(m.addedByAgentId, OTHER_AGENT);
    assert.deepEqual(m.allowedTools, ['read_file']);
});

test('parseMember reads snake_case provenance and drops unknown kinds', () => {
    const snake = parseMember({
        agent_id: AGENT,
        alias: 'Writer',
        added_by_kind: 'user',
        added_by_agent_id: '',
    });
    assert.equal(snake?.addedByKind, 'user');
    assert.equal(snake?.addedByAgentId, undefined);

    const unknown = parseMember({ agentId: AGENT, alias: 'Writer', addedByKind: 'system' });
    assert.equal(unknown?.addedByKind, undefined);
});

test('parseAddedByKind accepts only user and agent', () => {
    assert.equal(parseAddedByKind('user'), 'user');
    assert.equal(parseAddedByKind('agent'), 'agent');
    assert.equal(parseAddedByKind(''), undefined);
    assert.equal(parseAddedByKind('USER'), undefined);
    assert.equal(parseAddedByKind(undefined), undefined);
});
