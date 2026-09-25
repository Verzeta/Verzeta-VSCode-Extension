// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Pure helpers used by `WorkspaceMountStatusBar.ts`. Split out so
 * unit tests can import them without the `vscode` module
 * dependency — the class file imports `* as vscode` for the
 * StatusBarItem + ThemeColor + ThemeIcon surface, which is
 * unresolvable in `node:test`.
 *
 * The class re-exports `STATUS_BAR_MENU_COMMAND` so callers can
 * continue importing it from the higher-level module.
 */

import * as path from 'node:path';
import type { PermissionTier, WorkspaceMountInfoUi } from '../../shared/wire-types.js';

export const STATUS_BAR_MENU_COMMAND = 'verzeta.workspaceMountStatusBarMenu';
export const STATUS_BAR_PRIORITY = 100;

export interface StatusBarLabel {
    readonly text: string;
    readonly tooltip: string;
}

/**
 * Builds the text + tooltip for an active mount.
 *
 * Examples:
 *
 *   info = { workspaceRoot: '/home/x/proj', ownerLabel: 'My Team',
 *            permissionTier: 'ask', fileCount: 42 }
 *
 *     text    = '$(link) Verzeta: proj <-> My Team  (ask)'
 *     tooltip = 'Verzeta workspace mount...'
 */
export function buildStatusBarLabel(info: WorkspaceMountInfoUi): StatusBarLabel {
    const tail = workspaceTail(info.workspaceRoot);
    const tierText = formatTier(info.permissionTier);
    const text = `$(link) Verzeta: ${tail} ↔ ${info.ownerLabel}  (${tierText})`;
    const tooltip = [
        'Verzeta workspace mount',
        `  Folder: ${info.ownerLabel}`,
        `  Workspace: ${info.workspaceRoot}`,
        `  Tier: ${tierText}`,
        `  Files (manifest): ${info.fileCount}`,
        '',
        'Click for actions.',
    ].join('\n');
    return { text, tooltip };
}

/**
 * Final path segment of `workspaceRoot`. Used in the status-bar
 * text where horizontal real estate is tight.
 */
export function workspaceTail(workspaceRoot: string): string {
    if (workspaceRoot.length === 0) return '(workspace)';
    const trimmed = workspaceRoot.replace(/[/\\]+$/, '');
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    if (idx === -1) return trimmed;
    return trimmed.slice(idx + 1) || trimmed;
}

/**
 * Display string for the tier. Kept as a function (not just a map)
 * so future localisation can be slotted in without touching the
 * status-bar render path.
 */
export function formatTier(tier: PermissionTier): string {
    switch (tier) {
        case 'ask':
            return 'ask';
        case 'smart':
            return 'smart';
        case 'bypass':
            return 'bypass';
    }
}

/**
 * Normalises a vscode workspace folder URI fsPath. Exposed so the
 * command flow (manual register) and the status bar see the same
 * canonical-tail string.
 */
export function tailFromFsPath(fsPath: string): string {
    return workspaceTail(fsPath.split(path.sep).join('/'));
}
