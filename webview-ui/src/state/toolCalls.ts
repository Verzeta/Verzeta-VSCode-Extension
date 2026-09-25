// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Pending tool-call confirmation state. Mirrors Android
 * `MainUiState.pendingToolConfirmation` (one slot — host serialises
 * confirmations). Surfaced as a host-level modal in App.tsx so it's
 * visible regardless of which conversation is foregrounded.
 *
 * Lifecycle:
 *   - Host emits `tool_call.requested` → WireSync forwards via
 *     ConnectionManager → WebviewSync pushes
 *     `tool_call.confirmation.requested` → `setPendingToolCall`.
 *   - User taps Approve / Deny → modal posts
 *     `tool_call.approveRequested` / `denyRequested` back.
 *   - Host echoes `tool_call.completed` → `clearPendingToolCall` if
 *     the callId matches. Modal also clears optimistically on tap.
 */

import { signal } from '@preact/signals';
import type { PendingToolConfirmationUi } from '../../../src/shared/wire-types.js';

interface PendingState {
    readonly hostId: string;
    readonly pending: PendingToolConfirmationUi;
}

export const pendingToolCall = signal<PendingState | null>(null);

export function setPendingToolCall(hostId: string, pending: PendingToolConfirmationUi): void {
    pendingToolCall.value = { hostId, pending };
}

export function clearPendingToolCall(callId: string): void {
    const current = pendingToolCall.value;
    if (current === null) return;
    if (current.pending.callId !== callId) return;
    pendingToolCall.value = null;
}

export function dismissPendingToolCall(): void {
    pendingToolCall.value = null;
}
