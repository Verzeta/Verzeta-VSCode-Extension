// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Wire size caps — the SINGLE source of truth for both the extension
 * host and the webview. These mirror the host's two constants in
 * `backend/remote/wire-protocol.h`; the two sides must agree, so this is
 * the only place either bundle states a size limit.
 *
 * - `MAX_WIRE_FRAME_BYTES` mirrors the host `kMaxWireFrameBytes`: the
 *   encoded size of one frame on the socket. `RemoteSession.send` rejects
 *   any envelope larger than this with a clear message rather than
 *   letting the WebSocket silently drop the connection.
 * - `MAX_CONTENT_BYTES` mirrors the host `kMaxContentBytes`: the decoded
 *   size of one user payload — a single attachment or document file. It
 *   bounds both a single attachment and a message's attachment total, and
 *   it sits below the frame cap so base64 (+~33%) plus the JSON envelope
 *   still fits one frame.
 * - `MAX_ATTACHMENTS` is the most attachments allowed on one message.
 */
export const MAX_WIRE_FRAME_BYTES = 24 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;

/**
 * Whether a file name is accepted for an attachment or project document.
 * Mirrors the host's `isSafeFileName`: non-empty, no `/` or `\`, no `..`,
 * and no leading `.`. The host rejects any other name, and the extension
 * drops the whole message rather than send one it knows will fail, so
 * every staging path checks this first.
 *
 * @param name the bare file name.
 * @returns true when the host will accept the name.
 */
export function isSafeUploadFileName(name: string): boolean {
    return (
        name.length > 0 &&
        !name.includes('/') &&
        !name.includes('\\') &&
        !name.includes('..') &&
        !name.startsWith('.')
    );
}

/** User-facing reason shown when `isSafeUploadFileName` rejects a name. */
export function unsafeFileNameMessage(name: string): string {
    return `"${name}" can't be sent. File names can't start with a dot or contain /, \\ or "..".`;
}
