// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Composer — text input + Send/Stop button + file/image attachment
 * picker, mirroring Android `ChatScreen.Composer` (lines 828-962).
 *
 *   - Enter to send (without Shift).
 *   - Shift+Enter to add a newline.
 *   - Send is disabled when:
 *       - the draft is empty AND no attachments are pending, OR
 *       - the active host is not connected, OR
 *       - no conversation is selected.
 *   - The button switches to Stop while a streaming message is in
 *     flight (signal: composerSending).
 *   - Attach button opens an OS file picker. Selected files are
 *     read into memory as base64 (caps from the shared wire-limits:
 *     MAX_CONTENT_BYTES per file and per-message total, MAX_ATTACHMENTS
 *     files — mirrors the host's kMaxContentBytes / kMaxWireFrameBytes).
 *   - Picked attachments render as removable chips above the pill.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { activeConversationId } from '../state/conversations.js';
import { activeConvSettings } from '../state/convSettings.js';
import { activeHostId, stateOf as connectionStateOf } from '../state/hosts.js';
import {
    addPendingAttachment,
    attachmentPickError,
    clearComposerDraft,
    clearPendingAttachments,
    composerDraft,
    composerSending,
    MAX_ATTACHMENTS,
    MAX_CONTENT_BYTES,
    pendingAttachments,
    removePendingAttachment,
    setAttachmentPickError,
    setComposerDraft,
    setSending,
} from '../state/composer.js';
import { send } from '../lib/bus.js';
import { isSafeUploadFileName, unsafeFileNameMessage } from '../../../src/shared/wire-limits.js';
import { activeContextFill } from '../state/contextFill.js';
import { clearThinkingPlaceholders, insertThinkingPlaceholder } from '../state/messages.js';
import type { OutgoingAttachmentUi } from '../../../src/shared/wire-types.js';

export function Composer() {
    const hostId = activeHostId.value;
    const convId = activeConversationId.value;
    const draft = composerDraft.value;
    const sending = composerSending.value;
    const attachments = pendingAttachments.value;
    const pickError = attachmentPickError.value;
    const state = hostId !== undefined ? connectionStateOf(hostId) : 'disconnected';
    const ready = hostId !== undefined && convId !== undefined && state === 'connected';
    const hasDraft = draft.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    const canSend = ready && !sending && (hasDraft || hasAttachments);
    const settings = activeConvSettings.value;

    // Pull the conversation's settings when it becomes active so the
    // Thinking / Tools / RAG pills reflect live state without the user
    // opening the settings sheet first. Idempotent fetch.
    useEffect(() => {
        if (hostId === undefined || convId === undefined) return;
        send({ type: 'conv.settings.requested', hostId, conversationId: convId });
    }, [hostId, convId]);

    // Auto-grow the textarea to fit its content. The onInput handler does
    // this on manual typing, but text staged programmatically (Send
    // Selection / Add Context / drop / paste) updates the value WITHOUT
    // firing onInput — so recompute the height here whenever the draft
    // changes. Same cap (140px) as the typing path; shrinks back when the
    // draft is cleared after a send.
    useEffect(() => {
        const ta = textareaRef.current;
        if (ta === null) return;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }, [draft]);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [taskPromptOpen, setTaskPromptOpen] = useState(false);
    const [attachMenuOpen, setAttachMenuOpen] = useState(false);
    const [dragActive, setDragActive] = useState(false);

    const onAddContext = (): void => {
        setAttachMenuOpen(false);
        // The extension shows a workspace-file quick-pick and stages the
        // chosen files back as attachment chips via `ide.stage`.
        send({ type: 'ide.addContextRequested' });
    };

    const onStartTaskGoal = (goal: string): void => {
        if (hostId === undefined || convId === undefined) return;
        send({ type: 'task.startRequested', hostId, conversationId: convId, goal });
        setTaskPromptOpen(false);
    };

    const onPickFiles = (): void => {
        setAttachMenuOpen(false);
        if (!ready || attachments.length >= MAX_ATTACHMENTS) return;
        fileInputRef.current?.click();
    };

    const addFiles = async (files: readonly File[]): Promise<void> => {
        for (const file of files) {
            const result = await readFileAsAttachment(file);
            if (result.kind === 'error') {
                setAttachmentPickError(result.message);
                break;
            }
            const reject = addPendingAttachment(result.attachment);
            if (reject !== null) {
                setAttachmentPickError(reject);
                break;
            }
        }
    };

    const onFilesChosen = async (event: Event): Promise<void> => {
        const input = event.currentTarget as HTMLInputElement;
        const files = input.files;
        if (files === null || files.length === 0) return;
        await addFiles(Array.from(files));
        // Reset so re-picking the same file fires `change` again.
        input.value = '';
    };

    const onPaste = async (event: ClipboardEvent): Promise<void> => {
        if (!ready) return;
        const items = event.clipboardData?.items;
        if (items === undefined) return;
        const images: File[] = [];
        let i = 0;
        for (const item of Array.from(items)) {
            if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
            const blob = item.getAsFile();
            if (blob === null) continue;
            const ext = (blob.type.split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '') || 'png';
            // Clipboard images often have no (or an unsafe) name; give
            // them a clean one so the attachment validator accepts them.
            const named =
                blob.name.trim().length > 0
                    ? blob
                    : new File([blob], `pasted-image-${i}.${ext}`, { type: blob.type });
            images.push(named);
            i += 1;
        }
        if (images.length === 0) return; // No image — let the text paste proceed.
        event.preventDefault();
        await addFiles(images);
    };

    const onDrop = async (event: DragEvent): Promise<void> => {
        event.preventDefault();
        setDragActive(false);
        if (!ready) return;
        const dt = event.dataTransfer;
        if (dt === null) return;
        // OS file-manager drop → File objects read in the webview.
        if (dt.files.length > 0) {
            await addFiles(Array.from(dt.files));
            return;
        }
        // VS Code Explorer / editor drop → file URIs the extension reads
        // and stages back as attachment chips.
        const uriList = dt.getData('text/uri-list') || dt.getData('application/vnd.code.uri-list');
        if (uriList.length > 0) {
            const uris = uriList
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0 && !s.startsWith('#'));
            if (uris.length > 0) send({ type: 'ide.dropUrisRequested', uris });
        }
    };

    const onSend = (): void => {
        if (!canSend || hostId === undefined || convId === undefined) return;
        const text = draft.trim();
        if (text.length === 0 && !hasAttachments) return;
        if (hasAttachments) {
            send({
                type: 'message.sendWithAttachments',
                hostId,
                conversationId: convId,
                text,
                attachments,
            });
            clearPendingAttachments();
        } else {
            send({ type: 'message.send', hostId, conversationId: convId, text });
        }
        clearComposerDraft();
        setSending(true);
        // Synthetic "typing dots" placeholder so the user sees an
        // assistant response is being prepared the instant they hit
        // send — before message.streaming.started fires. Cleared
        // when the first message.delta arrives (App.tsx) or the
        // safety-net timeout below.
        insertThinkingPlaceholder(convId);
        setTimeout(() => {
            setSending(false);
            clearThinkingPlaceholders(convId);
        }, 60_000);
    };

    const onStop = (): void => {
        if (hostId === undefined) return;
        send({ type: 'message.stop', hostId });
        setSending(false);
    };

    return (
        <div
            class={dragActive ? 'verzeta-composer verzeta-composer--dragover' : 'verzeta-composer'}
            onDragOver={(e) => {
                e.preventDefault();
                if (ready && attachments.length < MAX_ATTACHMENTS) setDragActive(true);
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragActive(false);
            }}
            onDrop={(e) => void onDrop(e as unknown as DragEvent)}
        >
            {dragActive ? <div class="verzeta-composer__drophint">Drop files to attach</div> : null}
            {!ready ? <ComposerStatusBanner state={state} convId={convId} /> : null}
            <SlashCommandHints draft={draft} onPick={setComposerDraft} />
            {hasAttachments ? (
                <AttachmentStrip
                    attachments={attachments}
                    onRemove={removePendingAttachment}
                    disabled={sending}
                />
            ) : null}
            {pickError !== null ? (
                <div class="verzeta-composer__error">
                    {pickError}
                    <button
                        type="button"
                        class="verzeta-composer__error-dismiss"
                        onClick={() => setAttachmentPickError(null)}
                        aria-label="Dismiss"
                    >
                        ×
                    </button>
                </div>
            ) : null}
            <div class="verzeta-composer__pill">
                <textarea
                    ref={textareaRef}
                    class="verzeta-composer__input"
                    value={draft}
                    placeholder={
                        ready
                            ? hasAttachments
                                ? 'Add a caption…'
                                : 'Ask anything…'
                            : convId === undefined
                              ? 'Pick a conversation first…'
                              : 'Waiting for connection…'
                    }
                    disabled={!ready}
                    onInput={(event) => {
                        const ta = event.currentTarget as HTMLTextAreaElement;
                        setComposerDraft(ta.value);
                        ta.style.height = 'auto';
                        ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            onSend();
                        }
                    }}
                    onPaste={(event) => void onPaste(event as unknown as ClipboardEvent)}
                    rows={1}
                    spellcheck={true}
                    aria-label="Message composer"
                />
            </div>
            <div class="verzeta-composer__toolbar">
                <div class="verzeta-composer__attachwrap">
                    <button
                        type="button"
                        class="verzeta-composer__iconbtn"
                        title={
                            attachments.length >= MAX_ATTACHMENTS
                                ? `Maximum ${MAX_ATTACHMENTS} attachments per message`
                                : 'Add context or files'
                        }
                        aria-label="Add context or files"
                        aria-haspopup="menu"
                        aria-expanded={attachMenuOpen}
                        onClick={() => setAttachMenuOpen((v) => !v)}
                        disabled={!ready || sending || attachments.length >= MAX_ATTACHMENTS}
                    >
                        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                                d="M12 5v14M5 12h14"
                                stroke="currentColor"
                                stroke-width="1.9"
                                stroke-linecap="round"
                            />
                        </svg>
                    </button>
                    {attachMenuOpen ? (
                        <>
                            <div
                                class="verzeta-composer__attachbackdrop"
                                onClick={() => setAttachMenuOpen(false)}
                            />
                            <div class="verzeta-composer__attachmenu" role="menu">
                                <button
                                    type="button"
                                    class="verzeta-composer__attachitem"
                                    role="menuitem"
                                    onClick={onAddContext}
                                >
                                    <span class="verzeta-composer__attachitem-title">
                                        Add Context
                                    </span>
                                    <span class="verzeta-composer__attachitem-sub">
                                        Pick files from this workspace
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    class="verzeta-composer__attachitem"
                                    role="menuitem"
                                    onClick={onPickFiles}
                                >
                                    <span class="verzeta-composer__attachitem-title">
                                        Add Files
                                    </span>
                                    <span class="verzeta-composer__attachitem-sub">
                                        Browse files on your computer
                                    </span>
                                </button>
                            </div>
                        </>
                    ) : null}
                </div>
                <button
                    type="button"
                    class="verzeta-composer__iconbtn"
                    title={
                        hasDraft
                            ? 'Start a task with this message as the goal'
                            : 'Type a goal, then start a task'
                    }
                    aria-label="Start task"
                    onClick={() => setTaskPromptOpen(true)}
                    disabled={!ready || sending}
                >
                    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                        <rect
                            x="4"
                            y="5"
                            width="16"
                            height="15"
                            rx="2"
                            stroke="currentColor"
                            stroke-width="1.8"
                            fill="none"
                        />
                        <path
                            d="M8 3v4M16 3v4M4 10h16M9 14l2 2 4-4"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            fill="none"
                        />
                    </svg>
                </button>
                <span class="verzeta-composer__toolbarspacer" />
                {settings !== undefined && hostId !== undefined && convId !== undefined ? (
                    <>
                        <TogglePill
                            label="Thinking"
                            active={settings.thinking}
                            icon={<ThinkingIcon />}
                            onClick={() =>
                                send({
                                    type: 'conv.settings.save',
                                    hostId,
                                    conversationId: convId,
                                    patch: { thinking: !settings.thinking },
                                })
                            }
                        />
                        <TogglePill
                            label="Tools"
                            active={settings.toolsEnabled}
                            icon={<ToolsIcon />}
                            onClick={() =>
                                send({
                                    type: 'tools.enabled.set',
                                    hostId,
                                    conversationId: convId,
                                    enabled: !settings.toolsEnabled,
                                })
                            }
                        />
                        <TogglePill
                            label="RAG"
                            active={settings.ragEnabled}
                            icon={<RagIcon />}
                            onClick={() =>
                                send({
                                    type: 'conv.settings.save',
                                    hostId,
                                    conversationId: convId,
                                    patch: { ragEnabled: !settings.ragEnabled },
                                })
                            }
                        />
                    </>
                ) : null}
                {ready ? <ContextFillGauge /> : null}
                {sending ? (
                    <button
                        type="button"
                        class="verzeta-composer__send verzeta-composer__send--stop"
                        onClick={onStop}
                        aria-label="Stop generation"
                        title="Stop generation"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
                        </svg>
                    </button>
                ) : (
                    <button
                        type="button"
                        class="verzeta-composer__send"
                        onClick={onSend}
                        disabled={!canSend}
                        aria-label="Send message"
                        title="Send (Enter)"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                                d="M12 19V5M5 12l7-7 7 7"
                                stroke="currentColor"
                                stroke-width="2.4"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                fill="none"
                            />
                        </svg>
                    </button>
                )}
            </div>
            {taskPromptOpen ? (
                <TaskPromptModal
                    onSubmit={onStartTaskGoal}
                    onClose={() => setTaskPromptOpen(false)}
                />
            ) : null}
            {/* Hidden native input so the brand button drives the OS picker. */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                style="display: none"
                onChange={(event) => {
                    void onFilesChosen(event);
                }}
                aria-hidden="true"
                tabIndex={-1}
            />
        </div>
    );
}

/**
 * A compact toggle pill (Thinking / Tools / RAG) mirroring the
 * desktop composer: an icon plus a text label. The label collapses
 * away (icon-only) when the composer is too narrow — see the
 * container query in chat.css — so the row never overflows.
 */
function TogglePill({
    label,
    active,
    icon,
    onClick,
}: {
    readonly label: string;
    readonly active: boolean;
    readonly icon: ComponentChildren;
    readonly onClick: () => void;
}) {
    return (
        <button
            type="button"
            class={`verzeta-composer__togglepill${active ? ' verzeta-composer__togglepill--on' : ''}`}
            aria-pressed={active}
            title={`${label}: ${active ? 'on' : 'off'}`}
            onClick={onClick}
        >
            <span class="verzeta-composer__pillicon" aria-hidden="true">
                {icon}
            </span>
            <span class="verzeta-composer__pilltext">{label}</span>
        </button>
    );
}

function ThinkingIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"
                stroke="currentColor"
                stroke-width="1.7"
                fill="none"
            />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
        </svg>
    );
}

function ToolsIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M14.7 6.3a3.5 3.5 0 00-4.6 4.6l-6.4 6.4 2 2 6.4-6.4a3.5 3.5 0 004.6-4.6l-2.2 2.2-2-2 2.2-2.2z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
                fill="none"
            />
        </svg>
    );
}

function RagIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <ellipse
                cx="12"
                cy="6"
                rx="7"
                ry="3"
                stroke="currentColor"
                stroke-width="1.6"
                fill="none"
            />
            <path
                d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"
                stroke="currentColor"
                stroke-width="1.6"
                fill="none"
            />
        </svg>
    );
}

/**
 * Animated context-window fill gauge — an SVG ring that fills with the
 * measured percentage and recolours grey → amber (≥70%, the host's
 * proactive-compaction threshold) → red (≥90%). Hidden until the host
 * reports a measurement for the active conversation. Mirrors the
 * desktop / Android radial gauge.
 */
function ContextFillGauge() {
    // Always visible while a conversation is active — it's the dynamic-
    // compaction indicator. Before the host's first measurement it
    // reads 0% (empty ring) rather than disappearing.
    const measured = activeContextFill.value;
    const percent = measured ?? 0;
    const tone = percent >= 90 ? 'red' : percent >= 70 ? 'amber' : 'grey';
    const r = 8;
    const circ = 2 * Math.PI * r;
    const dash = (Math.max(0, Math.min(100, percent)) / 100) * circ;
    return (
        <span
            class={`verzeta-composer__gauge verzeta-composer__gauge--${tone}`}
            title={
                measured === undefined
                    ? 'Context window fill (measured on the next turn)'
                    : `Context window ${percent}% full${percent >= 70 ? ' (auto-compact may run soon)' : ''}`
            }
            aria-label={`Context window ${percent} percent full`}
        >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <circle
                    class="verzeta-composer__gaugeTrack"
                    cx="10"
                    cy="10"
                    r={r}
                    fill="none"
                    stroke-width="2.5"
                />
                <circle
                    class="verzeta-composer__gaugeFill"
                    cx="10"
                    cy="10"
                    r={r}
                    fill="none"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-dasharray={`${dash} ${circ}`}
                    transform="rotate(-90 10 10)"
                />
            </svg>
        </span>
    );
}

/**
 * "Start a Task" modal — mirrors the desktop dialog: a description, a
 * multi-line goal field, and OK / Cancel. Submitting fires the
 * existing task.startRequested envelope; the host works the goal
 * across as many turns as it needs and tracks progress in the Plans
 * panel.
 */
function TaskPromptModal({
    onSubmit,
    onClose,
}: {
    readonly onSubmit: (goal: string) => void;
    readonly onClose: () => void;
}) {
    const [goal, setGoal] = useState('');
    const submit = (): void => {
        const trimmed = goal.trim();
        if (trimmed.length === 0) return;
        onSubmit(trimmed);
    };
    return (
        <div
            class="verzeta-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Start a task"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div class="verzeta-modal">
                <h3 class="verzeta-modal__title">Start a task</h3>
                <p class="verzeta-modal__desc">
                    Describe what you want the agent to do. It uses tools as needed (file writes,
                    web search, and so on) and keeps going for as many turns as it takes. Track
                    progress in the Plans panel.
                </p>
                <textarea
                    class="verzeta-modal__input"
                    autofocus
                    rows={4}
                    value={goal}
                    placeholder="e.g. Draft a playful launch announcement with a CTA, for developers, under 150 words, then save it as launch.md"
                    onInput={(e) => setGoal((e.currentTarget as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            submit();
                        }
                        if (e.key === 'Escape') onClose();
                    }}
                />
                <div class="verzeta-modal__actions">
                    <button
                        type="button"
                        class="verzeta-modal__btn verzeta-modal__btn--secondary"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-modal__btn verzeta-modal__btn--primary"
                        onClick={submit}
                        disabled={goal.trim().length === 0}
                    >
                        Start task
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Host slash commands with one-line hints. The list mirrors the
 * host's SlashCommandService (and Android's kSlashCommands);
 * commands travel through the normal message.send path and their
 * output arrives as system rows. Shown while the draft is a
 * partial "/command" with no arguments yet.
 */
const SLASH_COMMANDS: readonly { readonly cmd: string; readonly hint: string }[] = [
    { cmd: '/help', hint: 'List available commands' },
    { cmd: '/compact', hint: 'Summarise older messages now (non-destructive)' },
    { cmd: '/flashmemory', hint: "Wipe this conversation's messages (asks to confirm)" },
    { cmd: '/artifacts', hint: 'List files this conversation produced' },
    { cmd: '/showtools', hint: 'List registered tools' },
    { cmd: '/showmcptools', hint: 'List MCP tools' },
    { cmd: '/tools', hint: 'Filter the tool list' },
    { cmd: '/clear', hint: 'Clear the visible transcript' },
];

function SlashCommandHints({
    draft,
    onPick,
}: {
    readonly draft: string;
    readonly onPick: (next: string) => void;
}) {
    const trimmed = draft.trimStart();
    if (!trimmed.startsWith('/') || trimmed.includes(' ')) return null;
    const matches = SLASH_COMMANDS.filter((c) =>
        c.cmd.toLowerCase().startsWith(trimmed.toLowerCase()),
    );
    if (matches.length === 0) return null;
    return (
        <div class="verzeta-composer__slash" role="listbox" aria-label="Slash commands">
            {matches.map((c) => (
                <button
                    key={c.cmd}
                    type="button"
                    role="option"
                    class="verzeta-composer__slashrow"
                    onClick={() => onPick(`${c.cmd} `)}
                >
                    <span class="verzeta-composer__slashcmd">{c.cmd}</span>
                    <span class="verzeta-composer__slashhint">{c.hint}</span>
                </button>
            ))}
        </div>
    );
}

function AttachmentStrip({
    attachments,
    onRemove,
    disabled,
}: {
    readonly attachments: readonly OutgoingAttachmentUi[];
    readonly onRemove: (index: number) => void;
    readonly disabled: boolean;
}) {
    return (
        <div class="verzeta-composer__attachments">
            {attachments.map((a, i) => (
                <AttachmentChip
                    key={`${a.fileName}:${i}`}
                    attachment={a}
                    onRemove={() => onRemove(i)}
                    disabled={disabled}
                />
            ))}
        </div>
    );
}

function AttachmentChip({
    attachment,
    onRemove,
    disabled,
}: {
    readonly attachment: OutgoingAttachmentUi;
    readonly onRemove: () => void;
    readonly disabled: boolean;
}) {
    const isImage = attachment.mimeType.startsWith('image/');
    const sizeLabel = formatBytes(attachment.rawBytes);
    return (
        <div class="verzeta-chip" role="group">
            <span class="verzeta-chip__icon" aria-hidden="true">
                {isImage ? (
                    <svg width="14" height="14" viewBox="0 0 24 24">
                        <path
                            d="M21 5H3a1 1 0 00-1 1v12a1 1 0 001 1h18a1 1 0 001-1V6a1 1 0 00-1-1zM5 17l4-5 3 4 4-5 4 6H5z"
                            fill="currentColor"
                        />
                    </svg>
                ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24">
                        <path
                            d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6zm0 7V4.5L19.5 10H14z"
                            fill="currentColor"
                        />
                    </svg>
                )}
            </span>
            <span class="verzeta-chip__name" title={attachment.fileName}>
                {truncate(attachment.fileName, 22)}
            </span>
            <span class="verzeta-chip__size">{sizeLabel}</span>
            <button
                type="button"
                class="verzeta-chip__remove"
                onClick={onRemove}
                disabled={disabled}
                aria-label={`Remove ${attachment.fileName}`}
                title="Remove"
            >
                ×
            </button>
        </div>
    );
}

function ComposerStatusBanner({
    state,
    convId,
}: {
    readonly state: string;
    readonly convId: string | undefined;
}) {
    if (convId === undefined) {
        return null;
    }
    let label: string;
    switch (state) {
        case 'connecting':
            label = 'Connecting to host…';
            break;
        case 'authenticating':
            label = 'Authenticating…';
            break;
        case 'reconnecting':
            label = 'Reconnecting…';
            break;
        case 'unauthorized':
            label = 'Unauthorized. Re-pair the host from Settings.';
            break;
        case 'error':
            label = 'Connection error. Check the Verzeta output channel.';
            break;
        case 'disconnected':
            label = 'Disconnected. Click Connect in Settings to send messages.';
            break;
        default:
            label = `Connection state: ${state}`;
    }
    return <div class="verzeta-composer__banner">{label}</div>;
}

type AttachmentReadResult =
    | { readonly kind: 'ok'; readonly attachment: OutgoingAttachmentUi }
    | { readonly kind: 'error'; readonly message: string };

async function readFileAsAttachment(file: File): Promise<AttachmentReadResult> {
    // Reject upfront on size — saves a costly FileReader pass for
    // obviously oversized files. The host re-validates after the
    // wire frame arrives.
    if (file.size <= 0) {
        return { kind: 'error', message: `"${file.name}" is empty.` };
    }
    if (file.size > MAX_CONTENT_BYTES) {
        return {
            kind: 'error',
            message: `"${file.name}" exceeds the ${MAX_CONTENT_BYTES / (1024 * 1024)} MiB per-attachment cap.`,
        };
    }
    // Filename safety mirrors host wire-session.cpp::stageBase64Upload.
    const safeName = file.name.trim();
    if (!isSafeUploadFileName(safeName)) {
        return {
            kind: 'error',
            message: unsafeFileNameMessage(file.name),
        };
    }
    try {
        const buffer = await file.arrayBuffer();
        const contentBase64 = encodeBase64(buffer);
        return {
            kind: 'ok',
            attachment: {
                fileName: safeName,
                mimeType: file.type.length > 0 ? file.type : 'application/octet-stream',
                rawBytes: file.size,
                contentBase64,
            },
        };
    } catch (error) {
        return {
            kind: 'error',
            message: `Failed to read "${file.name}": ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Encode an ArrayBuffer as standard base64. Uses chunked
 * String.fromCharCode + btoa to avoid stack-overflow on multi-MiB
 * buffers (RangeError on .apply with large arrays).
 */
function encodeBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(value: string, maxLen: number): string {
    if (value.length <= maxLen) return value;
    return `${value.slice(0, maxLen - 1)}…`;
}
