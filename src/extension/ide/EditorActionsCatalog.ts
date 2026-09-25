// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Pure catalog + prompt composition for the editor AI actions (mirrors
 * the host's CanvasAiActions descriptor model). Kept free of any VS Code
 * dependency so the substitution logic is unit-testable; the command
 * wiring lives in EditorActionsCommand.ts.
 */

export interface EditorAction {
    readonly id: string;
    readonly label: string;
    /** Prompt template — {path} {lang} {sel} {diag} are substituted. */
    readonly prompt: string;
}

/** The selection-driven action catalog. */
export const EDITOR_ACTIONS: readonly EditorAction[] = [
    {
        id: 'explain',
        label: 'Explain',
        prompt: 'Explain what this {lang} code from {path} does:\n\n```{lang}\n{sel}\n```',
    },
    {
        id: 'fix',
        label: 'Fix bugs',
        prompt:
            'Find and fix any bugs in this {lang} code from {path}. Show the corrected ' +
            'code and explain the fix:\n\n```{lang}\n{sel}\n```',
    },
    {
        id: 'refactor',
        label: 'Refactor',
        prompt:
            'Refactor this {lang} code from {path} for clarity and maintainability, ' +
            'preserving its behaviour:\n\n```{lang}\n{sel}\n```',
    },
    {
        id: 'tests',
        label: 'Add tests',
        prompt: 'Write unit tests for this {lang} code from {path}:\n\n```{lang}\n{sel}\n```',
    },
    {
        id: 'docs',
        label: 'Add docs',
        prompt:
            'Add clear doc comments to this {lang} code from {path}, returning the ' +
            'documented code:\n\n```{lang}\n{sel}\n```',
    },
];

/** The diagnostics-driven "fix this problem" action. */
export const DIAGNOSTIC_ACTION: EditorAction = {
    id: 'fixProblem',
    label: 'Fix this problem',
    prompt: 'Fix this problem in {path}.\n\nProblem: {diag}\n\nCode:\n\n```{lang}\n{sel}\n```',
};

export function editorActionById(id: string): EditorAction | undefined {
    if (id === DIAGNOSTIC_ACTION.id) return DIAGNOSTIC_ACTION;
    return EDITOR_ACTIONS.find((a) => a.id === id);
}

export interface EditorActionContext {
    readonly relPath: string;
    readonly language: string;
    readonly selection: string;
    readonly diagnostic?: string | undefined;
    /** @-alias to address a specific group member. */
    readonly alias?: string | undefined;
}

/** Substitute all template placeholders; prepend an @-alias when set. */
export function composePrompt(action: EditorAction, ctx: EditorActionContext): string {
    const sub = (text: string, token: string, value: string): string =>
        text.split(token).join(value);
    let text = action.prompt;
    text = sub(text, '{path}', ctx.relPath);
    text = sub(text, '{lang}', ctx.language);
    text = sub(text, '{sel}', ctx.selection);
    text = sub(text, '{diag}', ctx.diagnostic ?? '');
    if (ctx.alias !== undefined && ctx.alias.length > 0) {
        text = `@${ctx.alias} ${text}`;
    }
    return text;
}
