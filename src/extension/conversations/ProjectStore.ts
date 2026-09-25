// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { Disposable } from '../infra/disposables.js';
import { TypedEventEmitter } from '../infra/TypedEventEmitter.js';
import type { Logger } from '../log/Logger.js';
import type { FolderUi, MemberUi } from '../../shared/wire-types.js';

interface ProjectStoreEvents extends Record<string, readonly unknown[]> {
    readonly foldersChanged: readonly [hostId: string];
    readonly membersChanged: readonly [hostId: string, folderId: string];
}

export class ProjectStore extends TypedEventEmitter<ProjectStoreEvents> implements Disposable {
    private readonly logger: Logger;
    private readonly folders = new Map<string, FolderUi[]>();
    private readonly members = new Map<string, MemberUi[]>();

    constructor(logger: Logger) {
        super();
        this.logger = logger;
    }

    foldersByHost(hostId: string): readonly FolderUi[] {
        return this.folders.get(hostId) ?? [];
    }

    findFolder(hostId: string, folderId: string): FolderUi | undefined {
        return this.foldersByHost(hostId).find((f) => f.id === folderId);
    }

    replaceFolders(hostId: string, folders: readonly FolderUi[]): void {
        this.folders.set(hostId, [...folders]);
        this.logger.debug('folders replaced', { hostId, count: folders.length });
        this.emit('foldersChanged', hostId);
    }

    upsertFolder(hostId: string, folder: FolderUi): void {
        const current = this.folders.get(hostId) ?? [];
        const idx = current.findIndex((f) => f.id === folder.id);
        if (idx === -1) {
            current.push(folder);
        } else {
            current[idx] = folder;
        }
        this.folders.set(hostId, current);
        this.emit('foldersChanged', hostId);
    }

    removeFolder(hostId: string, folderId: string): void {
        const current = this.folders.get(hostId) ?? [];
        const filtered = current.filter((f) => f.id !== folderId);
        if (filtered.length === current.length) return;
        this.folders.set(hostId, filtered);
        const memberPrefix = this.memberKey(hostId, folderId);
        this.members.delete(memberPrefix);
        this.emit('foldersChanged', hostId);
    }

    membersOf(hostId: string, folderId: string): readonly MemberUi[] {
        return this.members.get(this.memberKey(hostId, folderId)) ?? [];
    }

    replaceMembers(hostId: string, folderId: string, members: readonly MemberUi[]): void {
        this.members.set(this.memberKey(hostId, folderId), [...members]);
        this.emit('membersChanged', hostId, folderId);
    }

    clearHost(hostId: string): void {
        let touched = this.folders.delete(hostId);
        const prefix = `${hostId}::`;
        for (const key of [...this.members.keys()]) {
            if (key.startsWith(prefix)) {
                this.members.delete(key);
                touched = true;
            }
        }
        if (touched) {
            this.emit('foldersChanged', hostId);
        }
    }

    dispose(): void {
        this.folders.clear();
        this.members.clear();
        this.removeAllListeners();
    }

    private memberKey(hostId: string, folderId: string): string {
        return `${hostId}::${folderId}`;
    }
}
