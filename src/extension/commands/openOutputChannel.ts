// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * `verzeta.openOutputChannel` — reveal the Verzeta output channel
 * in VS Code's bottom panel. The Logger module owns the channel
 * instance; this command just calls `Logger.show()`.
 *
 * Reached from Settings → "Open output channel" row (which posts a
 * `host.commandRequested` envelope from the webview). The command
 * is allow-listed in `WebviewSync.ALLOWED_COMMANDS` so the webview
 * can dispatch it.
 */

import * as vscode from 'vscode';
import type { Logger } from '../log/Logger.js';

export function registerOpenOutputChannel(logger: Logger): vscode.Disposable {
    return vscode.commands.registerCommand('verzeta.openOutputChannel', () => {
        logger.show(true);
    });
}
