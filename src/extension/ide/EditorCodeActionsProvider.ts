// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Surfaces the editor AI-action catalog as lightbulb Code Actions
 * (Ctrl+.). On a non-empty selection it offers "Verzeta: Explain / Fix
 * bugs / Refactor / Add tests / Add docs"; when the selection overlaps a
 * diagnostic it also offers "Verzeta: Fix this problem" with the
 * diagnostic text. Every action is a thin wrapper around the
 * `verzeta.editorAction` command (the catalog + conversation gate live
 * in EditorActionsCommand.ts).
 */

import * as vscode from 'vscode';
import { EDITOR_ACTIONS, DIAGNOSTIC_ACTION } from './EditorActionsCatalog.js';

function rangeArg(range: vscode.Range): {
    start: { line: number; character: number };
    end: { line: number; character: number };
} {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    };
}

export class EditorCodeActionsProvider implements vscode.CodeActionProvider {
    static readonly kinds: readonly vscode.CodeActionKind[] = [
        vscode.CodeActionKind.RefactorRewrite,
        vscode.CodeActionKind.QuickFix,
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Diagnostics-driven fix (highest priority — shows at the top on
        // a squiggle). Composed from the diagnostics in scope.
        if (context.diagnostics.length > 0) {
            const messages = context.diagnostics.map((d) => d.message).join('; ');
            const diagRange = context.diagnostics[0]?.range ?? range;
            const fix = new vscode.CodeAction(
                'Verzeta: Fix this problem',
                vscode.CodeActionKind.QuickFix,
            );
            fix.diagnostics = [...context.diagnostics];
            fix.command = {
                command: 'verzeta.editorAction',
                title: 'Fix this problem',
                arguments: [
                    {
                        actionId: DIAGNOSTIC_ACTION.id,
                        uri: document.uri.toString(),
                        range: rangeArg(diagRange),
                        diagnostic: messages,
                    },
                ],
            };
            actions.push(fix);
        }

        // Selection transforms — only with a real selection.
        if (!range.isEmpty) {
            for (const a of EDITOR_ACTIONS) {
                const action = new vscode.CodeAction(
                    `Verzeta: ${a.label}`,
                    vscode.CodeActionKind.RefactorRewrite,
                );
                action.command = {
                    command: 'verzeta.editorAction',
                    title: a.label,
                    arguments: [
                        {
                            actionId: a.id,
                            uri: document.uri.toString(),
                            range: rangeArg(range),
                        },
                    ],
                };
                actions.push(action);
            }
        }

        return actions;
    }
}

export function registerEditorCodeActionsProvider(): vscode.Disposable {
    return vscode.languages.registerCodeActionsProvider(
        [{ scheme: 'file' }, { scheme: 'untitled' }],
        new EditorCodeActionsProvider(),
        { providedCodeActionKinds: [...EditorCodeActionsProvider.kinds] },
    );
}
