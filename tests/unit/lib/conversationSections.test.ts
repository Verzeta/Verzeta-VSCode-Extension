// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRows } from '../../../webview-ui/src/lib/conversationSections.js';
import type { ConversationFullUi, FolderSummaryUi } from '../../../src/shared/webview-protocol.js';

function conv(over: Partial<ConversationFullUi>): ConversationFullUi {
    return {
        id: 'c',
        hostId: 'h',
        title: 'Conv',
        folderId: undefined,
        isGroup: false,
        isPinned: false,
        primaryAgentId: undefined,
        updatedAt: 1,
        preview: '',
        ...over,
    };
}

function folder(over: Partial<FolderSummaryUi>): FolderSummaryUi {
    return {
        id: 'f',
        hostId: 'h',
        name: 'F',
        folderType: 'regular',
        parentId: undefined,
        ...over,
    } as FolderSummaryUi;
}

function build(
    conversations: ConversationFullUi[],
    folders: FolderSummaryUi[],
    expandedFolderIds: ReadonlySet<string> = new Set(),
) {
    return buildRows({
        conversations,
        folders,
        searchQuery: '',
        collapsedSections: new Set(),
        expandedFolderIds,
        membersByFolder: new Map(),
        agents: [],
    });
}

describe('buildRows — regular folders + never-vanish', () => {
    test('a regular folder renders as a group with a FOLDER header', () => {
        const rows = build(
            [conv({ id: 'hello', title: 'Hello Friend', folderId: 'aegis' })],
            [folder({ id: 'aegis', name: 'Aegis', folderType: 'regular' })],
            new Set(['aegis']),
        );
        const header = rows.find((r) => r.kind === 'projectHeader');
        assert.ok(header !== undefined, 'regular folder must produce a header');
        assert.equal(header.kind === 'projectHeader' && header.folderType, 'regular');
        assert.equal(header.kind === 'projectHeader' && header.count, 1);
        const plainHeader = rows.find((r) => r.kind === 'sectionHeader' && r.section === 'plain');
        assert.equal(plainHeader, undefined, 'conv must not leak into Plain Chats');
    });

    test('a conv in an UNKNOWN folder falls back to Plain Chats, never vanishes', () => {
        const rows = build(
            [conv({ id: 'orphan', title: 'Orphan', folderId: 'missing-folder' })],
            [],
        );
        const plain = rows.find((r) => r.kind === 'sectionHeader' && r.section === 'plain');
        assert.ok(plain !== undefined, 'orphan must surface in Plain Chats');
        const orphanRow = rows.find((r) => r.kind === 'conversation' && r.conv.id === 'orphan');
        assert.ok(orphanRow !== undefined, 'orphan conversation must be rendered somewhere');
    });

    test('an orphan group conv falls back to Group Chats, not vanished', () => {
        const rows = build([conv({ id: 'g', title: 'G', folderId: 'gone', isGroup: true })], []);
        const groups = rows.find((r) => r.kind === 'sectionHeader' && r.section === 'groups');
        assert.ok(groups !== undefined);
    });

    test('project and regular folders coexist; convs bucket under their own folder', () => {
        const rows = build(
            [
                conv({ id: 'p1', folderId: 'proj' }),
                conv({ id: 'r1', folderId: 'reg' }),
                conv({ id: 'root1' }),
            ],
            [
                folder({ id: 'proj', name: 'Project', folderType: 'project' }),
                folder({ id: 'reg', name: 'Reg', folderType: 'regular' }),
            ],
            new Set(['reg']),
        );
        const headers = rows.filter((r) => r.kind === 'projectHeader');
        assert.equal(headers.length, 2);
        const plain = rows.find((r) => r.kind === 'sectionHeader' && r.section === 'plain');
        assert.ok(plain !== undefined && plain.kind === 'sectionHeader' && plain.count === 1);
    });
});
