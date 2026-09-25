// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * MessageStore — in-memory cache of messages per conversation, with
 * streaming-friendly per-message text accumulation.
 *
 * The cache is bounded to a fixed window per conversation (LRU on
 * conversation ids, not on message ids) so a user who opens many
 * conversations does not balloon memory. Each conversation's
 * timeline is itself unbounded — the host's `msg.list` returns the
 * full history.
 *
 * Streaming flow:
 *
 *   message.streaming.started  -> upsertPlaceholder(streaming=true)
 *   message.streaming.delta    -> appendDelta (mutates content)
 *   message.streaming.aborted  -> markFinalized
 *   message.updated            -> upsertOne (full row replaces in-place)
 *
 * Public surface:
 *   - byConversation(convId)
 *   - replace(convId, messages)
 *   - mergeFromHost(convId, messages)
 *   - upsertOne(convId, message)
 *   - removeOne(convId, messageId)
 *   - appendDelta(convId, messageId, contentDelta, thinkingDelta?)
 *   - markFinalized(convId, messageId)
 *   - clearConversation(convId)
 *
 * Emits:
 *   - changed(convId)
 *   - delta(convId, messageId)     fired in addition to changed; lets
 *                                  webview push micro-deltas without
 *                                  resending the full snapshot
 */

import type { Disposable } from '../infra/disposables.js';
import { TypedEventEmitter } from '../infra/TypedEventEmitter.js';
import type { Logger } from '../log/Logger.js';
import type { FinishReason, MessageUi } from '../../shared/wire-types.js';

interface MessageStoreEvents extends Record<string, readonly unknown[]> {
    readonly changed: readonly [conversationId: string];
    readonly delta: readonly [conversationId: string, messageId: string];
}

const MAX_CONVERSATIONS_CACHED = 32;

export class MessageStore extends TypedEventEmitter<MessageStoreEvents> implements Disposable {
    private readonly logger: Logger;
    private readonly perConversation = new Map<string, MessageUi[]>();
    private readonly recency: string[] = [];

    constructor(logger: Logger) {
        super();
        this.logger = logger;
    }

    byConversation(convId: string): readonly MessageUi[] {
        return this.perConversation.get(convId) ?? [];
    }

    replace(convId: string, messages: readonly MessageUi[]): void {
        this.perConversation.set(convId, [...messages]);
        this.touch(convId);
        this.emit('changed', convId);
    }

    /**
     * Fold a fresh `msg.list` result into the cached timeline. Used when
     * a conversation is reopened or the connection comes back, since
     * events for an unsubscribed conversation were never delivered.
     *
     * The host's rows win, in the host's order, so finished turns replace
     * stale streaming placeholders. Local rows the host does not list yet
     * are kept at the end: an optimistic user row (unless the host now has
     * the same text from the user) and a reply that is still streaming.
     * One exception: while a reply streams, the host may list its row with
     * no content yet; the local row, which already holds the streamed
     * text, is kept for that id.
     *
     * @param convId the conversation id.
     * @param hostRows the host's full message list for the conversation.
     */
    mergeFromHost(convId: string, hostRows: readonly MessageUi[]): void {
        const current = this.perConversation.get(convId) ?? [];
        const localById = new Map(current.map((m) => [m.id, m]));
        const merged = hostRows.map((row) => {
            const local = localById.get(row.id);
            const hostStillEmpty =
                row.content.length === 0 && (row.finishReason ?? '').length === 0;
            return local !== undefined && hostStillEmpty && local.content.length > 0 ? local : row;
        });
        const hostIds = new Set(hostRows.map((m) => m.id));
        const extras = current.filter((m) => {
            if (hostIds.has(m.id)) return false;
            if (!m.id.startsWith('optimistic:')) return true;
            const text = m.content.trim();
            return !hostRows.some((h) => h.role === m.role && h.content.trim() === text);
        });
        this.perConversation.set(convId, [...merged, ...extras]);
        this.touch(convId);
        this.emit('changed', convId);
    }

    upsertOne(convId: string, message: MessageUi): void {
        const current = this.perConversation.get(convId) ?? [];
        const exactIdx = current.findIndex((m) => m.id === message.id);
        if (exactIdx !== -1) {
            this.traceUpsert('replace-by-id', convId, message, current.length);
            current[exactIdx] = message;
            this.perConversation.set(convId, current);
            this.touch(convId);
            this.emit('changed', convId);
            return;
        }
        // Reconcile optimistic user-message inserts. WebviewSync inserts
        // a placeholder with `id = "optimistic:<ts>:<rand>"` because the
        // host's `msg.send` response carries `{status, conv_id}` only —
        // no canonical id. The host's `message.added` event arrives soon
        // after with the real UUID; this branch swaps the optimistic row
        // for the canonical one in place so the user never sees two
        // copies.
        //
        // Matching mirrors `Verzeta-Android/.../MainViewModel.kt:4383-4396`:
        // optimistic-prefix id + role + trimmed content equality. NO
        // timestamp comparison — the host emits createdAt in seconds or
        // ms depending on the projection path, and the previous 30 s
        // window broke whenever ms vs seconds drift exceeded it.
        //
        // Direction is one-way: a CANONICAL message replacing an
        // OPTIMISTIC placeholder. The reverse (optimistic arriving
        // after canonical) is a no-op insert because the canonical is
        // authoritative.
        if (message.role === 'user' && !message.id.startsWith('optimistic:')) {
            const reconcileIdx = current.findIndex(
                (m) =>
                    m.id.startsWith('optimistic:') &&
                    m.role === 'user' &&
                    m.content.trim() === message.content.trim(),
            );
            if (reconcileIdx !== -1) {
                this.traceUpsert('reconcile-optimistic', convId, message, current.length);
                current[reconcileIdx] = message;
                this.perConversation.set(convId, current);
                this.touch(convId);
                this.emit('changed', convId);
                return;
            }
        }
        // If an optimistic insert finds a canonical twin already present
        // (rare race — message.added beat the local upsertOne), drop the
        // optimistic silently; the canonical is the source of truth.
        if (message.role === 'user' && message.id.startsWith('optimistic:')) {
            const canonicalTwin = current.find(
                (m) =>
                    !m.id.startsWith('optimistic:') &&
                    m.role === 'user' &&
                    m.content.trim() === message.content.trim(),
            );
            if (canonicalTwin !== undefined) {
                // Drop the optimistic; nothing to emit since the canonical
                // is already present.
                this.traceUpsert('drop-optimistic-twin', convId, message, current.length);
                return;
            }
        }
        this.traceUpsert('insert', convId, message, current.length + 1);
        current.push(message);
        this.perConversation.set(convId, current);
        this.touch(convId);
        this.emit('changed', convId);
        this.warnOnDuplicateSuspect(convId, current, message);
    }

    /**
     * Structured debug line for every upsertOne decision. The branch
     * label tells the diagnostic reader exactly which reconciliation
     * path ran; content is preview-truncated per the logging policy.
     */
    private traceUpsert(
        branch: string,
        convId: string,
        message: MessageUi,
        rowCount: number,
    ): void {
        this.logger.debug(`MessageStore: upsert ${branch}`, {
            convId,
            msgId: message.id,
            role: message.role,
            turnId: message.turnId,
            contentLen: message.content.length,
            contentHead: message.content.slice(0, 32),
            rows: rowCount,
        });
    }

    /**
     * After a plain insert, scan the timeline for another row with the
     * same role and identical trimmed content under a DIFFERENT id —
     * the signature of every double-message class (optimistic row that
     * failed to reconcile, replayed history row, or a host event
     * delivered twice under fresh ids). Logged at WARN so the line is
     * visible at the default log level; the surrounding debug trace
     * (wire receipt + upsert branches) localises which producer made
     * the second row.
     */
    private warnOnDuplicateSuspect(
        convId: string,
        rows: readonly MessageUi[],
        inserted: MessageUi,
    ): void {
        const trimmed = inserted.content.trim();
        // Two suspect signatures: (a) identical role+content under a
        // different id — failed optimistic reconcile or double event
        // delivery; (b) same non-empty turnId on two assistant rows —
        // a streaming placeholder that never matched its finalised row
        // (content differs mid-stream, so signature (a) misses it).
        const twin = rows.find(
            (m) =>
                m.id !== inserted.id &&
                m.role === inserted.role &&
                ((trimmed.length > 0 && m.content.trim() === trimmed) ||
                    (inserted.role === 'assistant' &&
                        inserted.turnId !== undefined &&
                        inserted.turnId.length > 0 &&
                        m.turnId === inserted.turnId)),
        );
        if (twin === undefined) return;
        this.logger.warn(
            'MessageStore: DUPE-SUSPECT — two rows, same role+content, different ids',
            {
                convId,
                insertedId: inserted.id,
                twinId: twin.id,
                role: inserted.role,
                insertedTurnId: inserted.turnId,
                twinTurnId: twin.turnId,
                contentLen: inserted.content.length,
                contentHead: trimmed.slice(0, 32),
                rows: rows.length,
            },
        );
    }

    removeOne(convId: string, messageId: string): void {
        const current = this.perConversation.get(convId) ?? [];
        const filtered = current.filter((m) => m.id !== messageId);
        if (filtered.length === current.length) return;
        this.perConversation.set(convId, filtered);
        this.emit('changed', convId);
    }

    /**
     * Adds a streaming placeholder message (or replaces an existing
     * one with the same id, e.g. on a re-stream). The placeholder
     * carries empty content until deltas arrive.
     */
    upsertPlaceholder(convId: string, message: MessageUi): void {
        this.upsertOne(convId, message);
    }

    /**
     * Appends a content delta (and optional thinking-channel delta)
     * to the streaming message. Mutates in place to keep streaming
     * cheap — no array-rebuilds, no per-delta allocations beyond the
     * new string.
     */
    appendDelta(
        convId: string,
        messageId: string,
        contentDelta: string,
        thinkingDelta?: string,
    ): void {
        const current = this.perConversation.get(convId);
        if (current === undefined) return;
        const idx = current.findIndex((m) => m.id === messageId);
        if (idx === -1) return;
        const existing = current[idx];
        if (existing === undefined) return;
        const nextContent =
            contentDelta.length > 0 ? `${existing.content}${contentDelta}` : existing.content;
        const nextThinking =
            thinkingDelta !== undefined && thinkingDelta.length > 0
                ? `${existing.thinkingContent ?? ''}${thinkingDelta}`
                : existing.thinkingContent;
        current[idx] = { ...existing, content: nextContent, thinkingContent: nextThinking };
        this.emit('delta', convId, messageId);
    }

    /**
     * Marks a streaming message as finalised (e.g. on streaming.aborted
     * or as a fallback if message.updated does not arrive immediately).
     */
    markFinalized(convId: string, messageId: string, reason = ''): void {
        const current = this.perConversation.get(convId);
        if (current === undefined) return;
        const idx = current.findIndex((m) => m.id === messageId);
        if (idx === -1) return;
        const existing = current[idx];
        if (existing === undefined) return;
        // Stamp a finishReason so the webview can tell "stream ended"
        // from "still streaming". Without this, an aborted stream that
        // produced ZERO content left the assistant bubble rendering
        // typing-dots forever (its empty content looked identical to an
        // in-flight stream). Map the host reason onto a known
        // FinishReason, defaulting to 'error' for an empty interrupted
        // turn. Never downgrade an already-set reason.
        if ((existing.finishReason ?? '').length === 0) {
            const mapped: FinishReason =
                reason === 'user_interrupted' || reason === 'stop'
                    ? 'user_interrupted'
                    : existing.content.length === 0
                      ? 'error'
                      : 'stop';
            current[idx] = { ...existing, finishReason: mapped };
        }
        this.logger.debug('MessageStore: finalised', { convId, messageId, reason });
        this.emit('changed', convId);
    }

    clearConversation(convId: string): void {
        if (!this.perConversation.has(convId)) return;
        this.perConversation.delete(convId);
        const idx = this.recency.indexOf(convId);
        if (idx !== -1) this.recency.splice(idx, 1);
        this.emit('changed', convId);
    }

    dispose(): void {
        this.perConversation.clear();
        this.recency.length = 0;
        this.removeAllListeners();
    }

    private touch(convId: string): void {
        const idx = this.recency.indexOf(convId);
        if (idx !== -1) this.recency.splice(idx, 1);
        this.recency.push(convId);
        while (this.recency.length > MAX_CONVERSATIONS_CACHED) {
            const evicted = this.recency.shift();
            if (evicted !== undefined && evicted !== convId) {
                this.perConversation.delete(evicted);
            }
        }
    }
}
