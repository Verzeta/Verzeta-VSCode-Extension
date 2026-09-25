// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    MAX_MEMBER_ALLOWED_TOOLS,
    validateInbound,
} from '../../../src/extension/webview/MessageBus.js';

function override(fields: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'folder.member.override.setRequested',
        hostId: 'host-1',
        folderId: 'folder-1',
        alias: 'Writer',
        modelProvider: 'ollama',
        modelName: 'qwen3',
        allowedTools: ['read_file'],
        ...fields,
    };
}

test('a well-formed member override message passes through unchanged', () => {
    assert.deepEqual(validateInbound(override()), override());
});

test('empty provider, model and tools are accepted, since they clear the override', () => {
    const msg = override({ modelProvider: '', modelName: '', allowedTools: [] });
    assert.deepEqual(validateInbound(msg), msg);
});

test('a member override message with a missing or empty id or alias is dropped', () => {
    assert.equal(validateInbound(override({ hostId: '' })), undefined);
    assert.equal(validateInbound(override({ folderId: undefined })), undefined);
    assert.equal(validateInbound(override({ alias: '   ' })), undefined);
    assert.equal(validateInbound(override({ alias: 7 })), undefined);
});

test('a member override message with wrongly typed fields is dropped', () => {
    assert.equal(validateInbound(override({ modelProvider: null })), undefined);
    assert.equal(validateInbound(override({ modelName: 3 })), undefined);
    assert.equal(validateInbound(override({ allowedTools: 'read_file' })), undefined);
    assert.equal(validateInbound(override({ allowedTools: ['read_file', 1] })), undefined);
    assert.equal(validateInbound(override({ allowedTools: [''] })), undefined);
});

test('a member override message over the tool limit is dropped', () => {
    const tools = Array.from({ length: MAX_MEMBER_ALLOWED_TOOLS + 1 }, (_, i) => `tool_${i}`);
    assert.equal(validateInbound(override({ allowedTools: tools })), undefined);
    const atLimit = tools.slice(0, MAX_MEMBER_ALLOWED_TOOLS);
    assert.ok(validateInbound(override({ allowedTools: atLimit })) !== undefined);
});

function rosterSave(member: Record<string, unknown>): Record<string, unknown> {
    return {
        type: 'folder.members.setRequested',
        hostId: 'host-1',
        folderId: 'folder-1',
        members: [
            {
                agentId: 'agent-1',
                alias: 'Writer',
                isCoordinator: false,
                modelProvider: 'ollama',
                modelName: 'qwen3',
                allowedTools: ['read_file'],
                ...member,
            },
        ],
    };
}

test('roster rows keep provenance when it is present', () => {
    const out = validateInbound(rosterSave({ addedByKind: 'agent', addedByAgentId: 'agent-9' }));
    assert.ok(out !== undefined && out.type === 'folder.members.setRequested');
    assert.equal(out.members[0]?.addedByKind, 'agent');
    assert.equal(out.members[0]?.addedByAgentId, 'agent-9');
    assert.deepEqual(out.members[0]?.allowedTools, ['read_file']);
});

test('roster rows without provenance carry no provenance keys', () => {
    const out = validateInbound(rosterSave({}));
    assert.ok(out !== undefined && out.type === 'folder.members.setRequested');
    const row = out.members[0];
    assert.ok(row !== undefined);
    assert.ok(!('addedByKind' in row));
    assert.ok(!('addedByAgentId' in row));
});

test('a roster row with an unknown provenance kind drops the whole envelope', () => {
    assert.equal(validateInbound(rosterSave({ addedByKind: 'system' })), undefined);
    assert.equal(validateInbound(rosterSave({ addedByAgentId: 5 })), undefined);
});

test('folder.updateRequested carries provenance through validation too', () => {
    const out = validateInbound({
        type: 'folder.updateRequested',
        hostId: 'host-1',
        folderId: 'folder-1',
        originalName: 'Old',
        name: 'New',
        folderType: 'project',
        goal: '',
        description: '',
        members: [
            {
                agentId: 'agent-1',
                alias: 'Writer',
                isCoordinator: true,
                modelProvider: '',
                modelName: '',
                allowedTools: [],
                addedByKind: 'user',
            },
        ],
    });
    assert.ok(out !== undefined && out.type === 'folder.updateRequested');
    assert.equal(out.members[0]?.addedByKind, 'user');
});
