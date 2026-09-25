// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * EditorBridge — pure helpers that translate VS Code editor + URI
 * primitives into payloads the webview already knows how to render.
 * Kept side-effect-free so command handlers stay thin: they call
 * one function, hand the result off to the webview provider, and
 * surface any error via vscode.window.show*Message.
 *
 * The "selection -> composer text" path renders as a fenced
 * markdown block prefixed by a `From <path> (lines N-M):` header —
 * the user sees the snippet in the composer draft and can edit
 * before sending.
 *
 * The "file -> attachment" path builds an OutgoingAttachmentUi-shaped
 * payload (the same struct the existing composer attach-button uses)
 * so the chip UI, cap enforcement, and msg.send_with_attachments
 * wire op all work without any new infrastructure.
 *
 * Layer: IDE / Editor bridge — depends only on `vscode`. Has no
 * coupling to the wire layer or the webview bus; the caller
 * orchestrates those.
 */

import * as vscode from 'vscode';

/** Hard cap on a single attachment's raw byte size. Mirrors the
 *  webview-side cap in `state/composer.ts` so the host re-validation
 *  passes. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface StagedAttachment {
    readonly fileName: string;
    readonly mimeType: string;
    readonly rawBytes: number;
    readonly contentBase64: string;
}

export interface SelectionInsert {
    /** Composer text to append (already markdown-formatted). */
    readonly composerText: string;
}

/**
 * Build a composer-insert payload from the active editor's
 * selection. Returns `undefined` when there is no active editor or
 * the selection is empty (the command surfaces a friendly error in
 * that case).
 *
 * Format:
 *
 *     From `relative/path.ts` (lines 12-34):
 *     ```typescript
 *     <selected text>
 *     ```
 *
 * The language tag is sourced from the document's `languageId` so
 * fenced-code highlighting picks the right grammar. Lines are
 * one-based to match VS Code's status bar.
 */
export function buildSelectionInsert(editor: vscode.TextEditor): SelectionInsert | undefined {
    const selection = editor.selection;
    if (selection.isEmpty) return undefined;
    const text = editor.document.getText(selection);
    if (text.length === 0) return undefined;
    const path = workspaceRelativePath(editor.document.uri);
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    const languageTag = editor.document.languageId;
    const range = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;
    const header = `From \`${path}\` (${range}):`;
    const body = '```' + languageTag + '\n' + text + '\n```';
    return { composerText: `${header}\n${body}` };
}

/**
 * Build an attachment payload from a vscode.Uri pointing at a file.
 * Returns a discriminated result so the caller can show a specific
 * error message (oversize / unreadable / etc) rather than a generic
 * "failed".
 */
export type LoadFileResult =
    | { readonly kind: 'ok'; readonly attachment: StagedAttachment }
    | { readonly kind: 'too_large'; readonly bytes: number }
    | { readonly kind: 'unreadable'; readonly reason: string };

export async function loadFileAttachment(uri: vscode.Uri): Promise<LoadFileResult> {
    let stat: vscode.FileStat;
    try {
        stat = await vscode.workspace.fs.stat(uri);
    } catch (error: unknown) {
        return { kind: 'unreadable', reason: errorText(error) };
    }
    if (stat.type === vscode.FileType.Directory) {
        return {
            kind: 'unreadable',
            reason: 'Directories cannot be attached. Pick a file instead.',
        };
    }
    if (stat.size > MAX_FILE_BYTES) {
        return { kind: 'too_large', bytes: stat.size };
    }
    let bytes: Uint8Array;
    try {
        bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error: unknown) {
        return { kind: 'unreadable', reason: errorText(error) };
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
        return { kind: 'too_large', bytes: bytes.byteLength };
    }
    const fileName = posixBasename(uri);
    const mimeType = guessMimeType(fileName);
    const contentBase64 = base64Of(bytes);
    return {
        kind: 'ok',
        attachment: {
            fileName,
            mimeType,
            rawBytes: bytes.byteLength,
            contentBase64,
        },
    };
}

/**
 * Build an attachment from an arbitrary in-memory text blob (used
 * by the canvas-export path and similar synthetic flows). The
 * caller picks the filename + mime type explicitly.
 */
export function buildTextAttachment(
    fileName: string,
    mimeType: string,
    text: string,
): StagedAttachment {
    const bytes = new TextEncoder().encode(text);
    return {
        fileName,
        mimeType,
        rawBytes: bytes.byteLength,
        contentBase64: base64Of(bytes),
    };
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

/**
 * Compute a workspace-relative posix path for display. Falls back
 * to the URI's basename when the file lives outside any open
 * workspace folder (matches VS Code status-bar behaviour).
 */
export function workspaceRelativePath(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder === undefined) return posixBasename(uri);
    const folderPath = folder.uri.path;
    const filePath = uri.path;
    if (filePath.startsWith(folderPath + '/')) {
        return filePath.slice(folderPath.length + 1);
    }
    return posixBasename(uri);
}

function posixBasename(uri: vscode.Uri): string {
    const segments = uri.path.split('/').filter((s) => s.length > 0);
    const last = segments[segments.length - 1];
    return last !== undefined ? last : 'file';
}

/**
 * Map a filename extension to a best-effort MIME type. Used only as
 * a hint for the host — content is the source of truth. Defaults
 * to text/plain for unknown extensions.
 */
function guessMimeType(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    if (dot < 0) return 'text/plain';
    const ext = fileName.slice(dot + 1).toLowerCase();
    switch (ext) {
        case 'ts':
        case 'tsx':
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
            return 'text/javascript';
        case 'py':
            return 'text/x-python';
        case 'rs':
            return 'text/rust';
        case 'go':
            return 'text/go';
        case 'java':
            return 'text/x-java';
        case 'kt':
        case 'kts':
            return 'text/x-kotlin';
        case 'cpp':
        case 'cc':
        case 'cxx':
        case 'hpp':
        case 'h':
        case 'c':
            return 'text/x-c';
        case 'cs':
            return 'text/x-csharp';
        case 'rb':
            return 'text/x-ruby';
        case 'sh':
        case 'bash':
        case 'zsh':
            return 'text/x-shellscript';
        case 'json':
            return 'application/json';
        case 'yaml':
        case 'yml':
            return 'application/x-yaml';
        case 'toml':
            return 'application/toml';
        case 'xml':
            return 'application/xml';
        case 'html':
        case 'htm':
            return 'text/html';
        case 'css':
            return 'text/css';
        case 'md':
        case 'markdown':
            return 'text/markdown';
        case 'sql':
            return 'application/sql';
        case 'png':
            return 'image/png';
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'gif':
            return 'image/gif';
        case 'webp':
            return 'image/webp';
        case 'svg':
            return 'image/svg+xml';
        case 'pdf':
            return 'application/pdf';
        default:
            return 'text/plain';
    }
}

function base64Of(bytes: Uint8Array): string {
    // Node ≥18 has Buffer.from(bytes).toString('base64') which is
    // significantly faster than JS chunked-string encoding on large
    // attachments. The extension host always runs under Node so we
    // can rely on it.
    return Buffer.from(bytes).toString('base64');
}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
}
