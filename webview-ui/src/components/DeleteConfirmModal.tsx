// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * DeleteConfirmModal — single confirmation surface for every
 * destructive delete (conversation, folder) in the chat rail. The
 * rail surfaces trash icons which set the `pendingDelete` signal;
 * this modal renders against that signal, asks the user to confirm,
 * and fires the matching `*.deleteRequested` envelope on Confirm.
 *
 * Native `window.confirm` is blocked inside VS Code webviews so
 * we hand-roll the modal here. Reuses the existing
 * `.verzeta-addmember-backdrop` / `.verzeta-addmember` shell so the
 * visual style matches the rest of the chrome.
 */

import { activeHostId } from '../state/hosts.js';
import { clearPendingDelete, pendingDelete } from '../state/chatUi.js';
import { setActiveConversationId } from '../state/conversations.js';
import { activeConversationId } from '../state/conversations.js';
import { send } from '../lib/bus.js';

export function DeleteConfirmModal() {
    const pending = pendingDelete.value;
    if (pending === null) return null;
    const hostId = activeHostId.value;

    const onCancel = (): void => clearPendingDelete();

    const onConfirm = (): void => {
        if (hostId === undefined) {
            clearPendingDelete();
            return;
        }
        if (pending.kind === 'conv') {
            // If we're deleting the conversation that's currently
            // open, deselect it so the user lands back on the rail
            // instead of staring at a "messages for a deleted conv"
            // detail surface.
            if (activeConversationId.value === pending.id) {
                setActiveConversationId(undefined);
            }
            send({
                type: 'conversation.deleteRequested',
                hostId,
                conversationId: pending.id,
            });
        } else {
            send({
                type: 'folder.deleteRequested',
                hostId,
                folderId: pending.id,
            });
        }
        clearPendingDelete();
    };

    const title = pending.kind === 'conv' ? 'Delete conversation?' : 'Delete folder?';

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">{title}</h3>
                </header>
                <div class="verzeta-addmember__body">
                    <p>
                        <strong>{pending.label}</strong>
                    </p>
                    {pending.subtitle.length > 0 ? (
                        <p class="verzeta-addmember__hint">{pending.subtitle}</p>
                    ) : null}
                    <p class="verzeta-addmember__hint">This cannot be undone from the extension.</p>
                </div>
                <footer class="verzeta-addmember__footer">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--danger"
                        onClick={onConfirm}
                    >
                        Delete
                    </button>
                </footer>
            </div>
        </div>
    );
}
