// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { RemoteRepository } from '../../../src/extension/wire/RemoteRepository.js';
import type { RemoteSession } from '../../../src/extension/wire/RemoteSession.js';

interface SentOp {
    readonly op: string;
    readonly params: Readonly<Record<string, unknown>>;
}

function recordingSession(reply: unknown = {}): {
    session: RemoteSession;
    sent: SentOp[];
} {
    const sent: SentOp[] = [];
    const session = {
        send: (op: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
            sent.push({ op, params });
            return Promise.resolve(reply);
        },
    } as unknown as RemoteSession;
    return { session, sent };
}

test('saveConversationSettings maps ragEnabled to the snake_case rag_enabled key', async () => {
    const { session, sent } = recordingSession();
    const repo = new RemoteRepository(session);

    await repo.saveConversationSettings('conv-1', { ragEnabled: true });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.op, 'conv.settings.save');
    assert.equal(sent[0]?.params['conv_id'], 'conv-1');
    assert.equal(sent[0]?.params['rag_enabled'], true);
});

test('saveConversationSettings carries ragEnabled=false, not an omitted key', async () => {
    const { session, sent } = recordingSession();
    const repo = new RemoteRepository(session);

    await repo.saveConversationSettings('conv-1', { ragEnabled: false });

    const first = sent[0];
    assert.ok(first !== undefined);
    assert.equal(first.params['rag_enabled'], false);
    assert.ok('rag_enabled' in first.params);
});

test('saveConversationSettings omits rag_enabled when the patch does not mention it', async () => {
    const { session, sent } = recordingSession();
    const repo = new RemoteRepository(session);

    await repo.saveConversationSettings('conv-1', { thinking: true });

    const first = sent[0];
    assert.ok(first !== undefined);
    assert.equal(first.params['thinking'], true);
    assert.ok(!('rag_enabled' in first.params));
});

test('the dead host-global RAG ops are never sent', async () => {
    const { session, sent } = recordingSession();
    const repo = new RemoteRepository(session);

    await repo.saveConversationSettings('conv-1', { ragEnabled: true });
    await repo.saveConversationSettings('conv-1', { ragEnabled: false });

    const ops = sent.map((s) => s.op);
    assert.ok(!ops.includes('rag.enabled'), 'rag.enabled was removed from the host');
    assert.ok(!ops.includes('rag.enabled.set'), 'rag.enabled.set was removed from the host');
});

test('RemoteRepository no longer exposes the dead RAG accessors', () => {
    const repo = new RemoteRepository(recordingSession().session);
    const asRecord = repo as unknown as Record<string, unknown>;

    assert.equal(typeof asRecord['getRagEnabled'], 'undefined');
    assert.equal(typeof asRecord['setRagEnabled'], 'undefined');
});
