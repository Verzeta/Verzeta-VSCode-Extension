// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContextFillStore } from '../../../src/extension/conversations/ContextFillStore.js';
import { ConversationStore } from '../../../src/extension/conversations/ConversationStore.js';
import { MessageStore } from '../../../src/extension/conversations/MessageStore.js';
import { ProjectStore } from '../../../src/extension/conversations/ProjectStore.js';
import { WireSync, agentStepSucceeded } from '../../../src/extension/conversations/WireSync.js';
import type { ConnectionManager } from '../../../src/extension/hosts/ConnectionManager.js';
import type { RemoteEvent } from '../../../src/shared/wire-envelope.js';
import type { AgentStepUi, MemberUi, PollUi } from '../../../src/shared/wire-types.js';
import { silentLogger } from '../helpers/silentLogger.js';

const HOST = 'host-1';

interface Harness {
    readonly emit: (event: string, data: unknown) => void;
    readonly projectStore: ProjectStore;
    readonly notified: { readonly name: string; readonly args: readonly unknown[] }[];
    readonly fetched: string[];
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function makeHarness(repo: Record<string, (...args: never[]) => Promise<unknown>>): Harness {
    const logger = silentLogger();
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    let onEvent: ((event: RemoteEvent) => void) | undefined;
    const notified: { name: string; args: readonly unknown[] }[] = [];
    const fetched: string[] = [];
    const repository = new Proxy(
        {
            listConversations: () => Promise.resolve([]),
            listAllFolders: () => Promise.resolve([]),
            ...repo,
        },
        {
            get(target, prop: string) {
                const fn = (target as Record<string, unknown>)[prop];
                if (typeof fn !== 'function') return undefined;
                return (...args: never[]) => {
                    fetched.push(prop);
                    return (fn as (...a: never[]) => unknown)(...args);
                };
            },
        },
    );
    const connectionManager = new Proxy(
        {
            on: (name: string, cb: (...args: unknown[]) => void) => {
                listeners.set(name, [...(listeners.get(name) ?? []), cb]);
            },
            off: () => {},
            sessionFor: () => ({
                onEvent: (cb: (event: RemoteEvent) => void) => {
                    onEvent = cb;
                    return () => {};
                },
            }),
            repositoryFor: () => repository,
        } as Record<string, unknown>,
        {
            get(target, prop: string) {
                if (prop in target) return target[prop];
                if (prop.startsWith('notify')) {
                    return (...args: unknown[]) => notified.push({ name: prop, args });
                }
                return undefined;
            },
        },
    ) as unknown as ConnectionManager;

    const projectStore = new ProjectStore(logger);
    new WireSync({
        connectionManager,
        conversationStore: new ConversationStore(logger),
        projectStore,
        messageStore: new MessageStore(logger),
        contextFillStore: new ContextFillStore(),
        logger,
    });
    for (const cb of listeners.get('sessionReady') ?? []) cb(HOST, repository);
    return {
        emit: (event, data) => onEvent?.({ type: 'event', event, data }),
        projectStore,
        notified,
        fetched,
    };
}

const MEMBER: MemberUi = { id: 'm1', agentId: 'a1', alias: 'Coder', isCoordinator: false };

test('folder.members.changed re-reads the roster instead of wiping it', async () => {
    const h = makeHarness({ listFolderMembers: () => Promise.resolve([MEMBER]) });
    await flush();
    h.projectStore.replaceMembers(HOST, 'f1', [MEMBER]);

    h.emit('folder.members.changed', { folder_id: 'f1' });
    await flush();

    assert.ok(h.fetched.includes('listFolderMembers'));
    assert.deepEqual(h.projectStore.membersOf(HOST, 'f1'), [MEMBER]);
});

test('step.updated forwards the plan id from the payload', async () => {
    const h = makeHarness({});
    await flush();

    h.emit('step.updated', { step_id: 's1', plan_id: 'p1' });

    const call = h.notified.find((n) => n.name === 'notifyStepUpdated');
    assert.deepEqual(call?.args, [HOST, 'p1']);
});

test('step.updated without a plan id is ignored', async () => {
    const h = makeHarness({});
    await flush();
    h.emit('step.updated', { step_id: 's1' });
    assert.equal(
        h.notified.some((n) => n.name === 'notifyStepUpdated'),
        false,
    );
});

test('poll events fetch the poll and forward it', async () => {
    const poll: PollUi = {
        id: 'p1',
        conversationId: 'c1',
        question: 'Q',
        options: [],
        mode: 'single',
        closed: false,
        closesAt: 0,
        createdAt: 0,
    };
    const h = makeHarness({ getPollResults: () => Promise.resolve(poll) });
    await flush();

    for (const event of ['poll.created', 'poll.updated', 'poll.closed', 'poll.vote_cast']) {
        h.emit(event, { conv_id: 'c1', poll_id: 'p1' });
    }
    await flush();

    const forwarded = h.notified.filter((n) => n.name === 'notifyPollChanged');
    assert.equal(forwarded.length, 4);
    assert.deepEqual(forwarded[0]?.args, [HOST, poll]);
});

test('agent.step.completed reads the host success flag', async () => {
    const h = makeHarness({});
    await flush();

    h.emit('agent.step.completed', { iteration: 2, description: 'Build', success: false });
    h.emit('agent.step.completed', { iteration: 3, description: 'Test', success: true });

    const steps = h.notified
        .filter((n) => n.name === 'notifyAgentStepUpdated')
        .map((n) => (n.args[1] as AgentStepUi).status);
    assert.deepEqual(steps, ['error', 'success']);
});

test('agentStepSucceeded honours success, then status, then defaults to success', () => {
    assert.equal(agentStepSucceeded({ success: false }), false);
    assert.equal(agentStepSucceeded({ success: true, status: 'error' }), true);
    assert.equal(agentStepSucceeded({ status: 'error' }), false);
    assert.equal(agentStepSucceeded({}), true);
});

test('canvas.opened and canvas.updated notify a canvas change for the conversation', async () => {
    const h = makeHarness({});
    await flush();

    h.emit('canvas.opened', { conv_id: 'c1', canvas_id: 'k1', filename: 'a.py' });
    h.emit('canvas.updated', { conv_id: 'c1', canvas_id: 'k1' });

    const calls = h.notified.filter((n) => n.name === 'notifyCanvasChanged');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]?.args, [HOST, 'c1']);
});

test('user.message.queued is forwarded', async () => {
    const h = makeHarness({});
    await flush();
    h.emit('user.message.queued', { text: 'hi' });
    assert.ok(h.notified.some((n) => n.name === 'notifyUserMessageQueued'));
});
