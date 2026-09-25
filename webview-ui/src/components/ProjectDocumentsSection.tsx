// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ProjectDocumentsSection — surfaces the list of base64-uploaded
 * project documents attached to a folder, with Upload + Remove.
 * Mirrors Android `DocumentsSection`
 * (ui/folders/FolderEditorSheet.kt lines 399-498). Visible only in
 * edit mode in FolderCreateSheet.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Project documents              (2 files)             │
 *   │ Files travel as base64 within the shared content cap │
 *   │ (MAX_CONTENT_BYTES).                                  │
 *   │                                                      │
 *   │ ┌─ 📄 schema.md       12 KB                  [🗑]  │ │
 *   │ ┌─ 📄 plan.txt        4 KB                   [🗑]  │ │
 *   │                                                      │
 *   │ [ + Upload document ]                                │
 *   └──────────────────────────────────────────────────────┘
 *
 * Upload uses an `<input type="file">` (hidden) — the user picks
 * one file at a time, we read it as bytes via FileReader, encode
 * to base64 in 32 KiB chunks to avoid RangeError on large buffers,
 * and post `document.uploadRequested`. The host enforces the shared
 * content cap (kMaxContentBytes); client-side we reject sources larger
 * than MAX_CONTENT_BYTES, which base64-expands (~4/3) to within the
 * wire frame cap.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { documentsFor, type ProjectDocumentRow } from '../state/documents.js';
import { send } from '../lib/bus.js';
import { MAX_CONTENT_BYTES, isSafeUploadFileName } from '../../../src/shared/wire-limits.js';

// Documents stage through the same host path as attachments
// (wire-session.cpp::stageBase64Upload), so they share the one content
// cap. base64 (+~33%) of MAX_CONTENT_BYTES still fits the wire frame.
const SOURCE_MAX_BYTES = MAX_CONTENT_BYTES;

export function ProjectDocumentsSection({
    hostId,
    folderId,
}: {
    readonly hostId: string;
    readonly folderId: string;
}) {
    const documents = documentsFor(hostId, folderId);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [pickError, setPickError] = useState<string | null>(null);

    useEffect(() => {
        send({ type: 'documents.requested', hostId, folderId });
    }, [hostId, folderId]);

    const onChoose = (): void => {
        setPickError(null);
        inputRef.current?.click();
    };

    const onFile = async (event: Event): Promise<void> => {
        const target = event.currentTarget as HTMLInputElement;
        const file = target.files?.[0];
        target.value = '';
        if (file === undefined) return;
        if (file.size > SOURCE_MAX_BYTES) {
            setPickError(
                `File too large (${Math.round(file.size / (1024 * 1024))} MB; ` +
                    `${SOURCE_MAX_BYTES / (1024 * 1024)} MB max).`,
            );
            return;
        }
        if (file.size === 0) {
            // The host rejects an empty upload, so say so here.
            setPickError(`"${file.name}" is empty.`);
            return;
        }
        const name = file.name.trim();
        if (!isSafeUploadFileName(name)) {
            setPickError('Filename cannot contain /, \\, .. or start with .');
            return;
        }
        try {
            const contentBase64 = await toBase64(file);
            send({
                type: 'document.uploadRequested',
                hostId,
                folderId,
                fileName: name,
                contentBase64,
            });
        } catch (e) {
            setPickError(`Could not read file: ${String(e)}`);
        }
    };

    const onRemove = (fileName: string): void => {
        send({ type: 'document.removeRequested', hostId, folderId, fileName });
    };

    return (
        <section class="verzeta-sheet__section">
            <div class="verzeta-hb__header">
                <h3 class="verzeta-sheet__label">Project documents</h3>
                <span class="verzeta-hb__count">
                    {documents.length} {documents.length === 1 ? 'file' : 'files'}
                </span>
            </div>
            <p class="verzeta-sheet__detail">
                Files count toward the shared content cap. The assistant can read them in this
                project's conversations.
            </p>
            {pickError !== null ? <div class="verzeta-docs__error">{pickError}</div> : null}
            {documents.length === 0 ? (
                <div class="verzeta-hb__empty">
                    No documents yet. Click "Upload document" to add one.
                </div>
            ) : (
                <ul class="verzeta-docs__list" role="list">
                    {documents.map((doc) => (
                        <DocumentRow key={doc.name} doc={doc} onRemove={() => onRemove(doc.name)} />
                    ))}
                </ul>
            )}
            <input
                ref={inputRef}
                type="file"
                hidden
                onChange={(e) => {
                    void onFile(e);
                }}
            />
            <button type="button" class="verzeta-team__addBtn" onClick={onChoose}>
                + Upload document
            </button>
        </section>
    );
}

function DocumentRow({
    doc,
    onRemove,
}: {
    readonly doc: ProjectDocumentRow;
    readonly onRemove: () => void;
}) {
    return (
        <li class="verzeta-docs__row">
            <span class="verzeta-docs__icon" aria-hidden="true">
                <FileIcon />
            </span>
            <span class="verzeta-docs__body">
                <span class="verzeta-docs__name">{doc.name}</span>
                <span class="verzeta-docs__size">{formatBytes(doc.size)}</span>
            </span>
            <button
                type="button"
                class="verzeta-hb__iconBtn verzeta-hb__iconBtn--danger"
                onClick={onRemove}
                aria-label="Remove document"
                title="Remove document"
            >
                <TrashIcon />
            </button>
        </li>
    );
}

function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function toBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 32 * 1024;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function FileIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
            <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}
