// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    WorkspaceMountService,
    type MountIdProvider,
    type MountRepository,
    type PersistedMountBinding,
    type TreeInputBundle,
    type TreeInputProvider,
} from '../../../src/extension/workspace/WorkspaceMountService.js';
import type { StatFn, StatResult } from '../../../src/extension/workspace/WorkspaceTreeBuilder.js';

interface RepoCall {
    readonly kind: 'register' | 'unregister' | 'updateTree' | 'updateTier';
    readonly folderId: string;
    readonly extra?: unknown;
}

function makeRepo(): MountRepository & { calls: readonly RepoCall[] } {
    const calls: RepoCall[] = [];
    return {
        calls,
        registerWorkspaceMount: async (params) => {
            calls.push({ kind: 'register', folderId: params.folderId, extra: params });
            return Promise.resolve();
        },
        unregisterWorkspaceMount: async (folderId) => {
            calls.push({ kind: 'unregister', folderId });
            return Promise.resolve();
        },
        updateWorkspaceMountTree: async (folderId, treeJson) => {
            calls.push({ kind: 'updateTree', folderId, extra: treeJson });
            return Promise.resolve();
        },
        updateWorkspaceMountTier: async (folderId, tier) => {
            calls.push({ kind: 'updateTier', folderId, extra: tier });
            return Promise.resolve();
        },
    };
}

function makeMountIds(): MountIdProvider & { generated: Map<string, string> } {
    const generated = new Map<string, string>();
    let nextId = 1000;
    return {
        generated,
        getOrCreateMountId: (folderId: string): string => {
            const existing = generated.get(folderId);
            if (existing !== undefined) return existing;
            const id = `mount-${nextId++}`;
            generated.set(folderId, id);
            return id;
        },
        clearMountId: (folderId: string): void => {
            generated.delete(folderId);
        },
    };
}

const FIXED_STAT: StatResult = { size: 10, mtimeMs: 1000 };
const FIXED_STAT_FN: StatFn = () => FIXED_STAT;

function makeTreeInput(
    overrides: Readonly<Record<string, TreeInputBundle | undefined>>,
): TreeInputProvider {
    return (folderId) => Promise.resolve(overrides[folderId]);
}

function silentLogger(): Record<string, (msg: string, ctx?: object) => void> {
    return {
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
    };
}

describe('WorkspaceMountService — register', () => {
    test('happy path: pushes register op, records snapshot', async () => {
        const repo = makeRepo();
        const mountIds = makeMountIds();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds,
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
            clock: { nowMs: () => 12345 },
        });

        const info = await svc.registerMount('folder-1', 'My Project', 'ask');

        assert.equal(repo.calls.length, 1);
        const call = repo.calls[0];
        assert.ok(call !== undefined);
        assert.equal(call.kind, 'register');
        assert.equal(call.folderId, 'folder-1');

        assert.equal(info.folderId, 'folder-1');
        assert.equal(info.ownerLabel, 'My Project');
        assert.equal(info.permissionTier, 'ask');
        assert.equal(info.workspaceRoot, '/r');
        assert.equal(info.registeredAtMs, 12345);
        assert.equal(info.fileCount, 1);
        assert.match(info.mountId, /^mount-/);
    });

    test('reusing the persisted mountId on re-register', async () => {
        const repo = makeRepo();
        const mountIds = makeMountIds();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds,
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
        });

        const a = await svc.registerMount('folder-1', 'lbl', 'ask');
        const b = await svc.registerMount('folder-1', 'lbl', 'ask');
        assert.equal(a.mountId, b.mountId);
    });

    test('throws when no workspace folder resolved', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({}),
        });
        await assert.rejects(
            svc.registerMount('missing', 'lbl', 'ask'),
            /no workspace folder resolved/,
        );
        assert.equal(repo.calls.length, 0);
    });

    test('throws when a concurrent in-flight operation exists for the same folder', async () => {
        const repo = makeRepo();
        let resolveRepo: (() => void) | undefined;
        const slowRepo: MountRepository = {
            ...repo,
            registerWorkspaceMount: () =>
                new Promise<void>((resolve) => {
                    resolveRepo = resolve;
                }),
        };
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: slowRepo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
        });

        const inFlight = svc.registerMount('folder-1', 'lbl', 'ask');
        await assert.rejects(svc.registerMount('folder-1', 'lbl', 'ask'), /already in flight/);
        assert.ok(resolveRepo !== undefined);
        resolveRepo();
        await inFlight;
    });
});

describe('WorkspaceMountService — unregister', () => {
    test('happy path: pushes unregister op, drops snapshot', async () => {
        const repo = makeRepo();
        const mountIds = makeMountIds();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds,
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
        });

        await svc.registerMount('folder-1', 'lbl', 'ask');
        assert.equal(svc.getActiveMounts().length, 1);

        await svc.unregisterMount('folder-1');

        assert.equal(svc.getActiveMounts().length, 0);
        assert.equal(svc.getMountForFolder('folder-1'), undefined);
        assert.equal(mountIds.generated.has('folder-1'), false);
        const unregCalls = repo.calls.filter((c) => c.kind === 'unregister');
        assert.equal(unregCalls.length, 1);
    });

    test('no-op on a folder that was never registered', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({}),
        });
        await svc.unregisterMount('nothing-here');
        assert.equal(repo.calls.length, 0);
    });
});

describe('WorkspaceMountService — refreshTree', () => {
    test('pushes update when the manifest changed', async () => {
        const repo = makeRepo();
        let candidates: readonly string[] = ['/r/a.ts'];
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: () =>
                Promise.resolve({
                    workspaceRoot: '/r',
                    candidates,
                    statFn: FIXED_STAT_FN,
                }),
        });

        await svc.registerMount('folder-1', 'lbl', 'ask');
        candidates = ['/r/a.ts', '/r/b.ts'];
        const pushed = await svc.refreshTree('folder-1');
        assert.equal(pushed, true);
        const updates = repo.calls.filter((c) => c.kind === 'updateTree');
        assert.equal(updates.length, 1);
    });

    test('returns false + skips wire call when the manifest is byte-identical', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: () =>
                Promise.resolve({
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                }),
        });

        await svc.registerMount('folder-1', 'lbl', 'ask');
        const pushed = await svc.refreshTree('folder-1');
        assert.equal(pushed, false);
        const updates = repo.calls.filter((c) => c.kind === 'updateTree');
        assert.equal(updates.length, 0);
    });

    test('refreshTree on never-registered folder is a no-op', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({}),
        });
        const pushed = await svc.refreshTree('nope');
        assert.equal(pushed, false);
        assert.equal(repo.calls.length, 0);
    });

    test('refreshTree when tree input returns undefined is a no-op', async () => {
        const repo = makeRepo();
        let provideInput = true;
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: () =>
                Promise.resolve(
                    provideInput
                        ? {
                              workspaceRoot: '/r',
                              candidates: ['/r/a.ts'],
                              statFn: FIXED_STAT_FN,
                          }
                        : undefined,
                ),
        });

        await svc.registerMount('folder-1', 'lbl', 'ask');
        provideInput = false;
        const pushed = await svc.refreshTree('folder-1');
        assert.equal(pushed, false);
    });
});

describe('WorkspaceMountService — setTier (local-only)', () => {
    test('updates local snapshot without a wire call', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
        });

        await svc.registerMount('folder-1', 'lbl', 'ask');
        const beforeCalls = repo.calls.length;

        svc.setTier('folder-1', 'smart');

        assert.equal(repo.calls.length, beforeCalls);
        assert.equal(svc.getMountForFolder('folder-1')?.permissionTier, 'smart');
    });

    test('setTier on never-registered folder is a no-op', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({}),
        });
        svc.setTier('nope', 'smart');
        assert.equal(repo.calls.length, 0);
    });

    test('setTier to current tier is a no-op (no log spam)', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
        });
        await svc.registerMount('folder-1', 'lbl', 'ask');
        svc.setTier('folder-1', 'ask');
        assert.equal(svc.getMountForFolder('folder-1')?.permissionTier, 'ask');
    });
});

describe('WorkspaceMountService: changeTier (host, then local)', () => {
    const TREE = {
        'folder-1': { workspaceRoot: '/r', candidates: ['/r/a.ts'], statFn: FIXED_STAT_FN },
    };

    test('pushes the tier to the host and then updates the snapshot', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TREE),
        });
        await svc.registerMount('folder-1', 'lbl', 'ask');

        await svc.changeTier('folder-1', 'smart');

        const last = repo.calls[repo.calls.length - 1];
        assert.equal(last?.kind, 'updateTier');
        assert.equal(last?.folderId, 'folder-1');
        assert.equal(last?.extra, 'smart');
        assert.equal(svc.getMountForFolder('folder-1')?.permissionTier, 'smart');
    });

    test('a host refusal throws and keeps the old tier', async () => {
        const repo = makeRepo();
        const refusing: MountRepository = {
            ...repo,
            updateWorkspaceMountTier: () => Promise.reject(new Error('mount_rejected: sql error')),
        };
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: refusing,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TREE),
        });
        await svc.registerMount('folder-1', 'lbl', 'ask');

        await assert.rejects(svc.changeTier('folder-1', 'smart'), /sql error/);
        assert.equal(svc.getMountForFolder('folder-1')?.permissionTier, 'ask');
    });

    test('same tier or unknown folder sends nothing', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TREE),
        });
        await svc.registerMount('folder-1', 'lbl', 'ask');
        const before = repo.calls.length;

        await svc.changeTier('folder-1', 'ask');
        await svc.changeTier('nope', 'smart');

        assert.equal(repo.calls.length, before);
    });
});

describe('WorkspaceMountService — dispose', () => {
    test('dispose drops mounts + subsequent calls throw', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
        });
        await svc.registerMount('folder-1', 'lbl', 'ask');
        svc.dispose();

        assert.equal(svc.getActiveMounts().length, 0);
        await assert.rejects(svc.registerMount('folder-2', 'lbl', 'ask'), /already disposed/);
        await assert.rejects(svc.refreshTree('folder-1'), /already disposed/);
        await assert.rejects(svc.unregisterMount('folder-1'), /already disposed/);
    });

    test('double dispose is a no-op', () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({}),
        });
        svc.dispose();
        svc.dispose();
    });
});

describe('WorkspaceMountService — accessors', () => {
    test('getActiveMounts returns insertion-order snapshots', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: (folderId) =>
                Promise.resolve({
                    workspaceRoot: '/r/' + folderId,
                    candidates: [`/r/${folderId}/a.ts`],
                    statFn: FIXED_STAT_FN,
                }),
        });

        await svc.registerMount('alpha', 'A', 'ask');
        await svc.registerMount('beta', 'B', 'smart');
        await svc.registerMount('gamma', 'C', 'bypass');

        const ids = svc.getActiveMounts().map((m) => m.folderId);
        assert.deepEqual(ids, ['alpha', 'beta', 'gamma']);
    });

    test('snapshot returned from getMountForFolder is detached from the registry', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput({
                'folder-1': {
                    workspaceRoot: '/r',
                    candidates: ['/r/a.ts'],
                    statFn: FIXED_STAT_FN,
                },
            }),
        });
        await svc.registerMount('folder-1', 'lbl', 'ask');
        const snap = svc.getMountForFolder('folder-1');
        assert.ok(snap !== undefined);
        svc.setTier('folder-1', 'smart');
        assert.equal(snap.permissionTier, 'ask');
        assert.equal(svc.getMountForFolder('folder-1')?.permissionTier, 'smart');
    });
});

describe('Reconnect + workspace-change lifecycles', () => {
    const TWO_FOLDER_TREE = {
        f1: { workspaceRoot: '/r1', candidates: ['/r1/a.ts'], statFn: FIXED_STAT_FN },
        f2: { workspaceRoot: '/r2', candidates: ['/r2/b.ts'], statFn: FIXED_STAT_FN },
    };

    function makeService(repo: ReturnType<typeof makeRepo>) {
        return new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TWO_FOLDER_TREE),
            clock: { nowMs: () => 1 },
        });
    }

    test('reRegisterActiveMounts refreshes every mount under its persisted mountId', async () => {
        const repo = makeRepo();
        const svc = makeService(repo);
        await svc.registerMount('f1', 'owner', 'ask');
        await svc.registerMount('f2', 'owner', 'bypass');
        const idsBefore = svc.getActiveMounts().map((m) => m.mountId);

        const count = await svc.reRegisterActiveMounts();

        assert.equal(count, 2);
        const registers = repo.calls.filter((c) => c.kind === 'register');
        assert.equal(registers.length, 4);
        const idsAfter = svc.getActiveMounts().map((m) => m.mountId);
        assert.deepEqual(idsAfter, idsBefore);
        assert.equal(svc.getMountForFolder('f2')?.permissionTier, 'bypass');
    });

    test('reRegisterActiveMounts skips a failing mount and continues', async () => {
        const repo = makeRepo();
        let fail = false;
        const failingRepo = {
            ...repo,
            registerWorkspaceMount: async (params: { folderId: string }) => {
                if (fail && params.folderId === 'f1') throw new Error('wire down');
                return repo.registerWorkspaceMount(
                    params as Parameters<typeof repo.registerWorkspaceMount>[0],
                );
            },
        };
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: failingRepo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TWO_FOLDER_TREE),
            clock: { nowMs: () => 1 },
        });
        await svc.registerMount('f1', 'owner', 'ask');
        await svc.registerMount('f2', 'owner', 'ask');
        fail = true;

        const count = await svc.reRegisterActiveMounts();

        assert.equal(count, 1);
        assert.equal(svc.getActiveMounts().length, 2);
    });

    test('unregisterAllMounts releases every active mount', async () => {
        const repo = makeRepo();
        const svc = makeService(repo);
        await svc.registerMount('f1', 'owner', 'ask');
        await svc.registerMount('f2', 'owner', 'ask');

        await svc.unregisterAllMounts();

        assert.equal(svc.getActiveMounts().length, 0);
        assert.equal(repo.calls.filter((c) => c.kind === 'unregister').length, 2);
    });
});

describe('Persisted-binding restore (VS Code restart)', () => {
    function makePersistence(initial: readonly PersistedMountBinding[]) {
        let stored: readonly PersistedMountBinding[] = initial;
        return {
            load: () => stored,
            save: (b: readonly PersistedMountBinding[]) => {
                stored = b;
            },
            get current() {
                return stored;
            },
        };
    }

    const TREE = {
        f1: { workspaceRoot: '/r1', candidates: ['/r1/a.ts'], statFn: FIXED_STAT_FN },
    };

    test('register/unregister write the binding list through the persistence seam', async () => {
        const persistence = makePersistence([]);
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: makeRepo(),
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TREE),
            clock: { nowMs: () => 1 },
            persistence,
        });
        await svc.registerMount('f1', 'owner', 'smart');
        assert.equal(persistence.current.length, 1);
        assert.equal(persistence.current[0]?.workspaceRoot, '/r1');
        assert.equal(persistence.current[0]?.permissionTier, 'smart');
        await svc.unregisterMount('f1');
        assert.equal(persistence.current.length, 0);
    });

    test('restorePersistedMounts re-creates a binding for the SAME workspace root', async () => {
        const persistence = makePersistence([
            { folderId: 'f1', ownerLabel: 'owner', permissionTier: 'smart', workspaceRoot: '/r1' },
        ]);
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TREE),
            clock: { nowMs: () => 1 },
            persistence,
        });
        const restored = await svc.restorePersistedMounts();
        assert.deepEqual(restored, ['f1']);
        assert.equal(svc.getMountForFolder('f1')?.permissionTier, 'smart');
        assert.equal(repo.calls.filter((c) => c.kind === 'register').length, 1);
    });

    test('restorePersistedMounts DROPS a binding whose root is not the open workspace', async () => {
        const persistence = makePersistence([
            {
                folderId: 'f1',
                ownerLabel: 'owner',
                permissionTier: 'smart',
                workspaceRoot: '/project-one',
            },
        ]);
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TREE),
            clock: { nowMs: () => 1 },
            persistence,
        });
        const restored = await svc.restorePersistedMounts();
        assert.deepEqual(restored, []);
        assert.equal(svc.getActiveMounts().length, 0);
        assert.equal(repo.calls.length, 0);
        assert.equal(persistence.current.length, 0);
    });

    test('reRegisterActiveMounts honours the skip set', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: makeTreeInput(TREE),
            clock: { nowMs: () => 1 },
        });
        await svc.registerMount('f1', 'owner', 'ask');
        const callsBefore = repo.calls.length;
        const refreshed = await svc.reRegisterActiveMounts(new Set(['f1']));
        assert.equal(refreshed, 0);
        assert.equal(repo.calls.length, callsBefore);
    });
});

describe('J1 multi-root — per-root tree input', () => {
    test('registerMount threads preferredRoot through to the tree-input provider', async () => {
        const seen: (string | undefined)[] = [];
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: makeRepo(),
            mountIds: makeMountIds(),
            treeInput: (folderId, preferredRoot) => {
                seen.push(preferredRoot);
                return Promise.resolve({
                    workspaceRoot: preferredRoot ?? '/default',
                    candidates: [`${preferredRoot ?? '/default'}/a.ts`],
                    statFn: FIXED_STAT_FN,
                });
            },
            clock: { nowMs: () => 1 },
        });
        const info = await svc.registerMount('f1', 'owner', 'ask', '/project-two');
        assert.deepEqual(seen, ['/project-two']);
        assert.equal(info.workspaceRoot, '/project-two');
        await svc.refreshTree('f1');
        assert.deepEqual(seen, ['/project-two', '/project-two']);
    });

    test('two mounts on different folders coexist with distinct roots', async () => {
        const repo = makeRepo();
        const svc = new WorkspaceMountService({
            logger: silentLogger() as unknown as never,
            repository: repo,
            mountIds: makeMountIds(),
            treeInput: (folderId, preferredRoot) =>
                Promise.resolve({
                    workspaceRoot: preferredRoot ?? `/auto/${folderId}`,
                    candidates: [`x.ts`],
                    statFn: FIXED_STAT_FN,
                }),
            clock: { nowMs: () => 1 },
        });
        await svc.registerMount('fA', 'Project A', 'ask', '/roots/a');
        await svc.registerMount('fB', 'Project B', 'smart', '/roots/b');
        assert.equal(svc.getActiveMounts().length, 2);
        assert.equal(svc.getMountForFolder('fA')?.workspaceRoot, '/roots/a');
        assert.equal(svc.getMountForFolder('fB')?.workspaceRoot, '/roots/b');
        assert.equal(repo.calls.filter((c) => c.kind === 'register').length, 2);
    });
});
