// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ExecConsentBanner — noticeable strip at the top of the chat shown
 * when an agent tried to run a command in this conversation but command
 * execution is Off. Offers to enable Ask or Allow for this conversation
 * (the in-chat replacement for the old corner consent toast). Reuses
 * the workspace-share banner styling for visual consistency.
 */

import { activeConversationId } from '../state/conversations.js';
import { activeHostId } from '../state/hosts.js';
import { activeExecConsent, clearExecConsent } from '../state/execConsent.js';
import { send } from '../lib/bus.js';
import type { RemoteExecMode } from '../../../src/shared/webview-protocol.js';

export function ExecConsentBanner() {
    const banner = activeExecConsent.value;
    const hostId = activeHostId.value;
    const convId = activeConversationId.value;
    if (banner === undefined || hostId === undefined || convId === undefined) return null;

    const enable = (mode: RemoteExecMode): void => {
        send({ type: 'convExecMode.set', hostId, conversationId: convId, mode });
        clearExecConsent(convId);
    };

    return (
        <div class="verzeta-sharebanner" role="status">
            <span class="verzeta-sharebanner__icon" aria-hidden="true">
                ⚡
            </span>
            <span class="verzeta-sharebanner__text">
                An agent wanted to run a command here ({banner.commandPreview}). It ran on the host
                instead. Let agents run commands in this workspace?
            </span>
            <button
                type="button"
                class="verzeta-sharebanner__action"
                onClick={() => enable('ask')}
                title="Confirm every command before it runs"
            >
                Ask each time
            </button>
            <button
                type="button"
                class="verzeta-sharebanner__action"
                onClick={() => enable('allow')}
                title="Auto-run (still safety-filtered + sandboxed)"
            >
                Allow
            </button>
            <button
                type="button"
                class="verzeta-sharebanner__dismiss"
                onClick={() => clearExecConsent(convId)}
                aria-label="Dismiss"
                title="Dismiss"
            >
                ✕
            </button>
        </div>
    );
}
