// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * `verzeta.generateCommitMessage` — asks the active conversation to draft
 * a commit message for the staged (or working-tree) diff. Chat-first:
 * the agent replies in the conversation; the user copies the message
 * into the SCM box. Reuses the shared conversation gate and the Git
 * diff loader.
 */

import * as vscode from 'vscode';
import { loadRepoDiff } from './GitContextCommand.js';
import {
    ensureConversation,
    sendEditorAction,
    type EditorActionsDeps,
} from './EditorActionsCommand.js';
import type { EditorAction } from './EditorActionsCatalog.js';

const COMMIT_MESSAGE_ACTION: EditorAction = {
    id: 'commitMessage',
    label: 'Commit message',
    prompt:
        'Write a concise, conventional git commit message for these staged changes in ' +
        '{path}: a short imperative subject line, then an optional body explaining ' +
        'the why. Reply with only the commit message:\n\n```diff\n{sel}\n```',
};

export function registerCommitMessageCommand(deps: EditorActionsDeps): vscode.Disposable {
    return vscode.commands.registerCommand('verzeta.generateCommitMessage', () =>
        runGenerateCommitMessage(deps),
    );
}

async function runGenerateCommitMessage(deps: EditorActionsDeps): Promise<void> {
    // Load the diff first so we don't prompt to create a chat when there
    // is nothing to describe. Staged changes take precedence.
    const rd = await loadRepoDiff(true);
    if (rd === undefined) return;
    const target = await ensureConversation(deps);
    if (target === undefined) return;
    await sendEditorAction(deps, target, COMMIT_MESSAGE_ACTION, {
        relPath: rd.repoName,
        language: 'diff',
        selection: rd.diff,
    });
}
