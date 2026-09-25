// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * `verzeta.addGitDiff` — stages the current repository's diff into the
 * chat composer as a fenced ```diff block, so the user can ask the
 * agent about their uncommitted work without copy-pasting. Prefers the
 * working-tree diff; falls back to the staged diff when the working
 * tree is clean. Large diffs are truncated with a note. Reaches the
 * built-in Git extension's API; degrades gracefully when Git is
 * unavailable.
 */

import * as vscode from 'vscode';
import type { VerzetaWebviewProvider } from '../webview/VerzetaWebviewProvider.js';

/** Cap so a huge diff cannot swamp the composer / prompt. */
const MAX_DIFF_CHARS = 60_000;

// Minimal shape of the built-in Git extension API (no @types ship for
// it; we only use these members).
interface GitExtensionExports {
    getAPI(version: 1): GitApi;
}
interface GitApi {
    readonly repositories: readonly GitRepository[];
}
interface GitRepository {
    readonly rootUri: vscode.Uri;
    diff(cached?: boolean): Promise<string>;
}

export interface GitContextCommandDeps {
    readonly provider: VerzetaWebviewProvider;
}

export function registerGitContextCommand(deps: GitContextCommandDeps): vscode.Disposable {
    return vscode.commands.registerCommand('verzeta.addGitDiff', () => runAddGitDiff(deps));
}

/** Loaded diff for a repository, with how it was sourced. */
export interface RepoDiff {
    readonly diff: string;
    readonly label: string;
    readonly repoName: string;
    readonly truncated: boolean;
}

/**
 * Resolve the active repository's diff via the built-in Git API. Tries
 * the preferred side first (staged vs working tree) and falls back to
 * the other; quick-picks the repo when a workspace has several. Caps the
 * size. Surfaces its own warnings and returns undefined when nothing is
 * available.
 */
export async function loadRepoDiff(preferStaged: boolean): Promise<RepoDiff | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (ext === undefined) {
        await vscode.window.showWarningMessage(
            'Verzeta: the built-in Git extension is not available.',
        );
        return undefined;
    }
    if (!ext.isActive) await ext.activate();
    const api = ext.exports.getAPI(1);
    if (api.repositories.length === 0) {
        await vscode.window.showWarningMessage(
            'Verzeta: no Git repository found in this workspace.',
        );
        return undefined;
    }

    const repo = await pickRepository(api.repositories);
    if (repo === undefined) return undefined;

    let label = preferStaged ? 'staged' : 'working tree';
    let diff = await repo.diff(preferStaged);
    if (diff.trim().length === 0) {
        diff = await repo.diff(!preferStaged);
        label = preferStaged ? 'working tree' : 'staged';
    }
    if (diff.trim().length === 0) {
        await vscode.window.showInformationMessage('Verzeta: no uncommitted changes found.');
        return undefined;
    }

    let truncated = false;
    if (diff.length > MAX_DIFF_CHARS) {
        diff = diff.slice(0, MAX_DIFF_CHARS);
        truncated = true;
    }
    const repoName = repo.rootUri.path.split('/').filter(Boolean).pop() ?? 'repository';
    return { diff, label, repoName, truncated };
}

async function runAddGitDiff(deps: GitContextCommandDeps): Promise<void> {
    const rd = await loadRepoDiff(false);
    if (rd === undefined) return;
    const note = rd.truncated ? ' (truncated)' : '';
    const composerText = `Git diff of ${rd.label} changes in ${rd.repoName}${note}:\n\n\`\`\`diff\n${rd.diff}\n\`\`\``;

    const delivered = deps.provider.broadcast({
        type: 'ide.stage',
        composerText,
        attachment: null,
        focusChat: true,
    });
    if (!delivered) {
        await vscode.window.showWarningMessage('Verzeta: opening the sidebar. Add the diff again.');
    }
    await deps.provider.reveal();
}

/** Single repo → use it; multiple → quick-pick by folder name. */
async function pickRepository(repos: readonly GitRepository[]): Promise<GitRepository | undefined> {
    if (repos.length === 1) return repos[0];
    interface RepoItem extends vscode.QuickPickItem {
        readonly repo: GitRepository;
    }
    const items: readonly RepoItem[] = repos.map((repo) => ({
        label: repo.rootUri.path.split('/').filter(Boolean).pop() ?? repo.rootUri.fsPath,
        description: repo.rootUri.fsPath,
        repo,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Verzeta: Add Git Diff',
        placeHolder: 'Pick a repository',
    });
    return picked?.repo;
}
