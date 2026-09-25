// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
    parseConversation,
    parseConvSettings,
    parseFolder,
    parseFrame,
    parseMember,
    parseMessage,
    parsePairResponse,
    parseTokenAuthResponse,
} from '../../../src/extension/wire/RemoteJson.js';

test('parseFrame returns a response envelope for type=response', () => {
    const text = JSON.stringify({
        type: 'response',
        request_id: 'r1',
        ok: true,
        data: { foo: 'bar' },
    });
    const frame = parseFrame(text);
    assert.equal(frame?.type, 'response');
    if (frame?.type !== 'response') return;
    assert.equal(frame.request_id, 'r1');
    assert.equal(frame.ok, true);
});

test('parseFrame returns an event envelope for type=event', () => {
    const text = JSON.stringify({ type: 'event', event: 'conv.added', data: { id: 'c1' } });
    const frame = parseFrame(text);
    assert.equal(frame?.type, 'event');
    if (frame?.type !== 'event') return;
    assert.equal(frame.event, 'conv.added');
});

test('parseFrame throws on malformed JSON', () => {
    assert.throws(() => parseFrame('not json'));
});

test('parseFrame returns undefined for unknown frame type', () => {
    const text = JSON.stringify({ type: 'gibberish' });
    assert.equal(parseFrame(text), undefined);
});

test('parseFrame returns a request envelope for type=request', () => {
    const text = JSON.stringify({
        type: 'request',
        request_id: 'r1',
        op: 'vfs.read',
        args: { rel_path: 'src/foo.ts' },
    });
    const frame = parseFrame(text);
    assert.equal(frame?.type, 'request');
    if (frame?.type !== 'request') return;
    assert.equal(frame.request_id, 'r1');
    assert.equal(frame.op, 'vfs.read');
    assert.deepEqual(frame.args, { rel_path: 'src/foo.ts' });
});

test('parseFrame returns a request envelope with undefined args when omitted', () => {
    const text = JSON.stringify({
        type: 'request',
        request_id: 'r2',
        op: 'vfs.stat',
    });
    const frame = parseFrame(text);
    assert.equal(frame?.type, 'request');
    if (frame?.type !== 'request') return;
    assert.equal(frame.args, undefined);
});

test('parseFrame returns undefined when a request envelope is missing request_id', () => {
    const text = JSON.stringify({ type: 'request', op: 'vfs.read' });
    assert.equal(parseFrame(text), undefined);
});

test('parseFrame returns undefined when a request envelope is missing op', () => {
    const text = JSON.stringify({ type: 'request', request_id: 'r3' });
    assert.equal(parseFrame(text), undefined);
});

test('parseFrame treats non-object args as undefined', () => {
    const text = JSON.stringify({
        type: 'request',
        request_id: 'r4',
        op: 'vfs.read',
        args: 'not-an-object',
    });
    const frame = parseFrame(text);
    assert.equal(frame?.type, 'request');
    if (frame?.type !== 'request') return;
    assert.equal(frame.args, undefined);
});

test('parseFrame returns a response with ok=false carrying error payload', () => {
    const text = JSON.stringify({
        type: 'response',
        request_id: 'r1',
        ok: false,
        error: { kind: 'unauthorized', detail: 'invalid token' },
    });
    const frame = parseFrame(text);
    assert.equal(frame?.type, 'response');
    if (frame?.type !== 'response') return;
    assert.equal(frame.ok, false);
    assert.equal(frame.error?.kind, 'unauthorized');
    assert.equal(frame.error?.detail, 'invalid token');
});

test('parseConversation requires an id', () => {
    assert.equal(parseConversation({ title: 'no id' }), undefined);
});

test('parseConversation maps the snake_case fields', () => {
    const conv = parseConversation({
        id: 'c1',
        title: 'Hello',
        folder_id: 'f1',
        created_at: 1700000000,
        updated_at: 1700000100,
        is_group: true,
        is_pinned: false,
        primary_agent_id: 'agent-1',
    });
    assert.equal(conv?.id, 'c1');
    assert.equal(conv?.title, 'Hello');
    assert.equal(conv?.folderId, 'f1');
    assert.equal(conv?.createdAt, 1700000000);
    assert.equal(conv?.updatedAt, 1700000100);
    assert.equal(conv?.isGroup, true);
    assert.equal(conv?.isPinned, false);
    assert.equal(conv?.primaryAgentId, 'agent-1');
});

test('parseFolder defaults folderType to regular when missing', () => {
    const folder = parseFolder({ id: 'f1', name: 'foo' });
    assert.equal(folder?.folderType, 'regular');
});

test('parseFolder respects project / organization types', () => {
    const proj = parseFolder({ id: 'f1', name: 'proj', folder_type: 'project' });
    assert.equal(proj?.folderType, 'project');
    const org = parseFolder({ id: 'f2', name: 'org', folder_type: 'organization' });
    assert.equal(org?.folderType, 'organization');
});

test('parseMember requires agent_id and alias', () => {
    assert.equal(parseMember({ agent_id: 'a' }), undefined);
    assert.equal(parseMember({ alias: 'b' }), undefined);
    const m = parseMember({ agent_id: 'a', alias: 'b', is_coordinator: true });
    assert.equal(m?.agentId, 'a');
    assert.equal(m?.alias, 'b');
    assert.equal(m?.isCoordinator, true);
});

test('parseMessage maps thinking_content + role enum', () => {
    const msg = parseMessage({
        id: 'm1',
        conversation_id: 'c1',
        role: 'assistant',
        content: 'hello',
        thinking_content: 'reasoning...',
        created_at: 100,
    });
    assert.equal(msg?.id, 'm1');
    assert.equal(msg?.role, 'assistant');
    assert.equal(msg?.content, 'hello');
    assert.equal(msg?.thinkingContent, 'reasoning...');
});

test('parseMessage falls back to assistant for unknown roles', () => {
    const msg = parseMessage({ id: 'm1', conversation_id: 'c1', role: 'pirate' });
    assert.equal(msg?.role, 'assistant');
});

test('parsePairResponse returns token + client_id', () => {
    const r = parsePairResponse({ token: 'tok', client_id: 'c1', name: 'VS Code' });
    assert.equal(r?.token, 'tok');
    assert.equal(r?.client_id, 'c1');
    assert.equal(r?.name, 'VS Code');
});

test('parsePairResponse returns undefined when token is missing', () => {
    assert.equal(parsePairResponse({ client_id: 'c1' }), undefined);
});

test('parseTokenAuthResponse tolerates missing last_seen_at', () => {
    const r = parseTokenAuthResponse({ client_id: 'c1', name: 'x' });
    assert.equal(r?.client_id, 'c1');
    assert.equal(r?.last_seen_at, undefined);
});

test('parseConvSettings carries the post-Plan-36 keys (camelCase host projection)', () => {
    const settings = parseConvSettings({
        systemPrompt: 'sp',
        temperature: 0.6,
        maxTokens: -1,
        topK: 10,
        topP: 0.5,
        repeatPenalty: 1.03,
        presencePenalty: 0,
        frequencyPenalty: 0,
        forceAppSampling: false,
        toolsInSystemPrompt: true,
        dynamicCompactEnabled: false,
        compactEveryTurns: 35,
    });
    assert.equal(settings?.maxTokens, -1);
    assert.equal(settings?.topK, 10);
    assert.equal(settings?.topP, 0.5);
    assert.equal(settings?.repeatPenalty, 1.03);
    assert.equal(settings?.presencePenalty, 0);
    assert.equal(settings?.frequencyPenalty, 0);
    assert.equal(settings?.forceAppSampling, false);
    assert.equal(settings?.toolsInSystemPrompt, true);
    assert.equal(settings?.dynamicCompactEnabled, false);
    assert.equal(settings?.compactEveryTurns, 35);
});

test('parseConvSettings defaults the post-Plan-36 keys when absent (older host)', () => {
    const settings = parseConvSettings({ systemPrompt: 'sp' });
    assert.equal(settings?.topK, -1);
    assert.equal(settings?.topP, -1);
    assert.equal(settings?.repeatPenalty, -1);
    assert.equal(settings?.presencePenalty, -1);
    assert.equal(settings?.frequencyPenalty, -1);
    assert.equal(settings?.forceAppSampling, true);
    assert.equal(settings?.toolsInSystemPrompt, false);
    assert.equal(settings?.dynamicCompactEnabled, true);
    assert.equal(settings?.compactEveryTurns, 20);
});

test('parseConvSettings accepts snake_case spellings of the post-Plan-36 keys', () => {
    const settings = parseConvSettings({
        top_k: 40,
        force_app_sampling: false,
        tools_in_system_prompt: true,
        dynamic_compact_enabled: false,
        compact_every_turns: 50,
    });
    assert.equal(settings?.topK, 40);
    assert.equal(settings?.forceAppSampling, false);
    assert.equal(settings?.toolsInSystemPrompt, true);
    assert.equal(settings?.dynamicCompactEnabled, false);
    assert.equal(settings?.compactEveryTurns, 50);
});
