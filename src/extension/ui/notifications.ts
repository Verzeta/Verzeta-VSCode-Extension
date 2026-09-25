// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * notifications — thin wrappers around vscode.window.showXyzMessage
 * with consistent labelling and a single seam for testing.
 *
 * Error notifications always log to the supplied Logger as well, so
 * the message is captured in the output channel even if the user
 * dismisses the toast.
 */

import * as vscode from 'vscode';
import type { Logger } from '../log/Logger.js';

const PREFIX = 'Verzeta';

export function showInfo(message: string): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(`${PREFIX}: ${message}`);
}

export function showWarning(message: string, logger?: Logger): Thenable<string | undefined> {
    logger?.warn(message);
    return vscode.window.showWarningMessage(`${PREFIX}: ${message}`);
}

export function showError(message: string, logger?: Logger): Thenable<string | undefined> {
    logger?.error(message);
    return vscode.window.showErrorMessage(`${PREFIX}: ${message}`);
}

/**
 * Shows an information toast with action buttons; resolves with
 * the selected button label or undefined if dismissed.
 */
export function showInfoWithActions(
    message: string,
    ...actions: readonly string[]
): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(`${PREFIX}: ${message}`, ...actions);
}

export function showErrorWithActions(
    message: string,
    logger: Logger | undefined,
    ...actions: readonly string[]
): Thenable<string | undefined> {
    logger?.error(message);
    return vscode.window.showErrorMessage(`${PREFIX}: ${message}`, ...actions);
}
