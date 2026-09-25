// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * `verzeta.sendSelectionToChat` — reads the active editor's
 * selection, formats it as a fenced markdown block prefixed by a
 * `From <relative-path> (lines N-M):` header, and stages it onto
 * the chat composer via the `ide.stage` envelope. Reveals the
 * Verzeta sidebar afterwards so the user lands on the staged text.
 *
 * Reachable from:
 *   - Editor right-click menu (`editor/context` with
 *     `editorHasSelection && verzeta.connected`)
 *   - Command Palette
 *   - Any future keybinding the user configures
 */

import * as vscode from 'vscode';
import type { VerzetaWebviewProvider } from '../webview/VerzetaWebviewProvider.js';
import { buildSelectionInsert } from './EditorBridge.js';

export interface SendSelectionCommandDeps {
    readonly provider: VerzetaWebviewProvider;
}

export function registerSendSelectionCommand(deps: SendSelectionCommandDeps): vscode.Disposable {
    return vscode.commands.registerCommand('verzeta.sendSelectionToChat', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            await vscode.window.showWarningMessage('Verzeta: no active editor. Open a file first.');
            return;
        }
        const insert = buildSelectionInsert(editor);
        if (insert === undefined) {
            await vscode.window.showWarningMessage(
                'Verzeta: nothing selected. Highlight some text first.',
            );
            return;
        }
        const delivered = deps.provider.broadcast({
            type: 'ide.stage',
            composerText: insert.composerText,
            attachment: null,
            focusChat: true,
        });
        if (!delivered) {
            await vscode.window.showWarningMessage(
                'Verzeta: opening the sidebar. Send the selection again.',
            );
        }
        await deps.provider.reveal();
    });
}
