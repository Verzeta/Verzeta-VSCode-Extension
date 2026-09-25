// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Syntax highlighting for fenced code blocks. Uses Shiki 4.1.0 via
 * its fine-grained `shiki/core` API so the webview bundle only
 * carries the languages + themes we actually need (TS/TSX/JS/JSX,
 * Python, Bash, JSON, CSS, HTML, diff + GitHub dark/light themes).
 *
 * Shiki is the same highlighter VS Code itself uses (TextMate
 * grammars + theme JSON), so the colours match what the user sees
 * in the real editor.
 *
 * Engine choice: `createJavaScriptRegexEngine` (no wasm). The
 * Oniguruma wasm engine ships ~250 KB extra; the JS regex engine
 * is fully supported for every grammar we load and keeps the
 * bundle smaller. If we ever add a grammar that needs an
 * Oniguruma-only feature, swap to `createOnigurumaEngine`.
 *
 * Output shape: `Token[][]` — array of lines, each line an array
 * of tokens with `{content, color}`. The caller renders each
 * token as a span with `style={{ color }}` so we NEVER inject
 * raw HTML (`dangerouslySetInnerHTML`) and the XSS surface stays
 * zero — same posture as the rest of the markdown renderer.
 */

import { createHighlighterCoreSync, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import typescript from 'shiki/langs/typescript.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import python from 'shiki/langs/python.mjs';
import bash from 'shiki/langs/bash.mjs';
import json from 'shiki/langs/json.mjs';
import css from 'shiki/langs/css.mjs';
import html from 'shiki/langs/html.mjs';
import diff from 'shiki/langs/diff.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';

export interface HToken {
    readonly content: string;
    readonly color: string;
}

let highlighter: HighlighterCore | null = null;

function getHighlighter(): HighlighterCore {
    if (highlighter === null) {
        highlighter = createHighlighterCoreSync({
            themes: [githubDark, githubLight],
            langs: [typescript, tsx, javascript, jsx, python, bash, json, css, html, diff],
            engine: createJavaScriptRegexEngine(),
        });
    }
    return highlighter;
}

/**
 * Detect which theme bucket the current VS Code colour theme falls
 * into. VS Code exposes `vscode-dark` / `vscode-high-contrast` /
 * `vscode-light` classes on the webview's `<body>` — we read them
 * directly. Defaults to `dark` if anything goes wrong (theme name
 * unknown, body not yet attached, etc.).
 */
function detectTheme(): 'light' | 'dark' {
    try {
        const cls = document.body.classList;
        if (cls.contains('vscode-light')) return 'light';
        return 'dark';
    } catch {
        return 'dark';
    }
}

const ALIAS: Record<string, string> = {
    ts: 'typescript',
    js: 'javascript',
    jsx: 'jsx',
    tsx: 'tsx',
    py: 'python',
    py3: 'python',
    python3: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'json',
    yaml: 'json',
    xml: 'html',
    svg: 'html',
    patch: 'diff',
};

const SUPPORTED: ReadonlySet<string> = new Set([
    'typescript',
    'tsx',
    'javascript',
    'jsx',
    'python',
    'bash',
    'json',
    'css',
    'html',
    'diff',
]);

/**
 * Tokenise a code block for rendering. Returns `null` when the
 * language is unknown / unsupported / empty so the caller can
 * fall back to plain monospace text.
 */
export function highlightLines(
    code: string,
    langRaw: string,
): readonly (readonly HToken[])[] | null {
    if (code.length === 0) return null;
    const normalised = ALIAS[langRaw.toLowerCase()] ?? langRaw.toLowerCase();
    if (!SUPPORTED.has(normalised)) return null;
    try {
        const themeName = detectTheme() === 'dark' ? 'github-dark' : 'github-light';
        const lines = getHighlighter().codeToTokensBase(code, {
            lang: normalised,
            theme: themeName,
        });
        return lines.map((line) =>
            line.map((tok) => ({ content: tok.content, color: tok.color ?? 'inherit' })),
        );
    } catch {
        return null;
    }
}
