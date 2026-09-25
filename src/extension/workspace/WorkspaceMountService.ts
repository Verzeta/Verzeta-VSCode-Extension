// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { DisposableStore, type Disposable } from '../infra/disposables.js';
import { TypedEventEmitter } from '../infra/TypedEventEmitter.js';
import type { Logger } from '../log/Logger.js';
import type {
    PermissionTier,
    WorkspaceMountInfoUi,
    WorkspaceTreeManifest,
} from '../../shared/wire-types.js';
import {
    buildWorkspaceTree,
    serializeTreeManifest,
    type BuildTreeOptions,
} from './WorkspaceTreeBuilder.js';

/**
 * Event surface for downstream subscribers (status bar, webview
 * sync, future telemetry). Three events cover the full lifecycle:
 *
 *   - mountAdded     after registerMount succeeds
 *   - mountRemoved   after unregisterMount succeeds (or on dispose)
 *   - mountChanged   after setTier / refreshTree alters the snapshot
 *
 * Subscribers receive a fresh snapshot in the event payload — they
 * MUST NOT mutate the registry through it; the underlying record
 * is detached.
 */
interface WorkspaceMountEvents extends Record<string, readonly unknown[]> {
    readonly mountAdded: readonly [info: WorkspaceMountInfoUi];
    readonly mountRemoved: readonly [folderId: string];
    readonly mountChanged: readonly [info: WorkspaceMountInfoUi];
}

/**
 * Minimal surface the service needs against the wire repository.
 * Backed by `RemoteRepository` in production; tests pass a stub.
 */
export interface MountRepository {
    registerWorkspaceMount(params: {
        readonly folderId: string;
        readonly mountId: string;
        readonly ownerLabel: string;
        readonly treeJson: string;
        readonly permissionTier?: PermissionTier | undefined;
    }): Promise<void>;
    unregisterWorkspaceMount(folderId: string): Promise<void>;
    updateWorkspaceMountTree(folderId: string, treeJson: string): Promise<void>;
    updateWorkspaceMountTier(folderId: string, tier: PermissionTier): Promise<void>;
}

/**
 * Per-folder tree input. The caller (the extension.ts composition
 * root) provides this when registering or refreshing — the service
 * itself does not import vscode, so the production composition
 * builds the candidate list via `vscode.workspace.findFiles` and
 * the stat function via `vscode.workspace.fs.stat`.
 */
export type TreeInputProvider = (
    folderId: string,
    preferredRoot?: string,
) => Promise<TreeInputBundle | undefined>;

export interface TreeInputBundle {
    readonly workspaceRoot: string;
    readonly candidates: readonly string[];
    readonly statFn: BuildTreeOptions['statFn'];
    readonly additionalIgnores?: readonly string[] | undefined;
}

export interface MountIdProvider {
    /**
     * Returns the stable mount UUID for `folderId`. Production
     * implementation persists in `workspaceState`; tests pass a
     * map-backed stub. The same id MUST be returned across
     * extension restarts so reconnect-after-disconnect on the host
     * is a refresh, not a replace.
     */
    getOrCreateMountId(folderId: string): string;
    /** Drops the persisted id for `folderId`. Called on unregister. */
    clearMountId(folderId: string): void;
}

export interface ClockSource {
    nowMs(): number;
}

export const SYSTEM_CLOCK: ClockSource = {
    nowMs: () => Date.now(),
};

export interface WorkspaceMountServiceOptions {
    readonly logger: Logger;
    readonly repository: MountRepository;
    readonly mountIds: MountIdProvider;
    readonly treeInput: TreeInputProvider;
    readonly clock?: ClockSource | undefined;
    readonly persistence?: MountPersistence | undefined;
}

/**
 * One persisted mount binding — just enough to re-create the mount
 * after a VS Code restart. The manifest is rebuilt fresh on restore;
 * the mountId comes back from MountIdProvider's own persistence.
 */
export interface PersistedMountBinding {
    readonly folderId: string;
    readonly ownerLabel: string;
    readonly permissionTier: PermissionTier;
    /**
     * The absolute workspace root the mount was registered against.
     * Restore double-checks it against the CURRENTLY open workspace
     * and drops the binding on mismatch — workspaceState is already
     * per-workspace, but this guard makes "never mount the wrong
     * workspace" a property of the data, not just of the storage.
     */
    readonly workspaceRoot: string;
}

/**
 * Storage seam for mount bindings (production:
 * ExtensionContext.workspaceState — per-workspace by construction,
 * so a different workspace never restores another workspace's
 * mounts). save() receives the FULL current binding list on every
 * register/unregister; load() returns what the last save wrote.
 */
export interface MountPersistence {
    load(): readonly PersistedMountBinding[];
    save(bindings: readonly PersistedMountBinding[]): void;
}

/**
 * Live mount entry in the local registry.
 */
interface ActiveMount {
    readonly folderId: string;
    readonly mountId: string;
    readonly ownerLabel: string;
    readonly workspaceRoot: string;
    permissionTier: PermissionTier;
    registeredAtMs: number;
    lastManifestJson: string;
    lastManifestFiles: number;
}

export class WorkspaceMountService
    extends TypedEventEmitter<WorkspaceMountEvents>
    implements Disposable
{
    private readonly logger: Logger;
    private readonly repository: MountRepository;
    private readonly mountIds: MountIdProvider;
    private readonly treeInput: TreeInputProvider;
    private readonly clock: ClockSource;
    private readonly persistence: MountPersistence | undefined;
    private readonly mounts = new Map<string, ActiveMount>();
    private readonly inFlight = new Set<string>();
    private readonly subs = new DisposableStore();
    private disposed = false;

    constructor(options: WorkspaceMountServiceOptions) {
        super();
        this.logger = options.logger;
        this.repository = options.repository;
        this.mountIds = options.mountIds;
        this.treeInput = options.treeInput;
        this.clock = options.clock ?? SYSTEM_CLOCK;
        this.persistence = options.persistence;
    }

    /** Write the current binding list through the persistence seam. */
    private persistBindings(): void {
        if (this.persistence === undefined) return;
        this.persistence.save(
            this.getActiveMounts().map((m) => ({
                folderId: m.folderId,
                ownerLabel: m.ownerLabel,
                permissionTier: m.permissionTier,
                workspaceRoot: m.workspaceRoot,
            })),
        );
    }

    /**
     * Re-create every persisted mount binding that is not already
     * active — the VS Code-restart counterpart of
     * reRegisterActiveMounts (which only refreshes what this process
     * already registered). Failures log and skip; the binding stays
     * persisted so the next (re)connect retries.
     *
     * @returns the folderIds that were restored this call.
     */
    async restorePersistedMounts(): Promise<readonly string[]> {
        if (this.persistence === undefined) return [];
        const restored: string[] = [];
        let dropped = false;
        for (const b of this.persistence.load()) {
            if (this.mounts.has(b.folderId)) continue;
            try {
                // Wrong-workspace guard: the binding remembers which
                // root it was registered against. If the currently
                // open workspace resolves to a different root, the
                // binding belongs to another project — drop it, never
                // mount it.
                const input = await this.treeInput(b.folderId, b.workspaceRoot);
                if (input === undefined || input.workspaceRoot !== b.workspaceRoot) {
                    this.logger.warn(
                        'workspace-mount: persisted binding is for another workspace — dropped',
                        {
                            folderId: b.folderId,
                            boundRoot: b.workspaceRoot,
                            currentRoot: input?.workspaceRoot ?? '(none)',
                        },
                    );
                    dropped = true;
                    continue;
                }
                await this.registerMount(
                    b.folderId,
                    b.ownerLabel,
                    b.permissionTier,
                    b.workspaceRoot,
                );
                restored.push(b.folderId);
            } catch (error) {
                this.logger.warn('workspace-mount: persisted-mount restore failed', {
                    folderId: b.folderId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (dropped) this.persistBindings();
        return restored;
    }

    /**
     * Registers a fresh mount for `folderId`. Idempotent on
     * `mountId` — a re-register against the same folder uses the
     * persisted mount UUID so the host treats it as a refresh,
     * not a replace. Throws if a concurrent register/unregister
     * is already in flight for the same folder.
     */
    async registerMount(
        folderId: string,
        ownerLabel: string,
        tier: PermissionTier,
        preferredRoot?: string,
    ): Promise<WorkspaceMountInfoUi> {
        this.ensureLive();
        if (this.inFlight.has(folderId)) {
            throw new Error(
                `WorkspaceMountService: mount lifecycle already in flight for folder '${folderId}'`,
            );
        }
        this.inFlight.add(folderId);
        try {
            const input = await this.treeInput(folderId, preferredRoot);
            if (input === undefined) {
                throw new Error(
                    `WorkspaceMountService: no workspace folder resolved for '${folderId}'`,
                );
            }
            const { manifest, manifestJson } = this.buildAndSerialise(input);
            const mountId = this.mountIds.getOrCreateMountId(folderId);

            await this.repository.registerWorkspaceMount({
                folderId,
                mountId,
                ownerLabel,
                treeJson: manifestJson,
                permissionTier: tier,
            });

            const registeredAtMs = this.clock.nowMs();
            const active: ActiveMount = {
                folderId,
                mountId,
                ownerLabel,
                workspaceRoot: input.workspaceRoot,
                permissionTier: tier,
                registeredAtMs,
                lastManifestJson: manifestJson,
                lastManifestFiles: manifest.files.length,
            };
            this.mounts.set(folderId, active);
            this.logger.info('workspace-mount: registered', {
                folderId,
                mountId,
                ownerLabel,
                tier,
                fileCount: manifest.files.length,
            });
            const snap = snapshot(active);
            this.persistBindings();
            this.emit('mountAdded', snap);
            return snap;
        } finally {
            this.inFlight.delete(folderId);
        }
    }

    async reRegisterActiveMounts(skip?: ReadonlySet<string>): Promise<number> {
        let count = 0;
        for (const m of this.getActiveMounts()) {
            if (skip?.has(m.folderId) === true) continue;
            try {
                await this.registerMount(
                    m.folderId,
                    m.ownerLabel,
                    m.permissionTier,
                    m.workspaceRoot,
                );
                count++;
            } catch (error) {
                this.logger.warn('workspace-mount: re-register failed on reconnect', {
                    folderId: m.folderId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return count;
    }

    /**
     * Releases every active mount. Used when the workspace folder
     * set changes — the manifests describe a workspace that no
     * longer exists, so the mounts must not survive the switch.
     * Per-mount failures are logged and skipped.
     */
    async unregisterAllMounts(): Promise<void> {
        for (const m of this.getActiveMounts()) {
            try {
                await this.unregisterMount(m.folderId);
            } catch (error) {
                this.logger.warn('workspace-mount: unregister-all failed for folder', {
                    folderId: m.folderId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    /**
     * Releases the mount for `folderId`. No-op if the folder has
     * no active mount. Clears the persisted mount-id so the next
     * register starts fresh (i.e. produces a different mountId).
     */
    async unregisterMount(folderId: string): Promise<void> {
        this.ensureLive();
        if (this.inFlight.has(folderId)) {
            throw new Error(
                `WorkspaceMountService: mount lifecycle already in flight for folder '${folderId}'`,
            );
        }
        const active = this.mounts.get(folderId);
        if (active === undefined) return;
        this.inFlight.add(folderId);
        try {
            await this.repository.unregisterWorkspaceMount(folderId);
            this.mounts.delete(folderId);
            this.mountIds.clearMountId(folderId);
            this.logger.info('workspace-mount: unregistered', {
                folderId,
                mountId: active.mountId,
            });
            this.persistBindings();
            this.emit('mountRemoved', folderId);
        } finally {
            this.inFlight.delete(folderId);
        }
    }

    /**
     * Re-walks the depth-1 listing and pushes a fresh manifest IFF
     * it differs from the last-sent one (stable string compare).
     * No-op when the byte-identical manifest would be a wasted
     * wire frame. Returns whether a wire push actually fired.
     */
    async refreshTree(folderId: string): Promise<boolean> {
        this.ensureLive();
        const active = this.mounts.get(folderId);
        if (active === undefined) return false;
        const input = await this.treeInput(folderId, active.workspaceRoot);
        if (input === undefined) return false;
        const { manifest, manifestJson } = this.buildAndSerialise(input);
        if (manifestJson === active.lastManifestJson) {
            this.logger.debug('workspace-mount: refresh skipped (no diff)', { folderId });
            return false;
        }
        await this.repository.updateWorkspaceMountTree(folderId, manifestJson);
        active.lastManifestJson = manifestJson;
        active.lastManifestFiles = manifest.files.length;
        this.logger.info('workspace-mount: tree refreshed', {
            folderId,
            mountId: active.mountId,
            fileCount: manifest.files.length,
        });
        this.emit('mountChanged', snapshot(active));
        return true;
    }

    /**
     * Change the permission tier for `folderId` on the host and here.
     * The host is updated first, so a refusal leaves both sides on the
     * old tier. No-op when the folder has no mount or the tier is
     * unchanged.
     *
     * @throws when the host refuses the change or is not connected.
     */
    async changeTier(folderId: string, tier: PermissionTier): Promise<void> {
        this.ensureLive();
        const active = this.mounts.get(folderId);
        if (active === undefined || active.permissionTier === tier) return;
        await this.repository.updateWorkspaceMountTier(folderId, tier);
        this.setTier(folderId, tier);
    }

    /**
     * Updates the local permission-tier record for `folderId` only.
     * `changeTier` calls this after the host accepted the change.
     */
    setTier(folderId: string, tier: PermissionTier): void {
        this.ensureLive();
        const active = this.mounts.get(folderId);
        if (active === undefined) return;
        if (active.permissionTier === tier) return;
        active.permissionTier = tier;
        this.logger.info('workspace-mount: tier changed locally', {
            folderId,
            mountId: active.mountId,
            tier,
        });
        this.persistBindings();
        this.emit('mountChanged', snapshot(active));
    }

    /**
     * Snapshot of every currently-active mount. Returned as a
     * readonly array so callers cannot mutate the registry through
     * the result. Order is insertion order per Map semantics.
     */
    getActiveMounts(): readonly WorkspaceMountInfoUi[] {
        return Array.from(this.mounts.values()).map(snapshot);
    }

    getMountForFolder(folderId: string): WorkspaceMountInfoUi | undefined {
        const active = this.mounts.get(folderId);
        return active === undefined ? undefined : snapshot(active);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.subs.dispose();
        this.mounts.clear();
        this.inFlight.clear();
    }

    private buildAndSerialise(input: TreeInputBundle): {
        readonly manifest: WorkspaceTreeManifest;
        readonly manifestJson: string;
    } {
        const result = buildWorkspaceTree({
            workspaceRoot: input.workspaceRoot,
            candidates: input.candidates,
            statFn: input.statFn,
            additionalIgnores: input.additionalIgnores,
        });
        return {
            manifest: result.manifest,
            manifestJson: serializeTreeManifest(result.manifest),
        };
    }

    private ensureLive(): void {
        if (this.disposed) {
            throw new Error('WorkspaceMountService: already disposed');
        }
    }
}

function snapshot(active: ActiveMount): WorkspaceMountInfoUi {
    return {
        folderId: active.folderId,
        mountId: active.mountId,
        ownerLabel: active.ownerLabel,
        permissionTier: active.permissionTier,
        workspaceRoot: active.workspaceRoot,
        registeredAtMs: active.registeredAtMs,
        fileCount: active.lastManifestFiles,
    };
}
