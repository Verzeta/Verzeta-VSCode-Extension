// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { ProjectStore } from '../../../src/extension/conversations/ProjectStore.js';
import type { FolderUi, MemberUi } from '../../../src/shared/wire-types.js';
import { silentLogger } from '../helpers/silentLogger.js';

function project(id: string, name: string): FolderUi {
    return { id, name, folderType: 'project' };
}

function member(id: string, alias: string): MemberUi {
    return {
        id,
        agentId: `agent-${id}`,
        alias,
        isCoordinator: false,
    };
}

describe('ProjectStore', () => {
    test('foldersByHost is empty by default', () => {
        const store = new ProjectStore(silentLogger());
        deepStrictEqual(store.foldersByHost('h1'), []);
        store.dispose();
    });

    test('replaceFolders seeds the list and emits', () => {
        const store = new ProjectStore(silentLogger());
        let events = 0;
        store.on('foldersChanged', () => {
            events += 1;
        });
        store.replaceFolders('h1', [project('p1', 'Auth Rewrite')]);
        strictEqual(store.foldersByHost('h1').length, 1);
        strictEqual(events, 1);
        store.dispose();
    });

    test('findFolder resolves by id', () => {
        const store = new ProjectStore(silentLogger());
        store.replaceFolders('h1', [project('p1', 'Auth Rewrite'), project('p2', 'Migration')]);
        strictEqual(store.findFolder('h1', 'p2')?.name, 'Migration');
        strictEqual(store.findFolder('h1', 'nope'), undefined);
        store.dispose();
    });

    test('replaceMembers + membersOf round-trip', () => {
        const store = new ProjectStore(silentLogger());
        let events = 0;
        store.on('membersChanged', () => {
            events += 1;
        });
        store.replaceMembers('h1', 'p1', [member('m1', 'Coord'), member('m2', 'Researcher')]);
        strictEqual(store.membersOf('h1', 'p1').length, 2);
        strictEqual(events, 1);
        store.dispose();
    });

    test('clearHost drops all per-host folders and members', () => {
        const store = new ProjectStore(silentLogger());
        store.replaceFolders('h1', [project('p1', 'Auth')]);
        store.replaceMembers('h1', 'p1', [member('m1', 'Coord')]);
        store.clearHost('h1');
        deepStrictEqual(store.foldersByHost('h1'), []);
        deepStrictEqual(store.membersOf('h1', 'p1'), []);
        store.dispose();
    });

    test('clearHost emits foldersChanged when there were folders', () => {
        const store = new ProjectStore(silentLogger());
        let events = 0;
        store.replaceFolders('h1', [project('p1', 'Auth')]);
        store.on('foldersChanged', () => {
            events += 1;
        });
        store.clearHost('h1');
        strictEqual(events, 1);
        store.dispose();
    });
});
