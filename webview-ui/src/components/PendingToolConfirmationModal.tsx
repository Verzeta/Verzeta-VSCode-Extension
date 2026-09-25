// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * PendingToolConfirmationModal — host-level modal triggered by
 * `tool_call.confirmation.requested`. Mirrors Android
 * `ToolConfirmationDialog.kt`:
 *
 *   ┌──────────────────────────────────────┐
 *   │  Tool Call Confirmation              │
 *   │  ────────────────────────────────    │
 *   │  The assistant wants to execute a    │
 *   │  tool. Review and approve?           │
 *   │                                      │
 *   │  Tool: file_search                   │
 *   │  ┌────────────────────────────────┐  │
 *   │  │ {                              │  │
 *   │  │   "pattern": "*.kt",           │  │
 *   │  │   "limit": 50                  │  │
 *   │  │ }                              │  │
 *   │  └────────────────────────────────┘  │
 *   │                                      │
 *   │                  [ Deny ] [ Approve ]│
 *   └──────────────────────────────────────┘
 *
 * Approve / Deny post the typed envelope back through the bus.
 * Modal dismisses optimistically on tap; the host's
 * `tool_call.completed` echo also clears any leftover state.
 */

import { send } from '../lib/bus.js';
import { dismissPendingToolCall, pendingToolCall } from '../state/toolCalls.js';

export function PendingToolConfirmationModal() {
    const current = pendingToolCall.value;
    if (current === null) return null;

    const onApprove = (): void => {
        send({
            type: 'tool_call.approveRequested',
            hostId: current.hostId,
            callId: current.pending.callId,
        });
        dismissPendingToolCall();
    };
    const onDeny = (): void => {
        send({
            type: 'tool_call.denyRequested',
            hostId: current.hostId,
            callId: current.pending.callId,
        });
        dismissPendingToolCall();
    };

    const attribution =
        current.pending.memberAlias.length > 0
            ? `@${current.pending.memberAlias}`
            : 'The assistant';

    return (
        <div
            class="verzeta-toolconfirm-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="verzeta-toolconfirm-title"
        >
            <div class="verzeta-toolconfirm">
                <div class="verzeta-toolconfirm__header">
                    <h2 id="verzeta-toolconfirm-title" class="verzeta-toolconfirm__title">
                        Tool Call Confirmation
                    </h2>
                </div>
                <div class="verzeta-toolconfirm__body">
                    <p class="verzeta-toolconfirm__subtitle">
                        {attribution} wants to run a tool. Review and approve before it executes.
                    </p>
                    <div class="verzeta-toolconfirm__field">
                        <span class="verzeta-toolconfirm__fieldLabel">Tool</span>
                        <code class="verzeta-toolconfirm__toolName">
                            {current.pending.toolName}
                        </code>
                    </div>
                    <div class="verzeta-toolconfirm__field">
                        <span class="verzeta-toolconfirm__fieldLabel">Arguments</span>
                        <pre class="verzeta-toolconfirm__args">
                            {current.pending.arguments.length > 0
                                ? current.pending.arguments
                                : '(no arguments)'}
                        </pre>
                    </div>
                    <p class="verzeta-toolconfirm__hint">
                        Approving will execute this tool and return the result to the assistant.
                    </p>
                </div>
                <div class="verzeta-toolconfirm__actions">
                    <button
                        type="button"
                        class="verzeta-toolconfirm__btn verzeta-toolconfirm__btn--secondary"
                        onClick={onDeny}
                    >
                        Deny
                    </button>
                    <button
                        type="button"
                        class="verzeta-toolconfirm__btn verzeta-toolconfirm__btn--primary"
                        onClick={onApprove}
                        autoFocus
                    >
                        Approve
                    </button>
                </div>
            </div>
        </div>
    );
}
