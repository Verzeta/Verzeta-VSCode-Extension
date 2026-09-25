// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Three file-attachment commands sharing the same underlying load
 * + stage flow:
 *
 *   - `verzeta.attachActiveFile` — attach the currently-active
 *     editor's document.
 *   - `verzeta.attachFile` — invoked from the Explorer context
 *     menu; takes a vscode.Uri (single-file form) or a list
 *     (multi-select form) as its argument.
 *   - `verzeta.attachOpenFiles` — quick-pick over every currently-
 *     open text editor so the user can multi-select without
 *     leaving the keyboard.
 *
 * All three call into the same shared helper which loads the file
 * via vscode.workspace.fs, builds the attachment payload, and
 * stages it through the webview's `ide.stage` envelope.
 */

import * as vscode from 'vscode';
import type { VerzetaWebviewProvider } from '../webview/VerzetaWebviewProvider.js';
import { loadFileAttachment, workspaceRelativePath, MAX_FILE_BYTES } from './EditorBridge.js';

export interface AttachFileCommandDeps {
    readonly provider: VerzetaWebviewProvider;
}

export function registerAttachFileCommands(
    deps: AttachFileCommandDeps,
): readonly vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('verzeta.attachActiveFile', () => runAttachActive(deps)),
        vscode.commands.registerCommand('verzeta.attachFile', (uri: unknown, uris: unknown) =>
            runAttachFromExplorer(deps, uri, uris),
        ),
        vscode.commands.registerCommand('verzeta.attachOpenFiles', () => runAttachOpenFiles(deps)),
        vscode.commands.registerCommand('verzeta.addContext', () => runAddContext(deps)),
        vscode.commands.registerCommand('verzeta.attachUris', (uris: unknown) =>
            runAttachUris(deps, uris),
        ),
    ];
}

/**
 * Stage a list of file URIs (strings) — used by the composer's
 * drag-and-drop from the VS Code Explorer / editor. Non-file or
 * malformed URIs are skipped.
 */
async function runAttachUris(deps: AttachFileCommandDeps, uris: unknown): Promise<void> {
    if (!Array.isArray(uris)) return;
    const parsed: vscode.Uri[] = [];
    for (const raw of uris) {
        if (typeof raw !== 'string' || raw.length === 0) continue;
        try {
            const uri = vscode.Uri.parse(raw, true);
            if (uri.scheme === 'file') parsed.push(uri);
        } catch {
            // Skip unparseable entries.
        }
    }
    if (parsed.length === 0) return;
    await stageMany(deps, parsed);
}

/**
 * "Add Context" — a multi-select quick-pick over the WORKSPACE's files
 * (not just the open ones), so the user attaches project files from
 * inside VS Code without the OS file dialog. Reuses the same staging
 * pipeline as the other attach commands. Common build/vendor dirs are
 * excluded and the candidate list is capped so the picker stays fast.
 */
async function runAddContext(deps: AttachFileCommandDeps): Promise<void> {
    const exclude = '{**/.git/**,**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.cache/**}';
    const uris = await vscode.workspace.findFiles('**/*', exclude, 4000);
    if (uris.length === 0) {
        await vscode.window.showWarningMessage(
            'Verzeta: no workspace files found. Open a folder first, or use Add Files.',
        );
        return;
    }
    interface QuickPickFile extends vscode.QuickPickItem {
        readonly uri: vscode.Uri;
    }
    const items: readonly QuickPickFile[] = uris
        .map((uri) => ({ label: workspaceRelativePath(uri), picked: false, uri }))
        .sort((a, b) => a.label.localeCompare(b.label));
    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        matchOnDescription: true,
        placeHolder: 'Search workspace files to attach as context',
        title: 'Verzeta: Add Context',
    });
    if (picked === undefined || picked.length === 0) return;
    await stageMany(
        deps,
        picked.map((p) => p.uri),
    );
}

async function runAttachActive(deps: AttachFileCommandDeps): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
        await vscode.window.showWarningMessage('Verzeta: no active editor. Open a file first.');
        return;
    }
    await stageOne(deps, editor.document.uri);
}

async function runAttachFromExplorer(
    deps: AttachFileCommandDeps,
    uri: unknown,
    uris: unknown,
): Promise<void> {
    // VS Code passes a single URI for single-file context-menu
    // invocations and an array as the second arg for multi-select.
    // We trust the latter when present (it includes every selected
    // file) and fall back to the single URI otherwise.
    const list = collectUris(uris) ?? collectUris(uri);
    if (list === undefined || list.length === 0) {
        await vscode.window.showWarningMessage(
            'Verzeta: no file picked. Run this from the Explorer right-click menu.',
        );
        return;
    }
    await stageMany(deps, list);
}

async function runAttachOpenFiles(deps: AttachFileCommandDeps): Promise<void> {
    const openDocs = vscode.workspace.textDocuments.filter(
        (d) => d.uri.scheme === 'file' && !d.isUntitled,
    );
    if (openDocs.length === 0) {
        await vscode.window.showWarningMessage(
            'Verzeta: no open files. Open one, or use Attach Active File.',
        );
        return;
    }
    interface QuickPickFile extends vscode.QuickPickItem {
        readonly uri: vscode.Uri;
    }
    const items: readonly QuickPickFile[] = openDocs.map((d) => ({
        label: workspaceRelativePath(d.uri),
        description: `${d.languageId} · ${(d.getText().length / 1024).toFixed(1)} KiB`,
        picked: false,
        uri: d.uri,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Pick open files to attach to Verzeta chat',
        title: 'Verzeta: Attach Open Files',
    });
    if (picked === undefined || picked.length === 0) return;
    await stageMany(
        deps,
        picked.map((p) => p.uri),
    );
}

async function stageOne(deps: AttachFileCommandDeps, uri: vscode.Uri): Promise<void> {
    const result = await loadFileAttachment(uri);
    if (result.kind === 'too_large') {
        await vscode.window.showErrorMessage(
            `Verzeta: ${workspaceRelativePath(uri)} is ${(result.bytes / (1024 * 1024)).toFixed(1)} MiB, which exceeds the ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MiB per-attachment cap.`,
        );
        return;
    }
    if (result.kind === 'unreadable') {
        await vscode.window.showErrorMessage(
            `Verzeta: could not read ${workspaceRelativePath(uri)}. ${result.reason}`,
        );
        return;
    }
    const delivered = deps.provider.broadcast({
        type: 'ide.stage',
        composerText: '',
        attachment: result.attachment,
        focusChat: true,
    });
    if (!delivered) {
        await vscode.window.showWarningMessage(
            'Verzeta: opening the sidebar. If the attachment chip is missing, attach the file again.',
        );
    }
    await deps.provider.reveal();
}

async function stageMany(deps: AttachFileCommandDeps, uris: readonly vscode.Uri[]): Promise<void> {
    // Stage each file in sequence so per-file errors surface
    // independently (the webview's chip UI shows the successes
    // even if a later file errors).
    for (const uri of uris) {
        await stageOne(deps, uri);
    }
}

function collectUris(value: unknown): readonly vscode.Uri[] | undefined {
    if (value instanceof vscode.Uri) return [value];
    if (Array.isArray(value)) {
        const out: vscode.Uri[] = [];
        for (const item of value) {
            if (item instanceof vscode.Uri) out.push(item);
        }
        return out.length > 0 ? out : undefined;
    }
    return undefined;
}
