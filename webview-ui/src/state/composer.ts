// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Composer input state. Signals for the textarea draft, the
 * "sending" flag the Composer uses to swap Send/Stop buttons, the
 * pending-attachments queue (mirrors Android `pendingAttachments`
 * in MainUiState), and the last pick-rejection reason for inline
 * UX feedback.
 */

import { signal } from '@preact/signals';
import type { OutgoingAttachmentUi } from '../../../src/shared/wire-types.js';
import {
    MAX_ATTACHMENTS,
    MAX_CONTENT_BYTES,
    isSafeUploadFileName,
    unsafeFileNameMessage,
} from '../../../src/shared/wire-limits.js';

export { MAX_ATTACHMENTS, MAX_CONTENT_BYTES };

export const composerDraft = signal<string>('');
export const composerSending = signal<boolean>(false);
export const pendingAttachments = signal<readonly OutgoingAttachmentUi[]>([]);
export const attachmentPickError = signal<string | null>(null);

export function setComposerDraft(value: string): void {
    composerDraft.value = value;
}

export function clearComposerDraft(): void {
    composerDraft.value = '';
}

export function setSending(value: boolean): void {
    composerSending.value = value;
}

/**
 * Append a freshly-picked attachment after cap validation. Returns
 * a human-readable error string when a cap is exceeded; the caller
 * is expected to surface it via `attachmentPickError`.
 */
export function addPendingAttachment(attachment: OutgoingAttachmentUi): string | null {
    const current = pendingAttachments.value;
    if (current.length >= MAX_ATTACHMENTS) {
        return `Maximum ${MAX_ATTACHMENTS} attachments per message.`;
    }
    // The extension drops a whole send whose attachment name the host
    // would refuse, so refuse it here where the user can see why.
    if (!isSafeUploadFileName(attachment.fileName)) {
        return unsafeFileNameMessage(attachment.fileName);
    }
    if (attachment.rawBytes <= 0) {
        return `"${attachment.fileName}" is empty.`;
    }
    if (attachment.rawBytes > MAX_CONTENT_BYTES) {
        return `Attachment exceeds ${MAX_CONTENT_BYTES / (1024 * 1024)} MiB per-attachment cap.`;
    }
    const projectedTotal = current.reduce((s, a) => s + a.rawBytes, 0) + attachment.rawBytes;
    if (projectedTotal > MAX_CONTENT_BYTES) {
        return `Total attachments would exceed ${MAX_CONTENT_BYTES / (1024 * 1024)} MiB.`;
    }
    pendingAttachments.value = [...current, attachment];
    attachmentPickError.value = null;
    return null;
}

export function removePendingAttachment(index: number): void {
    const current = pendingAttachments.value;
    if (index < 0 || index >= current.length) return;
    pendingAttachments.value = current.filter((_, i) => i !== index);
}

export function clearPendingAttachments(): void {
    pendingAttachments.value = [];
    attachmentPickError.value = null;
}

export function setAttachmentPickError(reason: string | null): void {
    attachmentPickError.value = reason;
}
