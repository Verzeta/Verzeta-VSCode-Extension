// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { ConversationStore } from '../../../src/extension/conversations/ConversationStore.js';
import type { ConversationUi } from '../../../src/shared/wire-types.js';
import { silentLogger } from '../helpers/silentLogger.js';

function conv(id: string, title: string, updatedAt = 0): ConversationUi {
    return {
        id,
        title,
        createdAt: updatedAt,
        updatedAt,
        isGroup: false,
        isPinned: false,
    };
}

describe('ConversationStore', () => {
    test('byHost returns empty list for unknown host', () => {
        const store = new ConversationStore(silentLogger());
        deepStrictEqual(store.byHost('host-x'), []);
        store.dispose();
    });

    test('replace seeds the host list', () => {
        const store = new ConversationStore(silentLogger());
        store.replace('host-1', [conv('a', 'Alpha'), conv('b', 'Beta')]);
        const list = store.byHost('host-1');
        strictEqual(list.length, 2);
        strictEqual(list[0]?.id, 'a');
        strictEqual(list[1]?.id, 'b');
        store.dispose();
    });

    test('replace emits changed once', () => {
        const store = new ConversationStore(silentLogger());
        let received = 0;
        store.on('changed', () => {
            received += 1;
        });
        store.replace('host-1', [conv('a', 'Alpha')]);
        strictEqual(received, 1);
        store.dispose();
    });

    test('upsertOne adds a new entry', () => {
        const store = new ConversationStore(silentLogger());
        store.upsertOne('host-1', conv('a', 'Alpha'));
        strictEqual(store.byHost('host-1').length, 1);
        store.dispose();
    });

    test('upsertOne updates an existing entry by id', () => {
        const store = new ConversationStore(silentLogger());
        store.replace('host-1', [conv('a', 'Old')]);
        store.upsertOne('host-1', conv('a', 'New'));
        strictEqual(store.byHost('host-1').length, 1);
        strictEqual(store.byHost('host-1')[0]?.title, 'New');
        store.dispose();
    });

    test('removeOne drops the entry', () => {
        const store = new ConversationStore(silentLogger());
        store.replace('host-1', [conv('a', 'A'), conv('b', 'B')]);
        store.removeOne('host-1', 'a');
        const list = store.byHost('host-1');
        strictEqual(list.length, 1);
        strictEqual(list[0]?.id, 'b');
        store.dispose();
    });

    test('removeOne clears active when it matches', () => {
        const store = new ConversationStore(silentLogger());
        store.replace('host-1', [conv('a', 'A')]);
        store.setActiveConversationId('a');
        const activeChanges: Array<string | undefined> = [];
        store.on('activeChanged', (id) => activeChanges.push(id));
        store.removeOne('host-1', 'a');
        strictEqual(store.activeConversationId(), undefined);
        deepStrictEqual(activeChanges, [undefined]);
        store.dispose();
    });

    test('setActiveConversationId is idempotent', () => {
        const store = new ConversationStore(silentLogger());
        let changes = 0;
        store.on('activeChanged', () => {
            changes += 1;
        });
        store.setActiveConversationId('a');
        store.setActiveConversationId('a');
        strictEqual(changes, 1);
        store.dispose();
    });

    test('findById resolves correctly', () => {
        const store = new ConversationStore(silentLogger());
        store.replace('host-1', [conv('a', 'Alpha'), conv('b', 'Beta')]);
        strictEqual(store.findById('host-1', 'b')?.title, 'Beta');
        strictEqual(store.findById('host-1', 'nope'), undefined);
        strictEqual(store.findById('host-z', 'a'), undefined);
        store.dispose();
    });

    test('clearHost drops the host entirely', () => {
        const store = new ConversationStore(silentLogger());
        store.replace('host-1', [conv('a', 'Alpha')]);
        store.clearHost('host-1');
        deepStrictEqual(store.byHost('host-1'), []);
        store.dispose();
    });
});
