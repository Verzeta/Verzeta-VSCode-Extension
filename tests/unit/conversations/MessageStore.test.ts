// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MessageStore } from '../../../src/extension/conversations/MessageStore.js';
import type { Logger, LogLevel } from '../../../src/extension/log/Logger.js';
import type { MessageUi } from '../../../src/shared/wire-types.js';

interface CapturedWarn {
    readonly message: string;
    readonly context: Readonly<Record<string, unknown>> | undefined;
}

function capturingLogger(warns: CapturedWarn[]): Logger {
    let level: LogLevel = 'info';
    const noop = (_m: string, _c?: Readonly<Record<string, unknown>>): void => {};
    const logger: Pick<
        Logger,
        'error' | 'warn' | 'info' | 'debug' | 'setLevel' | 'getLevel' | 'dispose'
    > = {
        error: noop,
        warn: (message, context) => {
            warns.push({ message, context });
        },
        info: noop,
        debug: noop,
        setLevel: (l) => {
            level = l;
        },
        getLevel: () => level,
        dispose: () => {},
    };
    return logger as Logger;
}

function userMsg(id: string, content: string): MessageUi {
    return { id, conversationId: 'c1', role: 'user', content, createdAt: 1 };
}

function assistantMsg(id: string, content: string, turnId?: string): MessageUi {
    return { id, conversationId: 'c1', role: 'assistant', content, createdAt: 1, turnId };
}

describe('MessageStore upsert reconciliation', () => {
    test('replace-by-id updates in place without growing the timeline', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', userMsg('u1', 'hello'));
        store.upsertOne('c1', userMsg('u1', 'hello edited'));
        const rows = store.byConversation('c1');
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.content, 'hello edited');
    });

    test('canonical user message replaces the optimistic placeholder', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', userMsg('optimistic:1:abc', '  hi there '));
        store.upsertOne('c1', userMsg('real-uuid', 'hi there'));
        const rows = store.byConversation('c1');
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, 'real-uuid');
    });

    test('optimistic arriving after canonical is dropped silently', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', userMsg('real-uuid', 'hi there'));
        store.upsertOne('c1', userMsg('optimistic:1:abc', 'hi there'));
        const rows = store.byConversation('c1');
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, 'real-uuid');
    });
});

describe('MessageStore DUPE-SUSPECT diagnostic', () => {
    test('warns when two rows share role+content under different ids', () => {
        const warns: CapturedWarn[] = [];
        const store = new MessageStore(capturingLogger(warns));
        store.upsertOne('c1', assistantMsg('a1', 'the answer'));
        store.upsertOne('c1', assistantMsg('a2', 'the answer'));
        assert.equal(store.byConversation('c1').length, 2);
        assert.equal(warns.length, 1);
        assert.match(warns[0]?.message ?? '', /DUPE-SUSPECT/);
        assert.equal(warns[0]?.context?.['insertedId'], 'a2');
        assert.equal(warns[0]?.context?.['twinId'], 'a1');
    });

    test('warns when two assistant rows share a turnId with different content', () => {
        const warns: CapturedWarn[] = [];
        const store = new MessageStore(capturingLogger(warns));
        store.upsertOne('c1', assistantMsg('stream-1', 'partial tex', 't9'));
        store.upsertOne('c1', assistantMsg('final-1', 'partial text plus the rest', 't9'));
        assert.equal(warns.length, 1);
        assert.match(warns[0]?.message ?? '', /DUPE-SUSPECT/);
        assert.equal(warns[0]?.context?.['twinTurnId'], 't9');
    });

    test('does not warn on a clean timeline', () => {
        const warns: CapturedWarn[] = [];
        const store = new MessageStore(capturingLogger(warns));
        store.upsertOne('c1', userMsg('u1', 'question'));
        store.upsertOne('c1', assistantMsg('a1', 'answer', 't1'));
        store.upsertOne('c1', assistantMsg('a2', 'second answer', 't2'));
        assert.equal(warns.length, 0);
    });

    test('does not warn when empty-content streaming placeholders coexist', () => {
        const warns: CapturedWarn[] = [];
        const store = new MessageStore(capturingLogger(warns));
        store.upsertOne('c1', assistantMsg('s1', ''));
        store.upsertOne('c1', assistantMsg('s2', ''));
        assert.equal(warns.length, 0);
    });
});

describe('MessageStore markFinalized — aborted empty stream', () => {
    test('stamps a finishReason on an empty aborted placeholder so it stops animating', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', {
            id: 'a1',
            conversationId: 'c1',
            role: 'assistant',
            content: '',
            createdAt: 1,
        });
        store.markFinalized('c1', 'a1', 'error');
        const row = store.byConversation('c1').find((m) => m.id === 'a1');
        assert.ok(row !== undefined);
        assert.notEqual(row?.finishReason ?? '', '');
    });

    test('does not clobber an already-set finishReason', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', {
            id: 'a1',
            conversationId: 'c1',
            role: 'assistant',
            content: 'done',
            createdAt: 1,
            finishReason: 'stop',
        });
        store.markFinalized('c1', 'a1', 'error');
        const row = store.byConversation('c1').find((m) => m.id === 'a1');
        assert.equal(row?.finishReason, 'stop');
    });
});

describe('MessageStore mergeFromHost: reopening a conversation', () => {
    test('host rows replace a stale streaming placeholder with the finished turn', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', userMsg('u1', 'question'));
        store.upsertOne('c1', assistantMsg('a1', 'partial'));
        store.mergeFromHost('c1', [
            userMsg('u1', 'question'),
            { ...assistantMsg('a1', 'the full answer'), finishReason: 'stop' },
            assistantMsg('a2', 'a turn that finished while the chat was closed'),
        ]);
        const rows = store.byConversation('c1');
        assert.deepEqual(
            rows.map((m) => m.id),
            ['u1', 'a1', 'a2'],
        );
        assert.equal(rows[1]?.content, 'the full answer');
    });

    test('an in-flight optimistic user row is kept until the host has it', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', userMsg('optimistic:1:x', 'pending text'));
        store.mergeFromHost('c1', [userMsg('u0', 'older')]);
        assert.deepEqual(
            store.byConversation('c1').map((m) => m.id),
            ['u0', 'optimistic:1:x'],
        );
        store.mergeFromHost('c1', [userMsg('u0', 'older'), userMsg('u1', 'pending text')]);
        assert.deepEqual(
            store.byConversation('c1').map((m) => m.id),
            ['u0', 'u1'],
        );
    });

    test('a streaming reply keeps its text when the host row is still empty', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', assistantMsg('a1', 'streamed so far'));
        store.mergeFromHost('c1', [assistantMsg('a1', '')]);
        assert.equal(store.byConversation('c1')[0]?.content, 'streamed so far');
    });

    test('a streaming reply the host does not list yet is kept', () => {
        const store = new MessageStore(capturingLogger([]));
        store.upsertOne('c1', assistantMsg('a9', 'still streaming'));
        store.mergeFromHost('c1', [userMsg('u1', 'q')]);
        assert.deepEqual(
            store.byConversation('c1').map((m) => m.id),
            ['u1', 'a9'],
        );
    });

    test('on an empty cache it behaves like replace', () => {
        const store = new MessageStore(capturingLogger([]));
        store.mergeFromHost('c1', [userMsg('u1', 'q'), assistantMsg('a1', 'a')]);
        assert.equal(store.byConversation('c1').length, 2);
    });
});
