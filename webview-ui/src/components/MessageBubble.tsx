// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * MessageBubble — one row in the chat timeline.
 *
 * Mirrors Android `ChatScreen.MessageRow` exactly:
 *   - assistant rows: header (V mark + role label + model + @alias)
 *     above a left-aligned bubble; AssistantFooter underneath with
 *     relative time, token count, and finish-reason when non-stop.
 *   - user rows: right-aligned bubble, no header / footer.
 *   - system rows: centred, dim italic body.
 *   - tool rows: dropped — host never emits these to clients in v1.
 *
 * The role label resolves to:
 *   - "@alias"   when memberAlias is present (group chats /
 *                project rooms with assigned agent aliases)
 *   - "Assistant" otherwise (1:1 chats or agent without alias)
 *
 * Markdown rendering uses our hand-rolled renderer
 * (`lib/markdown.tsx`). No HTML pass-through.
 */

import { useState } from 'preact/hooks';
import type { MessageRowUi } from '../../../src/shared/webview-protocol.js';
import { renderMarkdown } from '../lib/markdown.js';
import { VerzetaMark } from './VerzetaMark.js';

export interface MessageBubbleProps {
    readonly message: MessageRowUi;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    if (message.role === 'tool') return null;
    if (message.role === 'system') return <SystemBubble message={message} />;
    if (message.role === 'user') return <UserBubble message={message} />;
    return <AssistantBubble message={message} />;
}

function UserBubble({ message }: { readonly message: MessageRowUi }) {
    // Mirrors Android `ChatScreen.UserBubble` (lines 614-666): "You" label
    // + optional `@memberAlias` + relative time, rendered above the bubble
    // body. The previous shape rendered the bubble alone, which read as a
    // floating colour block with no attribution.
    const hasAlias = message.memberAlias !== undefined && message.memberAlias.length > 0;
    const time = formatRelativeTime(message.createdAt);
    return (
        <div class="verzeta-msg verzeta-msg--user">
            <div class="verzeta-msg__header verzeta-msg__header--user">
                <span class="verzeta-msg__role">You</span>
                {hasAlias ? <span class="verzeta-msg__alias">@{message.memberAlias}</span> : null}
                <span class="verzeta-msg__spacer" />
                {time.length > 0 ? <span class="verzeta-msg__time">{time}</span> : null}
            </div>
            <div class="verzeta-msg__bubble verzeta-msg__bubble--user">
                {renderMarkdown(message.content)}
            </div>
        </div>
    );
}

/**
 * System rows come in two shapes (mirrors Android's SystemNoteRow):
 * short status notes (round-pause ⏸/▶, compact receipts — ≤160
 * chars) render centred and dim; long reports (🤖 sub-agent results)
 * render as a full-width tinted card with markdown so multi-paragraph
 * content stays readable.
 */
const SYSTEM_NOTE_MAX_CHARS = 160;

function SystemBubble({ message }: { readonly message: MessageRowUi }) {
    const isShortNote =
        message.content.length <= SYSTEM_NOTE_MAX_CHARS && !message.content.includes('\n');
    if (isShortNote) {
        return (
            <div class="verzeta-msg verzeta-msg--system">
                <div class="verzeta-msg__bubble verzeta-msg__bubble--system">
                    {renderMarkdown(message.content)}
                </div>
            </div>
        );
    }
    return (
        <div class="verzeta-msg verzeta-msg--systemreport">
            <div class="verzeta-msg__bubble verzeta-msg__bubble--systemreport">
                {renderMarkdown(message.content)}
            </div>
        </div>
    );
}

function AssistantBubble({ message }: { readonly message: MessageRowUi }) {
    const hasAlias = message.memberAlias !== undefined && message.memberAlias.length > 0;
    const roleLabel = hasAlias ? '' : 'Assistant';
    const hasThinking = message.thinkingContent.length > 0;
    const hasContent = message.content.length > 0;
    const finished = (message.finishReason ?? '').length > 0;
    // Only show typing-dots while the turn is genuinely in flight. A
    // finalised turn (e.g. the stream aborted on a dropped connection)
    // has a finishReason set even with empty content, so it must NOT
    // animate forever.
    const isStreaming = !hasContent && !hasThinking && !finished;
    const interrupted = !hasContent && !hasThinking && finished;
    return (
        <div class="verzeta-msg verzeta-msg--assistant">
            <div class="verzeta-msg__header">
                <span class="verzeta-msg__avatar" aria-hidden="true">
                    <VerzetaMark size={18} />
                </span>
                {roleLabel.length > 0 ? <span class="verzeta-msg__role">{roleLabel}</span> : null}
                {message.modelUsed.length > 0 ? (
                    <span class="verzeta-msg__model" title={message.modelUsed}>
                        · {message.modelUsed}
                    </span>
                ) : null}
                {hasAlias ? <span class="verzeta-msg__alias">@{message.memberAlias}</span> : null}
            </div>
            {hasThinking ? <ThinkingDisclosure text={message.thinkingContent} /> : null}
            <div class="verzeta-msg__bubble verzeta-msg__bubble--assistant">
                {hasContent ? (
                    renderMarkdown(message.content)
                ) : isStreaming ? (
                    <span class="verzeta-msg__typing" aria-label="Assistant is typing">
                        <span></span>
                        <span></span>
                        <span></span>
                    </span>
                ) : interrupted ? (
                    <span class="verzeta-msg__placeholder">
                        ⚠ Response interrupted before any output. Check the connection and try
                        again.
                    </span>
                ) : (
                    <span class="verzeta-msg__placeholder">
                        Reasoning emitted with no visible content.
                    </span>
                )}
            </div>
            {!isStreaming ? <AssistantFooter message={message} /> : null}
        </div>
    );
}

function AssistantFooter({ message }: { readonly message: MessageRowUi }) {
    const parts: string[] = [];
    const time = formatRelativeTime(message.createdAt);
    if (time.length > 0) parts.push(time);
    if (message.tokenCount > 0) parts.push(`${message.tokenCount} tokens`);
    if (message.finishReason.length > 0 && message.finishReason !== 'stop') {
        parts.push(`ended: ${message.finishReason}`);
    }
    if (
        message.agentId !== undefined &&
        message.agentId.length > 0 &&
        (message.memberAlias === undefined || message.memberAlias.length === 0)
    ) {
        parts.push(`agent ${message.agentId.slice(0, 8)}`);
    }
    if (parts.length === 0) return null;
    return <div class="verzeta-msg__footer">{parts.join(' · ')}</div>;
}

function ThinkingDisclosure({ text }: { readonly text: string }) {
    const [open, setOpen] = useState(false);
    return (
        <details
            class={`verzeta-thinking ${open ? 'verzeta-thinking--open' : ''}`}
            onToggle={(event) => {
                const target = event.currentTarget;
                if (target instanceof HTMLDetailsElement) setOpen(target.open);
            }}
        >
            <summary class="verzeta-thinking__summary">
                Reasoning ({text.length.toLocaleString()} chars)
            </summary>
            <div class="verzeta-thinking__body">{renderMarkdown(text)}</div>
        </details>
    );
}

function formatRelativeTime(timestamp: number): string {
    if (timestamp <= 0) return '';
    // Tolerate both seconds-since-epoch and ms-since-epoch from the host.
    const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
    const deltaSeconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (deltaSeconds < 60) return 'just now';
    if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
    if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
    if (deltaSeconds < 604800) return `${Math.floor(deltaSeconds / 86400)}d ago`;
    const date = new Date(ms);
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}
