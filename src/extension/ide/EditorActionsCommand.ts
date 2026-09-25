// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Editor AI actions — the extension-side mirror of the host's
 * `CanvasAiActions`: a small catalog of `{id, label, prompt}` action
 * descriptors that compose a deterministic chat message from the
 * editor's selection (+ file / language / optional diagnostic / optional
 * @-target) and send it to the active conversation. The agent does the
 * work with its EXISTING tools — no new chat tools are introduced.
 *
 * Surfaces (Code Actions, CodeLens, the editor submenu, agent routing)
 * all invoke the `verzeta.editorAction` command defined here, so the
 * "ensure a conversation first" gate and prompt composition live in one
 * place. Routing to the open conversation — and, when none is open,
 * prompting to create one (with a model pick) — is the cross-cutting
 * rule every editor action obeys.
 */

import * as vscode from 'vscode';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { ConversationStore } from '../conversations/ConversationStore.js';
import type { Logger } from '../log/Logger.js';
import type { RemoteRepository } from '../wire/RemoteRepository.js';
import type { VerzetaWebviewProvider } from '../webview/VerzetaWebviewProvider.js';
import { workspaceRelativePath } from './EditorBridge.js';
import {
    composePrompt,
    editorActionById,
    EDITOR_ACTIONS,
    type EditorAction,
    type EditorActionContext,
} from './EditorActionsCatalog.js';

export interface EditorActionsDeps {
    readonly provider: VerzetaWebviewProvider;
    readonly connectionManager: ConnectionManager;
    readonly conversationStore: ConversationStore;
    readonly logger: Logger;
}

interface ConvTarget {
    readonly hostId: string;
    readonly conversationId: string;
    readonly repository: RemoteRepository;
}

/**
 * Resolve the conversation an editor action targets. Active conversation
 * → use it. None → confirm + pick a model + create one. No connected
 * host → guide the user to connect.
 */
export async function ensureConversation(deps: EditorActionsDeps): Promise<ConvTarget | undefined> {
    const hostId = deps.connectionManager.activeHostId();
    if (hostId === undefined) {
        await vscode.window.showWarningMessage(
            'Verzeta: connect to a host from the Verzeta sidebar first.',
        );
        await deps.provider.reveal();
        return undefined;
    }
    const repository = deps.connectionManager.repositoryFor(hostId);
    if (repository === undefined) {
        await vscode.window.showWarningMessage('Verzeta: the active host is not connected.');
        return undefined;
    }
    const existing = deps.conversationStore.activeConversationId();
    if (existing !== undefined) return { hostId, conversationId: existing, repository };

    const choice = await vscode.window.showInformationMessage(
        'No active Verzeta conversation. Create one for this action?',
        { modal: true },
        'Create chat',
    );
    if (choice !== 'Create chat') return undefined;

    await pickAndSetModel(repository, deps.logger);

    let conversationId: string;
    try {
        conversationId = await repository.createConversation();
    } catch (err) {
        await vscode.window.showErrorMessage(
            `Verzeta: could not create a conversation. ${errText(err)}`,
        );
        return undefined;
    }
    deps.conversationStore.setActiveConversationId(conversationId);
    deps.provider.broadcast({ type: 'conversation.focusRequested', hostId, conversationId });
    return { hostId, conversationId, repository };
}

/** Quick-pick a model for a freshly created conversation. Skipping keeps
 *  the host's current default. */
async function pickAndSetModel(repository: RemoteRepository, logger: Logger): Promise<void> {
    let catalog;
    try {
        catalog = await repository.getModelCatalog();
    } catch {
        return;
    }
    interface ModelItem extends vscode.QuickPickItem {
        readonly providerId: string;
        readonly modelName: string;
    }
    const items: ModelItem[] = [];
    for (const p of catalog.providers) {
        for (const m of p.models) {
            items.push({
                label: m,
                description: p.displayName,
                picked: p.providerId === catalog.activeProvider && m === catalog.activeModel,
                providerId: p.providerId,
                modelName: m,
            });
        }
    }
    if (items.length === 0) return;
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Verzeta: pick a model for the new conversation',
        placeHolder: 'Model (skip to keep the current default)',
    });
    if (picked === undefined) return;
    try {
        await repository.setActiveModel(picked.providerId, picked.modelName);
    } catch (err) {
        logger.warn('EditorActions: setActiveModel failed', { error: errText(err) });
    }
}

/** Compose + send an action to an already-resolved conversation. */
export async function sendEditorAction(
    deps: EditorActionsDeps,
    target: ConvTarget,
    action: EditorAction,
    ctx: EditorActionContext,
): Promise<void> {
    const text = composePrompt(action, ctx);
    try {
        await target.repository.sendMessage(target.conversationId, text);
    } catch (err) {
        await vscode.window.showErrorMessage(
            `Verzeta: could not send the message. ${errText(err)}`,
        );
        return;
    }
    deps.provider.broadcast({
        type: 'conversation.focusRequested',
        hostId: target.hostId,
        conversationId: target.conversationId,
    });
    await deps.provider.reveal();
}

/** Compose + send an editor action to the (ensured) conversation. */
export async function runEditorAction(
    deps: EditorActionsDeps,
    action: EditorAction,
    ctx: EditorActionContext,
): Promise<void> {
    const target = await ensureConversation(deps);
    if (target === undefined) return;
    await sendEditorAction(deps, target, action, ctx);
}

function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Args the surface providers pass to `verzeta.editorAction`. */
export interface EditorActionArgs {
    readonly actionId: string;
    readonly uri: string;
    readonly range?:
        | { start: { line: number; character: number }; end: { line: number; character: number } }
        | undefined;
    readonly alias?: string | undefined;
    readonly diagnostic?: string | undefined;
}

export function registerEditorActionsCommands(deps: EditorActionsDeps): vscode.Disposable {
    return vscode.Disposable.from(
        vscode.commands.registerCommand('verzeta.editorAction', (args: unknown) =>
            runFromArgs(deps, args),
        ),
        vscode.commands.registerCommand('verzeta.askAgent', () => runAskAgent(deps)),
    );
}

/**
 * "Ask an agent about this" — routes the editor selection to a specific
 * member of a GROUP conversation (or @everyone) by prepending the
 * @-alias the host's mention router already understands. In a 1:1
 * conversation there is one agent, so no @-alias is used. Picks the
 * member first, then the action.
 */
async function runAskAgent(deps: EditorActionsDeps): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
        await vscode.window.showWarningMessage('Verzeta: open a file and select some code first.');
        return;
    }
    const range = editor.selection.isEmpty
        ? new vscode.Range(0, 0, editor.document.lineCount, 0)
        : editor.selection;
    const selection = editor.document.getText(range).trim();
    if (selection.length === 0) {
        await vscode.window.showWarningMessage(
            'Verzeta: nothing to ask about. Select some code first.',
        );
        return;
    }

    const target = await ensureConversation(deps);
    if (target === undefined) return;

    // Group conversation → let the user address a specific member or
    // everyone. 1:1 → single agent, no @-alias.
    let alias: string | undefined;
    let members: readonly { alias: string }[] = [];
    try {
        members = await target.repository.listConversationMembers(target.conversationId);
    } catch (err) {
        deps.logger.warn('AskAgent: listConversationMembers failed', { error: errText(err) });
    }
    if (members.length > 0) {
        interface MemberPick extends vscode.QuickPickItem {
            readonly alias: string;
        }
        const items: MemberPick[] = [
            { label: '@everyone', description: 'Address all members', alias: 'everyone' },
            ...members
                .filter((m) => m.alias.length > 0)
                .map((m) => ({ label: `@${m.alias}`, alias: m.alias })),
        ];
        const pick = await vscode.window.showQuickPick(items, {
            title: 'Verzeta: who should look at this?',
            placeHolder: 'Pick an agent (or everyone)',
        });
        if (pick === undefined) return;
        alias = pick.alias;
    }

    interface ActionPick extends vscode.QuickPickItem {
        readonly action: EditorAction;
    }
    const actionItems: ActionPick[] = EDITOR_ACTIONS.map((a) => ({ label: a.label, action: a }));
    const actionPick = await vscode.window.showQuickPick(actionItems, {
        title: 'Verzeta: what should they do?',
        placeHolder: 'Pick an action',
    });
    if (actionPick === undefined) return;

    await sendEditorAction(deps, target, actionPick.action, {
        relPath: workspaceRelativePath(editor.document.uri),
        language: editor.document.languageId,
        selection,
        alias,
    });
}

async function runFromArgs(deps: EditorActionsDeps, args: unknown): Promise<void> {
    if (typeof args !== 'object' || args === null) return;
    const a = args as Partial<EditorActionArgs>;
    if (typeof a.actionId !== 'string' || typeof a.uri !== 'string') return;
    const action = editorActionById(a.actionId);
    if (action === undefined) return;

    let uri: vscode.Uri;
    try {
        uri = vscode.Uri.parse(a.uri, true);
    } catch {
        return;
    }
    let doc: vscode.TextDocument;
    try {
        doc = await vscode.workspace.openTextDocument(uri);
    } catch {
        await vscode.window.showWarningMessage('Verzeta: could not open the file for this action.');
        return;
    }

    const range =
        a.range !== undefined
            ? new vscode.Range(
                  a.range.start.line,
                  a.range.start.character,
                  a.range.end.line,
                  a.range.end.character,
              )
            : new vscode.Range(0, 0, doc.lineCount, 0);
    const selection = doc.getText(range).trim();
    if (selection.length === 0) {
        await vscode.window.showWarningMessage(
            'Verzeta: nothing to act on. Select some code first.',
        );
        return;
    }

    await runEditorAction(deps, action, {
        relPath: workspaceRelativePath(uri),
        language: doc.languageId,
        selection,
        diagnostic: a.diagnostic,
        alias: a.alias,
    });
}
