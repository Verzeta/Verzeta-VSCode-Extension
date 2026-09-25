// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';
import type { Logger } from '../log/Logger.js';
import type { VerzetaWebviewProvider } from '../webview/VerzetaWebviewProvider.js';

export interface ApplyEditCommandDeps {
    readonly provider: VerzetaWebviewProvider;
    readonly logger: Logger;
}

export function registerApplyEditCommand(deps: ApplyEditCommandDeps): vscode.Disposable {
    return vscode.commands.registerCommand('verzeta.applyEdit', async (rawArgs: unknown) => {
        const args = parseArgs(rawArgs);
        if (args === undefined) {
            await vscode.window.showErrorMessage(
                'Verzeta: apply-edit was invoked without a valid payload.',
            );
            return;
        }
        await runApply(deps, args);
    });
}

interface ApplyArgs {
    readonly targetPath: string;
    readonly language: string;
    readonly content: string;
}

function parseArgs(raw: unknown): ApplyArgs | undefined {
    if (raw === null || typeof raw !== 'object') return undefined;
    const obj = raw as Record<string, unknown>;
    const targetPath = obj['targetPath'];
    const language = obj['language'];
    const content = obj['content'];
    if (
        typeof targetPath !== 'string' ||
        targetPath.length === 0 ||
        typeof language !== 'string' ||
        typeof content !== 'string'
    ) {
        return undefined;
    }
    return { targetPath, language, content };
}

async function runApply(deps: ApplyEditCommandDeps, args: ApplyArgs): Promise<void> {
    const resolved = await resolveTargetUri(args.targetPath);
    if (resolved === undefined) {
        await vscode.window.showErrorMessage(
            `Verzeta: could not resolve "${args.targetPath}" against any open workspace folder. Open the project folder first.`,
        );
        return;
    }
    const existing = await readIfExists(resolved);
    if (existing !== undefined && existing === args.content) {
        await vscode.window.showInformationMessage(
            `Verzeta: "${args.targetPath}" already matches the suggestion. Nothing to apply.`,
        );
        return;
    }
    if (existing !== undefined) {
        const goAhead = await previewAndConfirm(resolved, args.content, args.language);
        if (!goAhead) return;
    } else {
        const goAhead = await vscode.window.showInformationMessage(
            `Verzeta: create "${args.targetPath}" with the suggested content?`,
            { modal: true },
            'Create',
        );
        if (goAhead !== 'Create') return;
    }

    const edit = new vscode.WorkspaceEdit();
    if (existing === undefined) {
        edit.createFile(resolved, { ignoreIfExists: false, overwrite: false });
        edit.insert(resolved, new vscode.Position(0, 0), args.content);
    } else {
        const doc = await vscode.workspace.openTextDocument(resolved);
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(resolved, fullRange, args.content);
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
        deps.logger.warn('verzeta.applyEdit: applyEdit returned false', {
            targetPath: args.targetPath,
        });
        deps.provider.broadcast({
            type: 'ide.notice',
            level: 'error',
            message: `Could not apply the edit to ${args.targetPath}. VS Code rejected it.`,
        });
        return;
    }
    // Open the resulting document so the user immediately sees the
    // applied change.
    const opened = await vscode.workspace.openTextDocument(resolved);
    await vscode.window.showTextDocument(opened, { preview: false });
    deps.provider.broadcast({
        type: 'ide.notice',
        level: 'info',
        message: `Applied to ${args.targetPath}.`,
    });
}

async function resolveTargetUri(targetPath: string): Promise<vscode.Uri | undefined> {
    // Absolute URI / path support — useful for monorepo scenarios
    // where the assistant emits an absolute path.
    if (targetPath.startsWith('file://')) {
        try {
            return vscode.Uri.parse(targetPath, true);
        } catch {
            return undefined;
        }
    }
    if (targetPath.startsWith('/')) {
        return vscode.Uri.file(targetPath);
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return undefined;
    const first = folders[0];
    if (folders.length === 1 && first !== undefined) {
        return vscode.Uri.joinPath(first.uri, ...splitPath(targetPath));
    }
    // Multi-root workspace — let the user pick which root to resolve
    // against. Reuses VS Code's quick-pick UI so the experience
    // matches "Open File" / "Reveal in Explorer" etc.
    const pick = await vscode.window.showQuickPick(
        folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
        {
            placeHolder: `Pick the workspace folder to resolve "${targetPath}" against`,
            title: 'Verzeta: Apply Edit',
        },
    );
    if (pick === undefined) return undefined;
    return vscode.Uri.joinPath(pick.folder.uri, ...splitPath(targetPath));
}

function splitPath(p: string): readonly string[] {
    return p
        .replace(/\\/g, '/')
        .split('/')
        .filter((s) => s.length > 0);
}

async function readIfExists(uri: vscode.Uri): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        return undefined;
    }
}

async function previewAndConfirm(
    uri: vscode.Uri,
    nextContent: string,
    language: string,
): Promise<boolean> {
    // Open a side-by-side diff between the current file and an
    // in-memory "proposed" document. The proposed view lives behind
    // a one-off untitled URI so VS Code's built-in diff command
    // renders it correctly.
    const proposedUri = uri.with({
        scheme: 'untitled',
        path: uri.path + '.verzeta-proposed',
    });
    const proposedDoc = await vscode.workspace.openTextDocument(proposedUri);
    const editor = await vscode.window.showTextDocument(proposedDoc, { preview: true });
    await editor.edit((e) => e.insert(new vscode.Position(0, 0), nextContent));
    if (language.length > 0) {
        try {
            await vscode.languages.setTextDocumentLanguage(proposedDoc, language);
        } catch {
            // VS Code rejects unknown language ids; the proposed
            // diff still renders fine with the default text language.
        }
    }
    await vscode.commands.executeCommand('vscode.diff', uri, proposedUri, 'Verzeta proposed edit');

    const choice = await vscode.window.showInformationMessage(
        'Verzeta: apply the highlighted edit to this file?',
        { modal: true },
        'Apply',
    );
    // Best-effort cleanup of the scratch document. If the user
    // closes the diff manually, this no-ops.
    await vscode.commands
        .executeCommand('workbench.action.closeActiveEditor')
        .then(undefined, () => undefined);
    return choice === 'Apply';
}
