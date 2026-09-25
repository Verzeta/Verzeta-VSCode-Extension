// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * WorkspaceShareBanner — noticeable strip at the top of the chat
 * telling the user the open workspace is not shared with this
 * conversation (agents cannot read or edit files), with a one-click
 * Share action. Stays visible until shared or explicitly dismissed;
 * 'mismatched' covers the trap where a mount exists but is bound to
 * a different conversation's folder.
 */

import { activeConversationId } from '../state/conversations.js';
import { activeHostId } from '../state/hosts.js';
import { activeShareBanner, dismissShareBanner } from '../state/shareStatus.js';
import { send } from '../lib/bus.js';

export function WorkspaceShareBanner() {
    const banner = activeShareBanner.value;
    const hostId = activeHostId.value;
    const convId = activeConversationId.value;
    if (banner === undefined || hostId === undefined || convId === undefined) return null;

    const name =
        banner.workspaceName.length > 0 ? `Workspace "${banner.workspaceName}"` : 'This workspace';
    const text =
        banner.status === 'mismatched'
            ? `${name} is shared with a different chat. Agents here can't read or edit your files.`
            : `${name} isn't shared with this chat. Agents can't read or edit your files.`;
    const action = banner.status === 'mismatched' ? 'Share with this chat' : 'Share workspace';

    return (
        <div class="verzeta-sharebanner" role="status">
            <span class="verzeta-sharebanner__icon" aria-hidden="true">
                ⚠
            </span>
            <span class="verzeta-sharebanner__text">{text}</span>
            <button
                type="button"
                class="verzeta-sharebanner__action"
                onClick={() =>
                    send({ type: 'workspace.shareRequested', hostId, conversationId: convId })
                }
            >
                {action}
            </button>
            <button
                type="button"
                class="verzeta-sharebanner__dismiss"
                onClick={() => dismissShareBanner(convId)}
                aria-label="Dismiss"
                title="Dismiss"
            >
                ✕
            </button>
        </div>
    );
}
