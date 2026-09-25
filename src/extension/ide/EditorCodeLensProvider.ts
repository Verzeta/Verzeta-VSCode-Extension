// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Renders "Verzeta: Explain · Add tests · Refactor" CodeLens actions
 * above functions / methods / classes, using the document's symbol
 * provider to find their ranges. Each lens invokes the shared
 * `verzeta.editorAction` command with the symbol's range. Off by default
 * (the `verzeta.codeLens.enabled` setting) since CodeLens can clutter
 * the editor; toggling the setting refreshes live.
 */

import * as vscode from 'vscode';
import { CONFIG_SECTION, SETTING } from '../settings/ConfigurationSchema.js';

const LENS_ACTIONS: readonly { readonly id: string; readonly label: string }[] = [
    { id: 'explain', label: 'Explain' },
    { id: 'tests', label: 'Add tests' },
    { id: 'refactor', label: 'Refactor' },
];

const LENS_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Constructor,
]);

/** Cap the number of symbols we lens so large files stay responsive. */
const MAX_LENSED_SYMBOLS = 60;

function rangeArg(range: vscode.Range): {
    start: { line: number; character: number };
    end: { line: number; character: number };
} {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    };
}

export class EditorCodeLensProvider implements vscode.CodeLensProvider {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.changed.event;

    refresh(): void {
        this.changed.fire();
    }

    dispose(): void {
        this.changed.dispose();
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const enabled = vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<boolean>(SETTING.CODE_LENS_ENABLED, false);
        if (!enabled) return [];

        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri,
        );
        if (!Array.isArray(symbols)) return [];

        const lenses: vscode.CodeLens[] = [];
        let lensed = 0;
        const visit = (syms: readonly vscode.DocumentSymbol[]): void => {
            for (const s of syms) {
                if (lensed >= MAX_LENSED_SYMBOLS) return;
                if (LENS_KINDS.has(s.kind)) {
                    lensed += 1;
                    for (const a of LENS_ACTIONS) {
                        lenses.push(
                            new vscode.CodeLens(s.selectionRange, {
                                title: `Verzeta: ${a.label}`,
                                command: 'verzeta.editorAction',
                                arguments: [
                                    {
                                        actionId: a.id,
                                        uri: document.uri.toString(),
                                        range: rangeArg(s.range),
                                    },
                                ],
                            }),
                        );
                    }
                }
                if (s.children.length > 0) visit(s.children);
            }
        };
        visit(symbols);
        return lenses;
    }
}

export function registerEditorCodeLensProvider(): vscode.Disposable {
    const provider = new EditorCodeLensProvider();
    const reg = vscode.languages.registerCodeLensProvider(
        [{ scheme: 'file' }, { scheme: 'untitled' }],
        provider,
    );
    const cfg = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${CONFIG_SECTION}.${SETTING.CODE_LENS_ENABLED}`)) {
            provider.refresh();
        }
    });
    return vscode.Disposable.from(reg, cfg, provider);
}
