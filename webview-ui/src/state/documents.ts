// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-folder project-documents cache. Populated by
 * `documents.updated` envelopes. Each row carries a host-side
 * filename + size in bytes — the host returns more fields
 * (uploadedAt, mimeType) that aren't currently consumed by the
 * extension UI; future surfaces extend the shape.
 */

import { signal } from '@preact/signals';

export interface ProjectDocumentRow {
    readonly name: string;
    readonly size: number;
}

function key(hostId: string, folderId: string): string {
    return `${hostId}::${folderId}`;
}

const map = signal<ReadonlyMap<string, readonly ProjectDocumentRow[]>>(new Map());

export function documentsFor(hostId: string, folderId: string): readonly ProjectDocumentRow[] {
    return map.value.get(key(hostId, folderId)) ?? [];
}

export function setDocuments(
    hostId: string,
    folderId: string,
    documents: readonly ProjectDocumentRow[],
): void {
    const next = new Map(map.value);
    next.set(key(hostId, folderId), documents);
    map.value = next;
}
