// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { ComponentChildren, JSX } from 'preact';
import { highlightLines } from './syntax.js';
import { send } from './bus.js';

type Token = TextToken | CodeBlockToken;

interface TextToken {
    readonly kind: 'text';
    readonly value: string;
}
interface CodeBlockToken {
    readonly kind: 'code';
    readonly lang: string;
    /**
     * Optional target-file hint parsed from the fence info string.
     * Two syntaxes are recognised:
     *
     *     ```typescript:src/foo.ts          (colon form)
     *     ```typescript path=src/foo.ts     (key=value form)
     *
     * When present, MessageBubble surfaces an "Apply" button on the
     * block that fires `ide.applyEditRequested` to write the block
     * back into the workspace as a vscode.WorkspaceEdit.
     */
    readonly targetPath: string;
    readonly code: string;
}

export function renderMarkdown(source: string): ComponentChildren {
    if (source.length === 0) return null;
    const tokens = tokenizeFences(source);
    const blocks: ComponentChildren[] = [];
    let blockIndex = 0;
    for (const token of tokens) {
        if (token.kind === 'code') {
            blocks.push(renderCodeBlock(token, blockIndex++));
            continue;
        }
        const inline = splitParagraphs(token.value);
        for (const chunk of inline) {
            const heading = matchHeading(chunk);
            if (heading !== undefined) {
                blocks.push(renderHeading(heading.level, heading.text, blockIndex++));
                continue;
            }
            const listKind = matchList(chunk);
            if (listKind !== undefined) {
                blocks.push(renderList(listKind.items, listKind.ordered, blockIndex++));
                continue;
            }
            blocks.push(
                <p class="md-p" key={`b${blockIndex++}`}>
                    {renderInline(chunk)}
                </p>,
            );
        }
    }
    return blocks;
}

/**
 * Render one fenced code block. Tries Shiki highlighting first; if
 * the language is unsupported (returns null) or any error occurs,
 * falls back to plain monospace text. The Preact tree is built from
 * `Token` records — no `dangerouslySetInnerHTML`, so the XSS
 * surface stays zero even if a model emits an unusual code block.
 */
function renderCodeBlock(token: CodeBlockToken, blockIndex: number): ComponentChildren {
    const lines = highlightLines(token.code, token.lang);
    const header =
        token.targetPath.length > 0 ? (
            <header class="md-code__header" key={`bh${blockIndex}`}>
                <span class="md-code__path" title={token.targetPath}>
                    {token.targetPath}
                </span>
                <button
                    type="button"
                    class="md-code__apply"
                    onClick={() =>
                        send({
                            type: 'ide.applyEditRequested',
                            targetPath: token.targetPath,
                            language: token.lang,
                            content: token.code,
                        })
                    }
                    title={`Apply this block as an edit to ${token.targetPath}`}
                >
                    Apply
                </button>
            </header>
        ) : null;
    if (lines === null) {
        return (
            <div class="md-code-wrap" key={`b${blockIndex}`}>
                {header}
                <pre class="md-code">
                    <code class={`md-lang-${escapeAttr(token.lang)}`}>{token.code}</code>
                </pre>
            </div>
        );
    }
    return (
        <div class="md-code-wrap" key={`b${blockIndex}`}>
            {header}
            <pre class="md-code">
                <code class={`md-lang-${escapeAttr(token.lang)}`}>
                    {lines.map((line, lineIdx) => (
                        <span class="md-code__line" key={`ln${lineIdx}`}>
                            {line.map((tok, tokIdx) => (
                                <span key={`tk${tokIdx}`} style={{ color: tok.color }}>
                                    {tok.content}
                                </span>
                            ))}
                            {lineIdx < lines.length - 1 ? '\n' : null}
                        </span>
                    ))}
                </code>
            </pre>
        </div>
    );
}

function tokenizeFences(source: string): readonly Token[] {
    const tokens: Token[] = [];
    // Accept the standard `lang` info string plus the two extended
    // forms used to mark an "Apply"-able code block:
    //     ```lang:path/to/file.ext
    //     ```lang path=path/to/file.ext
    // The path is restricted to a safe character set so a malicious
    // model output cannot break out of the marker.
    const FENCE = /```([a-zA-Z0-9_+-]*)([^\n]*)\n([\s\S]*?)```/g;
    let last = 0;
    for (let m = FENCE.exec(source); m !== null; m = FENCE.exec(source)) {
        const head = source.slice(last, m.index);
        if (head.length > 0) tokens.push({ kind: 'text', value: head });
        const lang = m[1] ?? '';
        const info = (m[2] ?? '').trim();
        const code = m[3] ?? '';
        tokens.push({ kind: 'code', lang, targetPath: parseTargetPath(info), code });
        last = FENCE.lastIndex;
    }
    if (last < source.length) {
        tokens.push({ kind: 'text', value: source.slice(last) });
    }
    return tokens;
}

function parseTargetPath(info: string): string {
    if (info.length === 0) return '';
    // `path=foo/bar.ts` (key=value form). Other key=value pairs are
    // ignored.
    const kv = /(?:^|\s)path=([^\s]+)/.exec(info);
    if (kv !== null && kv[1] !== undefined && isSafePath(kv[1])) return kv[1];
    // `:foo/bar.ts` (colon form — info starts with the path).
    if (info.startsWith(':')) {
        const candidate = info.slice(1).trim().split(/\s+/, 1)[0] ?? '';
        if (isSafePath(candidate)) return candidate;
    }
    return '';
}

function isSafePath(p: string): boolean {
    if (p.length === 0 || p.length > 512) return false;
    // No control / non-printable characters, no scheme prefixes, no
    // parent-traversal. Forward slash / backslash / dot are
    // allowed for path segments. Spaces are allowed (legitimate on
    // Windows-style paths).
    for (let i = 0; i < p.length; i++) {
        const ch = p.charCodeAt(i);
        if (ch < 0x20 || ch === 0x7f) return false;
    }
    if (p.includes('://')) return false;
    if (p.split(/[/\\]/).some((seg) => seg === '..')) return false;
    return true;
}

function splitParagraphs(value: string): readonly string[] {
    return value
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
}

function matchHeading(chunk: string): { level: 1 | 2 | 3; text: string } | undefined {
    const m = /^(#{1,3})\s+(.+)$/.exec(chunk);
    if (m === null) return undefined;
    const hashes = m[1] ?? '';
    const text = m[2] ?? '';
    const level = hashes.length === 1 ? 1 : hashes.length === 2 ? 2 : 3;
    return { level, text };
}

function renderHeading(level: 1 | 2 | 3, text: string, index: number): ComponentChildren {
    const children = renderInline(text);
    const key = `h${index}`;
    if (level === 1) {
        return (
            <h1 class="md-h1" key={key}>
                {children}
            </h1>
        );
    }
    if (level === 2) {
        return (
            <h2 class="md-h2" key={key}>
                {children}
            </h2>
        );
    }
    return (
        <h3 class="md-h3" key={key}>
            {children}
        </h3>
    );
}

function matchList(chunk: string): { ordered: boolean; items: readonly string[] } | undefined {
    const lines = chunk.split('\n');
    if (lines.length === 0) return undefined;
    const firstUnordered = /^\s*[-*]\s+(.*)$/.exec(lines[0] ?? '');
    const firstOrdered = /^\s*\d+\.\s+(.*)$/.exec(lines[0] ?? '');
    if (firstUnordered === null && firstOrdered === null) return undefined;
    const ordered = firstOrdered !== null;
    const items: string[] = [];
    for (const line of lines) {
        const m = ordered ? /^\s*\d+\.\s+(.*)$/.exec(line) : /^\s*[-*]\s+(.*)$/.exec(line);
        if (m === null) {
            // continuation line — append to last item
            if (items.length > 0) {
                items[items.length - 1] = `${items[items.length - 1] ?? ''} ${line.trim()}`;
            }
            continue;
        }
        items.push(m[1] ?? '');
    }
    return { ordered, items };
}

function renderList(items: readonly string[], ordered: boolean, index: number): ComponentChildren {
    const lis = items.map((item, i) => (
        <li class="md-li" key={`li${i}`}>
            {renderInline(item)}
        </li>
    ));
    const key = `l${index}`;
    return ordered ? (
        <ol class="md-ol" key={key}>
            {lis}
        </ol>
    ) : (
        <ul class="md-ul" key={key}>
            {lis}
        </ul>
    );
}

// Inline renderer — handles **bold**, *italic*, `code`, [link](url),
// and single newlines (rendered as <br/>). Built as a single pass
// over the segment; each match emits a VNode; remaining text is
// rendered as plain text (HTML-safe because Preact escapes children
// automatically).
function renderInline(segment: string): ComponentChildren {
    const out: ComponentChildren[] = [];
    let cursor = 0;
    let key = 0;
    while (cursor < segment.length) {
        const next = findNextToken(segment, cursor);
        if (next === undefined) {
            const tail = segment.slice(cursor);
            appendWithBreaks(out, tail, key);
            break;
        }
        if (next.start > cursor) {
            const head = segment.slice(cursor, next.start);
            appendWithBreaks(out, head, key++);
        }
        out.push(<span key={`k${key++}`}>{next.node}</span>);
        cursor = next.end;
    }
    return out;
}

interface InlineHit {
    readonly start: number;
    readonly end: number;
    readonly node: JSX.Element;
}

function findNextToken(segment: string, from: number): InlineHit | undefined {
    const candidates: InlineHit[] = [];
    const codeM = findAfter(segment, from, /`([^`]+)`/);
    if (codeM !== undefined) {
        candidates.push({
            start: codeM.start,
            end: codeM.end,
            node: <code class="md-icode">{codeM.groups[1] ?? ''}</code>,
        });
    }
    const linkM = findAfter(segment, from, /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    if (linkM !== undefined) {
        const text = linkM.groups[1] ?? '';
        const href = linkM.groups[2] ?? '';
        candidates.push({
            start: linkM.start,
            end: linkM.end,
            node: (
                <a class="md-a" href={href} rel="noreferrer" target="_blank">
                    {text}
                </a>
            ),
        });
    }
    const boldM = findAfter(segment, from, /\*\*([^*]+)\*\*/);
    if (boldM !== undefined) {
        candidates.push({
            start: boldM.start,
            end: boldM.end,
            node: <strong class="md-strong">{boldM.groups[1] ?? ''}</strong>,
        });
    }
    const italicM = findAfter(segment, from, /(?<![*])\*([^*]+)\*(?![*])/);
    if (italicM !== undefined) {
        candidates.push({
            start: italicM.start,
            end: italicM.end,
            node: <em class="md-em">{italicM.groups[1] ?? ''}</em>,
        });
    }
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => a.start - b.start);
    return candidates[0];
}

function findAfter(
    segment: string,
    from: number,
    pattern: RegExp,
): { start: number; end: number; groups: readonly string[] } | undefined {
    const slice = segment.slice(from);
    const m = pattern.exec(slice);
    if (m === null) return undefined;
    return {
        start: from + m.index,
        end: from + m.index + m[0].length,
        groups: m,
    };
}

function appendWithBreaks(out: ComponentChildren[], text: string, baseKey: number): void {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const part = lines[i] ?? '';
        if (part.length > 0) out.push(<span key={`t${baseKey}-${i}`}>{part}</span>);
        if (i < lines.length - 1) out.push(<br key={`br${baseKey}-${i}`} />);
    }
}

function escapeAttr(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
