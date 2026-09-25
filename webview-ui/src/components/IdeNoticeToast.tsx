// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * IdeNoticeToast — transient toast surface for IDE-bridge messages
 * ("Applied to src/foo.ts", "Attachment too large", etc). Pinned
 * to the bottom of the Chat tab above the composer; auto-dismisses
 * via `state/ide.ts`. Click to dismiss early.
 */

import { clearIdeNotice, ideNotice } from '../state/ide.js';

export function IdeNoticeToast() {
    const notice = ideNotice.value;
    if (notice === null) return null;
    const className = `verzeta-ide-toast verzeta-ide-toast--${notice.level}`;
    return (
        <div class={className} role="status" aria-live="polite" onClick={clearIdeNotice}>
            <span class="verzeta-ide-toast__msg">{notice.message}</span>
            <button
                type="button"
                class="verzeta-ide-toast__close"
                aria-label="Dismiss"
                onClick={(e) => {
                    e.stopPropagation();
                    clearIdeNotice();
                }}
            >
                ×
            </button>
        </div>
    );
}
