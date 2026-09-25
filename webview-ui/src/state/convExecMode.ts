// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-conversation remote command-execution mode (vfs.execute
 * Off / Ask / Allow), fed by the extension's `convExecMode.updated`
 * envelope. Client-local — the value lives in the extension's
 * workspaceState, never on the host. Drives the command-execution
 * control in the Conversation Settings sheet.
 */

import { computed, signal } from '@preact/signals';
import type { RemoteExecMode } from '../../../src/shared/webview-protocol.js';
import { activeConversationId } from './conversations.js';

const modes = signal<ReadonlyMap<string, RemoteExecMode>>(new Map());

/** Record the mode pushed for one conversation. */
export function setConvExecMode(conversationId: string, mode: RemoteExecMode): void {
    const next = new Map(modes.value);
    next.set(conversationId, mode);
    modes.value = next;
}

/** Mode for a specific conversation; undefined until the host replies. */
export function convExecModeFor(conversationId: string): RemoteExecMode | undefined {
    return modes.value.get(conversationId);
}

/** Mode for the active conversation; undefined until the host replies. */
export const activeConvExecMode = computed<RemoteExecMode | undefined>(() => {
    const id = activeConversationId.value;
    if (id === undefined) return undefined;
    return modes.value.get(id);
});
