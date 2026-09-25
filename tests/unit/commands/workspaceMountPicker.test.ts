// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    clampDefaultTier,
    conversationKindOf,
    describeConversationContext,
    iconForConversation,
    labelForConversation,
    resolveBindFolderForConv,
    resolveCallerFolderId,
    walkFolderChain,
    type BindRepository,
    type BindCacheUpdater,
} from '../../../src/extension/commands/workspaceMountPicker.js';
import type { ConversationUi, FolderUi } from '../../../src/shared/wire-types.js';

function folder(
    id: string,
    name: string,
    folderType: FolderUi['folderType'] = 'regular',
    parentId?: string,
): FolderUi {
    return { id, name, folderType, parentId };
}

function conv(id: string, title: string, overrides: Partial<ConversationUi> = {}): ConversationUi {
    return {
        id,
        title,
        folderId: undefined,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        isGroup: false,
        isPinned: false,
        primaryAgentId: undefined,
        memberAlias: undefined,
        preview: undefined,
        ...overrides,
    };
}

describe('walkFolderChain', () => {
    test('returns empty when startFolderId is undefined', () => {
        const chain = walkFolderChain([folder('a', 'A')], undefined);
        assert.deepEqual(chain, []);
    });

    test('returns empty when startFolderId is an empty string', () => {
        const chain = walkFolderChain([folder('a', 'A')], '');
        assert.deepEqual(chain, []);
    });

    test('returns empty when the starting folder is not in the cache', () => {
        const chain = walkFolderChain([folder('a', 'A')], 'unknown');
        assert.deepEqual(chain, []);
    });

    test('returns just the starting folder when it has no parent', () => {
        const root = folder('a', 'A');
        const chain = walkFolderChain([root], 'a');
        assert.deepEqual(
            chain.map((f) => f.id),
            ['a'],
        );
    });

    test('returns innermost-first when walking a two-level chain', () => {
        const parent = folder('p', 'Parent');
        const child = folder('c', 'Child', 'regular', 'p');
        const chain = walkFolderChain([parent, child], 'c');
        assert.deepEqual(
            chain.map((f) => f.id),
            ['c', 'p'],
        );
    });

    test('walks three levels in order [innermost, middle, outermost]', () => {
        const root = folder('root', 'Root', 'organization');
        const mid = folder('mid', 'Mid', 'project', 'root');
        const leaf = folder('leaf', 'Leaf', 'regular', 'mid');
        const chain = walkFolderChain([root, mid, leaf], 'leaf');
        assert.deepEqual(
            chain.map((f) => f.id),
            ['leaf', 'mid', 'root'],
        );
    });

    test('breaks gracefully when a parent reference dangles', () => {
        const orphan = folder('orphan', 'Orphan', 'regular', 'gone');
        const chain = walkFolderChain([orphan], 'orphan');
        assert.deepEqual(
            chain.map((f) => f.id),
            ['orphan'],
        );
    });

    test('caps the walk at the safety limit for cyclic data', () => {
        const cyc = folder('cyc', 'Cyc', 'regular', 'cyc');
        const chain = walkFolderChain([cyc], 'cyc');
        assert.equal(chain.length, 32);
        for (const f of chain) assert.equal(f.id, 'cyc');
    });
});

describe('resolveCallerFolderId', () => {
    test('returns undefined for an empty chain', () => {
        assert.equal(resolveCallerFolderId([]), undefined);
    });

    test('returns the project folder when chain holds only a project', () => {
        const p = folder('p', 'P', 'project');
        assert.equal(resolveCallerFolderId([p]), 'p');
    });

    test('returns the organization folder when chain holds only an org', () => {
        const o = folder('o', 'O', 'organization');
        assert.equal(resolveCallerFolderId([o]), 'o');
    });

    test('returns the regular folder when no project ancestor exists', () => {
        const r = folder('r', 'R', 'regular');
        assert.equal(resolveCallerFolderId([r]), 'r');
    });

    test('picks the first project (innermost) when nested under another project', () => {
        const inner = folder('inner', 'Inner', 'project');
        const outer = folder('outer', 'Outer', 'project');
        assert.equal(resolveCallerFolderId([inner, outer]), 'inner');
    });

    test('skips a regular leaf and picks the project ancestor', () => {
        const leaf = folder('leaf', 'Leaf', 'regular');
        const proj = folder('proj', 'Proj', 'project');
        assert.equal(resolveCallerFolderId([leaf, proj]), 'proj');
    });

    test('treats organization same as project (isProject() includes both)', () => {
        const leaf = folder('leaf', 'Leaf', 'regular');
        const org = folder('org', 'Org', 'organization');
        assert.equal(resolveCallerFolderId([leaf, org]), 'org');
    });

    test('falls back to chain.first when no project / org in the chain', () => {
        const leaf = folder('leaf', 'Leaf', 'regular');
        const mid = folder('mid', 'Mid', 'regular');
        assert.equal(resolveCallerFolderId([leaf, mid]), 'leaf');
    });
});

describe('conversationKindOf', () => {
    test('detects group conversations', () => {
        assert.equal(conversationKindOf(conv('c', 'Group', { isGroup: true })), 'group');
    });

    test('detects 1:1 with agent when primaryAgentId is set', () => {
        assert.equal(
            conversationKindOf(conv('c', '1:1', { primaryAgentId: 'agent-1' })),
            'oneToOne',
        );
    });

    test('treats no agent + no group as plain', () => {
        assert.equal(conversationKindOf(conv('c', 'Plain')), 'plain');
    });

    test('treats empty-string primaryAgentId as no agent', () => {
        assert.equal(
            conversationKindOf(conv('c', 'Plain-with-empty', { primaryAgentId: '' })),
            'plain',
        );
    });

    test('group flag wins over agent id (group with coordinator agent)', () => {
        assert.equal(
            conversationKindOf(conv('c', 'Group', { isGroup: true, primaryAgentId: 'agent-1' })),
            'group',
        );
    });
});

describe('iconForConversation + labelForConversation', () => {
    test('plain conversation gets the comment codicon', () => {
        assert.equal(iconForConversation(conv('c', 't')), '$(comment)');
    });

    test('1:1 with agent gets the person codicon', () => {
        assert.equal(iconForConversation(conv('c', 't', { primaryAgentId: 'a' })), '$(person)');
    });

    test('group gets the organization codicon', () => {
        assert.equal(iconForConversation(conv('c', 't', { isGroup: true })), '$(organization)');
    });

    test('label combines icon + title verbatim', () => {
        const c = conv('c', 'My Chat');
        assert.equal(labelForConversation(c), '$(comment) My Chat');
    });

    test('label falls back when title is empty / whitespace', () => {
        const c = conv('c', '   ');
        assert.equal(labelForConversation(c), '$(comment) Untitled conversation');
    });
});

describe('describeConversationContext', () => {
    test('renders (root) for a conversation with no folder', () => {
        assert.equal(describeConversationContext(conv('c', 't'), []), '(root)');
    });

    test('renders a single folder by name when conv is in one folder', () => {
        const p = folder('p', 'Project A', 'project');
        assert.equal(
            describeConversationContext(conv('c', 't', { folderId: 'p' }), [p]),
            'Project A',
        );
    });

    test('renders outermost-first breadcrumb for nested folders', () => {
        const org = folder('org', 'Org', 'organization');
        const proj = folder('proj', 'Project', 'project', 'org');
        const leaf = folder('leaf', 'Sub', 'regular', 'proj');
        const ctx = describeConversationContext(conv('c', 't', { folderId: 'leaf' }), [
            org,
            proj,
            leaf,
        ]);
        assert.equal(ctx, 'Org / Project / Sub');
    });
});

interface FakeBindRepository extends BindRepository {
    readonly createCalls: string[];
    readonly moveCalls: { convId: string; folderId: string }[];
}

function fakeRepository(
    options: {
        createId?: string;
        createType?: string;
        createFails?: boolean;
        moveFails?: boolean;
    } = {},
): FakeBindRepository {
    const createCalls: string[] = [];
    const moveCalls: { convId: string; folderId: string }[] = [];
    return {
        createCalls,
        moveCalls,
        createFolder: async (name) => {
            createCalls.push(name);
            if (options.createFails === true) {
                throw new Error('createFolder failed');
            }
            return {
                id: options.createId ?? 'new-folder-id',
                type: options.createType ?? 'project',
            };
        },
        moveConversationToFolder: async (convId, folderId) => {
            moveCalls.push({ convId, folderId });
            if (options.moveFails === true) {
                throw new Error('moveConversationToFolder failed');
            }
        },
    };
}

function fakeCacheUpdater(): BindCacheUpdater & { readonly upserts: FolderUi[] } {
    const upserts: FolderUi[] = [];
    return {
        upserts,
        upsertFolder: (f) => {
            upserts.push(f);
        },
    };
}

describe('resolveBindFolderForConv', () => {
    test('conv in a project folder → returns the project id, no host mutation', async () => {
        const proj = folder('proj', 'Project A', 'project');
        const repo = fakeRepository();
        const result = await resolveBindFolderForConv({
            conv: conv('c', 't', { folderId: 'proj' }),
            folders: [proj],
            workspaceTail: 'myrepo',
            repository: repo,
        });
        assert.deepEqual(result, { folderId: 'proj', created: false, name: 'Project A' });
        assert.deepEqual(repo.createCalls, []);
        assert.deepEqual(repo.moveCalls, []);
    });

    test('conv in an organization folder → returns the org id, no host mutation', async () => {
        const org = folder('org', 'Org', 'organization');
        const repo = fakeRepository();
        const result = await resolveBindFolderForConv({
            conv: conv('c', 't', { folderId: 'org' }),
            folders: [org],
            workspaceTail: 'myrepo',
            repository: repo,
        });
        assert.deepEqual(result, { folderId: 'org', created: false, name: 'Org' });
        assert.deepEqual(repo.createCalls, []);
        assert.deepEqual(repo.moveCalls, []);
    });

    test('conv in a regular folder with no project ancestor → returns that folder id', async () => {
        const reg = folder('reg', 'Reg', 'regular');
        const repo = fakeRepository();
        const result = await resolveBindFolderForConv({
            conv: conv('c', 't', { folderId: 'reg' }),
            folders: [reg],
            workspaceTail: 'myrepo',
            repository: repo,
        });
        assert.deepEqual(result, { folderId: 'reg', created: false, name: 'Reg' });
        assert.deepEqual(repo.createCalls, []);
    });

    test('conv in regular nested in project → bubbles up to the project id', async () => {
        const proj = folder('proj', 'Project', 'project');
        const reg = folder('reg', 'Sub', 'regular', 'proj');
        const repo = fakeRepository();
        const result = await resolveBindFolderForConv({
            conv: conv('c', 't', { folderId: 'reg' }),
            folders: [proj, reg],
            workspaceTail: 'myrepo',
            repository: repo,
        });
        assert.deepEqual(result, { folderId: 'proj', created: false, name: 'Project' });
        assert.deepEqual(repo.createCalls, []);
    });

    test('conv at root (folderId undefined) → auto-create + move + return new id', async () => {
        const repo = fakeRepository({ createId: 'newf', createType: 'project' });
        const cache = fakeCacheUpdater();
        const result = await resolveBindFolderForConv({
            conv: conv('c-1', 'Plain'),
            folders: [],
            workspaceTail: 'myrepo',
            repository: repo,
            cacheUpdater: cache,
        });
        assert.deepEqual(result, { folderId: 'newf', created: true, name: 'myrepo' });
        assert.deepEqual(repo.createCalls, ['myrepo']);
        assert.deepEqual(repo.moveCalls, [{ convId: 'c-1', folderId: 'newf' }]);
        assert.equal(cache.upserts.length, 1);
        const upserted = cache.upserts[0];
        assert.notEqual(upserted, undefined);
        assert.equal(upserted?.id, 'newf');
        assert.equal(upserted?.name, 'myrepo');
        assert.equal(upserted?.folderType, 'project');
    });

    test('conv with empty-string folderId → treated as root (auto-create path)', async () => {
        const repo = fakeRepository({ createId: 'newf' });
        const result = await resolveBindFolderForConv({
            conv: conv('c', 't', { folderId: '' }),
            folders: [],
            workspaceTail: 'tail',
            repository: repo,
        });
        assert.equal(result.created, true);
        assert.equal(result.folderId, 'newf');
        assert.deepEqual(repo.createCalls, ['tail']);
    });

    test('conv with stale cache (folderId set but folder missing) → trusts conv.folderId', async () => {
        const repo = fakeRepository();
        const result = await resolveBindFolderForConv({
            conv: conv('c', 't', { folderId: 'missing' }),
            folders: [],
            workspaceTail: 'tail',
            repository: repo,
        });
        assert.deepEqual(result, { folderId: 'missing', created: false, name: 'tail' });
        assert.deepEqual(repo.createCalls, []);
        assert.deepEqual(repo.moveCalls, []);
    });

    test('createFolder failure surfaces (no move call attempted)', async () => {
        const repo = fakeRepository({ createFails: true });
        await assert.rejects(
            resolveBindFolderForConv({
                conv: conv('c', 't'),
                folders: [],
                workspaceTail: 'tail',
                repository: repo,
            }),
            /createFolder failed/,
        );
        assert.deepEqual(repo.createCalls, ['tail']);
        assert.deepEqual(repo.moveCalls, []);
    });

    test('moveConversationToFolder failure surfaces after a successful create', async () => {
        const repo = fakeRepository({ createId: 'newf', moveFails: true });
        await assert.rejects(
            resolveBindFolderForConv({
                conv: conv('c', 't'),
                folders: [],
                workspaceTail: 'tail',
                repository: repo,
            }),
            /moveConversationToFolder failed/,
        );
        assert.deepEqual(repo.createCalls, ['tail']);
        assert.deepEqual(repo.moveCalls, [{ convId: 'c', folderId: 'newf' }]);
    });

    test('unknown folder type from host is clamped to "project" in the cache upsert', async () => {
        const repo = fakeRepository({ createId: 'newf', createType: 'pirate' });
        const cache = fakeCacheUpdater();
        await resolveBindFolderForConv({
            conv: conv('c', 't'),
            folders: [],
            workspaceTail: 'tail',
            repository: repo,
            cacheUpdater: cache,
        });
        const upserted = cache.upserts[0];
        assert.notEqual(upserted, undefined);
        assert.equal(upserted?.folderType, 'project');
    });
});

describe('clampDefaultTier', () => {
    test('keeps smart and ask', () => {
        assert.equal(clampDefaultTier('smart'), 'smart');
        assert.equal(clampDefaultTier('ask'), 'ask');
    });

    test('never returns bypass as a default', () => {
        assert.equal(clampDefaultTier('bypass'), 'ask');
    });

    test('falls back to ask for anything else', () => {
        assert.equal(clampDefaultTier(undefined), 'ask');
        assert.equal(clampDefaultTier(42), 'ask');
        assert.equal(clampDefaultTier('SMART'), 'ask');
    });
});
