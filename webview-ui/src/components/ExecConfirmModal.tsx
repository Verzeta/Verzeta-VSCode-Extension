// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { send } from '../lib/bus.js';
import { clearPendingExecConfirm, pendingExecConfirm } from '../state/execConfirm.js';

export function ExecConfirmModal() {
    const current = pendingExecConfirm.value;
    if (current === null) return null;

    const answer = (approved: boolean): void => {
        send({
            type: 'exec.confirmResponse',
            hostId: current.hostId,
            requestId: current.requestId,
            approved,
        });
        clearPendingExecConfirm();
    };

    const sandboxNote = current.sandboxed
        ? 'It will run sandboxed (workspace-scoped).'
        : '⚠ No sandbox is available on this platform. It will run with your full permissions.';

    return (
        <div
            class="verzeta-toolconfirm-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="verzeta-execconfirm-title"
        >
            <div class="verzeta-toolconfirm">
                <div class="verzeta-toolconfirm__header">
                    <h2 id="verzeta-execconfirm-title" class="verzeta-toolconfirm__title">
                        Run command on your device?
                    </h2>
                </div>
                <div class="verzeta-toolconfirm__body">
                    <p class="verzeta-toolconfirm__subtitle">
                        An agent wants to run a command in this workspace. Review and approve before
                        it runs.
                    </p>
                    <div class="verzeta-toolconfirm__field">
                        <span class="verzeta-toolconfirm__fieldLabel">Command</span>
                        <pre class="verzeta-toolconfirm__args">{current.command}</pre>
                    </div>
                    <p class="verzeta-toolconfirm__hint">{sandboxNote}</p>
                </div>
                <div class="verzeta-toolconfirm__actions">
                    <button
                        type="button"
                        class="verzeta-toolconfirm__btn verzeta-toolconfirm__btn--secondary"
                        onClick={() => answer(false)}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-toolconfirm__btn verzeta-toolconfirm__btn--primary"
                        onClick={() => answer(true)}
                        autoFocus
                    >
                        Run
                    </button>
                </div>
            </div>
        </div>
    );
}
