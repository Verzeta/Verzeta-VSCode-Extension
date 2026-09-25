// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
    parseActivityEvent,
    parseAgentSummary,
    parseClient,
    parseConversation,
    parseGeneratedFile,
    parseHeartbeatConfig,
    parseHeartbeatRun,
    parseMember,
    parseMessage,
    parsePlan,
    parsePoll,
    parseStep,
    parseToolCallLog,
    timestampOr,
} from '../../../src/extension/wire/RemoteJson.js';

const ISO = '2026-09-25T10:00:00.000Z';
const ISO_MS = Date.parse(ISO);

test('timestampOr accepts epoch ms and ISO strings, and falls back otherwise', () => {
    assert.equal(timestampOr(1234, 0), 1234);
    assert.equal(timestampOr(ISO, 0), ISO_MS);
    assert.equal(timestampOr('', 7), 7);
    assert.equal(timestampOr('not a date', 7), 7);
    assert.equal(timestampOr(null, 7), 7);
});

test('parseConversation reads ISO created_at / updated_at from conv.list', () => {
    const c = parseConversation({ id: 'c1', title: 'T', created_at: ISO, updated_at: ISO });
    assert.equal(c?.createdAt, ISO_MS);
    assert.equal(c?.updatedAt, ISO_MS);
    assert.equal(parseConversation({ id: 'c1', updated_at: 42 })?.updatedAt, 42);
});

test('parseMessage reads an ISO created_at from msg.list', () => {
    const m = parseMessage({ id: 'm1', conversation_id: 'c1', content: 'x', created_at: ISO });
    assert.equal(m?.createdAt, ISO_MS);
});

test('parseMember reads the camelCase override fields from folder.members', () => {
    const m = parseMember({
        agentId: 'a1',
        alias: 'Coder',
        isCoordinator: true,
        modelProvider: 'ollama',
        modelName: 'qwen',
        allowedTools: ['read_file', 'write_file'],
    });
    assert.equal(m?.modelProvider, 'ollama');
    assert.equal(m?.modelName, 'qwen');
    assert.deepEqual(m?.allowedTools, ['read_file', 'write_file']);
    assert.equal(m?.isCoordinator, true);
    const s = parseMember({ agent_id: 'a1', alias: 'X', model_provider: 'p', model_name: 'n' });
    assert.equal(s?.modelProvider, 'p');
    assert.deepEqual(s?.allowedTools, []);
});

test('parseAgentSummary reads iconName / isBuiltIn / isCoordinator from agent.list', () => {
    const a = parseAgentSummary({
        id: 'a1',
        name: 'Coordinator',
        iconName: 'star',
        isBuiltIn: true,
        isCoordinator: true,
    });
    assert.equal(a?.iconName, 'star');
    assert.equal(a?.isBuiltin, true);
    assert.equal(a?.isCoordinator, true);
    const b = parseAgentSummary({ id: 'a2', name: 'W', icon_name: 'pen', is_coordinator: true });
    assert.equal(b?.iconName, 'pen');
    assert.equal(b?.isCoordinator, true);
});

test('parseClient reads created_at as the first-paired time', () => {
    assert.equal(parseClient({ id: 'x', created_at: 99, last_seen_at: 100 })?.firstPairedAt, 99);
    assert.equal(parseClient({ id: 'x', first_paired_at: 5 })?.firstPairedAt, 5);
});

test('parseHeartbeatConfig carries surfaceCriteria and selfConfigAllowed', () => {
    const cfg = parseHeartbeatConfig({
        id: 'h1',
        agentId: 'a1',
        scopeType: 'folder',
        scopeId: 'f1',
        surfaceCriteria: 'only when tests fail',
        selfConfigAllowed: true,
    });
    assert.equal(cfg?.surfaceCriteria, 'only when tests fail');
    assert.equal(cfg?.selfConfigAllowed, true);
    const empty = parseHeartbeatConfig({ id: 'h2' });
    assert.equal(empty?.surfaceCriteria, '');
    assert.equal(empty?.selfConfigAllowed, false);
});

test('parseHeartbeatConfig treats the host conversation scopes as conversation', () => {
    assert.equal(
        parseHeartbeatConfig({ id: 'h', scopeType: 'conversation_group' })?.scopeType,
        'conversation',
    );
    assert.equal(
        parseHeartbeatConfig({ id: 'h', scopeType: 'conversation_1to1' })?.scopeType,
        'conversation',
    );
    assert.equal(parseHeartbeatConfig({ id: 'h', scopeType: 'folder' })?.scopeType, 'folder');
});

test('parsePlan maps the host plan statuses', () => {
    const cases: readonly [string, string][] = [
        ['planning', 'running'],
        ['executing', 'running'],
        ['critiquing', 'running'],
        ['blocked', 'blocked'],
        ['completed', 'complete'],
        ['failed', 'error'],
        ['complete', 'complete'],
        ['mystery', 'queued'],
    ];
    for (const [host, client] of cases) {
        assert.equal(parsePlan({ id: 'p', status: host })?.status, client, host);
    }
});

test('parseStep maps the host step statuses and reads title and ordering', () => {
    const cases: readonly [string, string][] = [
        ['pending', 'queued'],
        ['in_progress', 'running'],
        ['submitted', 'running'],
        ['done', 'done'],
        ['needs_rework', 'error'],
        ['blocked', 'error'],
        ['skipped', 'skipped'],
    ];
    for (const [host, client] of cases) {
        assert.equal(parseStep({ id: 's', status: host })?.status, client, host);
    }
    const s = parseStep({
        id: 's1',
        plan_id: 'p1',
        ordering: 3,
        title: 'Write tests',
        description: 'long text',
        last_rejection_reason: 'missing edge cases',
    });
    assert.equal(s?.description, 'Write tests');
    assert.equal(s?.iteration, 3);
    assert.equal(s?.errorMessage, 'missing edge cases');
    assert.equal(parseStep({ id: 's2', description: 'old' })?.description, 'old');
});

test('parseToolCallLog stringifies a JSON result and reads started_at', () => {
    const row = parseToolCallLog({
        id: 't1',
        tool_name: 'read_file',
        arguments: { path: 'a.ts' },
        result: { ok: true, lines: 3 },
        started_at: 1700,
    });
    assert.deepEqual(JSON.parse(row?.result ?? ''), { ok: true, lines: 3 });
    assert.deepEqual(JSON.parse(row?.arguments ?? ''), { path: 'a.ts' });
    assert.equal(row?.createdAt, 1700);
    assert.equal(parseToolCallLog({ id: 't2', result: 'plain' })?.result, 'plain');
    assert.equal(parseToolCallLog({ id: 't3', result: null })?.result, '');
});

test('parseActivityEvent reads the camelCase audit row', () => {
    const e = parseActivityEvent({
        id: 'e1',
        eventType: 'tool_call',
        eventSummary: 'Read a.ts',
        toolName: 'read_file',
        actorAlias: 'Coder',
        createdAt: ISO,
    });
    assert.equal(e?.kind, 'tool_call');
    assert.equal(e?.description, 'Read a.ts');
    assert.equal(e?.actorAlias, 'Coder');
    assert.equal(e?.createdAt, ISO_MS);
    assert.equal(parseActivityEvent({ id: 'e2', toolName: 'grep' })?.description, 'grep');
    assert.equal(parseActivityEvent({ id: 'e3', kind: 'k', description: 'd' })?.kind, 'k');
});

test('parsePoll reads votes, status and ISO timestamps', () => {
    const poll = parsePoll({
        id: 'p1',
        conversation_id: 'c1',
        question: 'Ship?',
        mode: 'single',
        status: 'closed',
        created_at: ISO,
        closes_at: '',
        options: [
            { id: 'o1', text: 'Yes', votes: 2 },
            { id: 'o2', text: 'No', votes: 0 },
        ],
    });
    assert.equal(poll?.closed, true);
    assert.equal(poll?.createdAt, ISO_MS);
    assert.equal(poll?.closesAt, 0);
    assert.deepEqual(
        poll?.options.map((o) => o.voteCount),
        [2, 0],
    );
    assert.equal(parsePoll({ id: 'p2', status: 'open' })?.closed, false);
    assert.equal(parsePoll({ id: 'p3', closed: true })?.closed, true);
});

test('parseHeartbeatRun reads startedAtMs, durationMs and title', () => {
    const run = parseHeartbeatRun({
        id: 'r1',
        configId: 'h1',
        startedAtMs: 1000,
        durationMs: 250,
        outcome: 'surfaced',
        title: 'Nightly summary',
    });
    assert.equal(run?.configId, 'h1');
    assert.equal(run?.startedAt, 1000);
    assert.equal(run?.finishedAt, 1250);
    assert.equal(run?.report, 'Nightly summary');
    const pending = parseHeartbeatRun({ id: 'r2', startedAtMs: -1, durationMs: -1 });
    assert.equal(pending?.startedAt, 0);
    assert.equal(pending?.finishedAt, 0);
});

test('parseGeneratedFile reads total_bytes and clamps a missing file to 0', () => {
    assert.equal(parseGeneratedFile({ file_name: 'a.png', total_bytes: 2048 })?.size, 2048);
    assert.equal(parseGeneratedFile({ file_name: 'gone.png', total_bytes: -1 })?.size, 0);
    assert.equal(parseGeneratedFile({ name: 'x', size: 10 })?.size, 10);
    assert.equal(parseGeneratedFile({ file_name: 'a', created_at: ISO })?.createdAt, ISO_MS);
});
