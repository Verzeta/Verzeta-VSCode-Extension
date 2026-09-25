// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { ConversationStore } from '../conversations/ConversationStore.js';
import type { Logger } from '../log/Logger.js';
import type { VerzetaWebviewProvider } from '../webview/VerzetaWebviewProvider.js';
import { registerSendSelectionCommand } from './SendSelectionCommand.js';
import { registerAttachFileCommands } from './AttachFileCommand.js';
import { registerApplyEditCommand } from './ApplyEditCommand.js';
import { registerGitContextCommand } from './GitContextCommand.js';
import { registerEditorActionsCommands } from './EditorActionsCommand.js';
import { registerEditorCodeActionsProvider } from './EditorCodeActionsProvider.js';
import { registerEditorCodeLensProvider } from './EditorCodeLensProvider.js';
import { registerCommitMessageCommand } from './CommitMessageCommand.js';
import { registerTerminalContextCommand } from './TerminalContextCommand.js';
import {
    CANVAS_SCHEME,
    CanvasDocumentProvider,
    registerOpenCanvasCommand,
} from './CanvasDocumentProvider.js';

export interface IdeBridgeDeps {
    readonly provider: VerzetaWebviewProvider;
    readonly connectionManager: ConnectionManager;
    readonly conversationStore: ConversationStore;
    readonly logger: Logger;
}

export interface IdeBridge {
    readonly canvasProvider: CanvasDocumentProvider;
    dispose(): void;
}

export function registerIdeBridge(
    context: vscode.ExtensionContext,
    deps: IdeBridgeDeps,
): IdeBridge {
    const canvasProvider = new CanvasDocumentProvider({
        connectionManager: deps.connectionManager,
        logger: deps.logger,
    });

    const registrations: vscode.Disposable[] = [
        registerSendSelectionCommand({ provider: deps.provider }),
        ...registerAttachFileCommands({ provider: deps.provider }),
        registerGitContextCommand({ provider: deps.provider }),
        registerEditorActionsCommands({
            provider: deps.provider,
            connectionManager: deps.connectionManager,
            conversationStore: deps.conversationStore,
            logger: deps.logger,
        }),
        registerCommitMessageCommand({
            provider: deps.provider,
            connectionManager: deps.connectionManager,
            conversationStore: deps.conversationStore,
            logger: deps.logger,
        }),
        registerTerminalContextCommand({
            provider: deps.provider,
            connectionManager: deps.connectionManager,
            conversationStore: deps.conversationStore,
            logger: deps.logger,
        }),
        registerEditorCodeActionsProvider(),
        registerEditorCodeLensProvider(),
        registerApplyEditCommand({ provider: deps.provider, logger: deps.logger }),
        registerOpenCanvasCommand({
            connectionManager: deps.connectionManager,
            logger: deps.logger,
        }),
        vscode.workspace.registerTextDocumentContentProvider(CANVAS_SCHEME, canvasProvider),
        canvasRefreshSubscription(deps.connectionManager, canvasProvider),
    ];

    for (const r of registrations) {
        context.subscriptions.push(r);
    }

    return {
        canvasProvider,
        dispose: () => {
            canvasProvider.dispose();
            for (const r of registrations) r.dispose();
        },
    };
}

/** Keeps open canvas tabs in step with the host's canvas events. */
function canvasRefreshSubscription(
    connectionManager: ConnectionManager,
    canvasProvider: CanvasDocumentProvider,
): vscode.Disposable {
    const onCanvasChanged = (hostId: string, conversationId: string): void => {
        canvasProvider.notifyConversationChanged(hostId, conversationId);
    };
    connectionManager.on('canvasChanged', onCanvasChanged);
    return new vscode.Disposable(() => {
        connectionManager.off('canvasChanged', onCanvasChanged);
    });
}
