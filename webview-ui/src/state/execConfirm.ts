// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Pending Ask-mode command confirmation, fed by the extension's
 * `exec.confirmRequested` envelope. Drives the chat-area confirmation
 * modal (ExecConfirmModal) — the in-extension replacement for the
 * native VS Code confirm dialog. One confirmation is shown at a time;
 * the host blocks the command's worker until the user answers.
 */

import { signal } from '@preact/signals';

export interface PendingExecConfirm {
    readonly hostId: string;
    readonly conversationId: string;
    readonly requestId: string;
    readonly command: string;
    readonly sandboxed: boolean;
}

export const pendingExecConfirm = signal<PendingExecConfirm | null>(null);

/** Show a confirmation request (replacing any older pending one). */
export function setPendingExecConfirm(entry: PendingExecConfirm): void {
    pendingExecConfirm.value = entry;
}

/** Clear the active confirmation (after the user answers). */
export function clearPendingExecConfirm(): void {
    pendingExecConfirm.value = null;
}
