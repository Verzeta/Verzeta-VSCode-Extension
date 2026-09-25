// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type * as vscode from 'vscode';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { ConversationStore } from '../conversations/ConversationStore.js';
import type { HostStore } from '../hosts/HostStore.js';
import type { Logger } from '../log/Logger.js';
import type { MessageStore } from '../conversations/MessageStore.js';
import type { ProjectStore } from '../conversations/ProjectStore.js';
import type { SecretStore } from '../hosts/SecretStore.js';
import type { WorkspaceMountService } from '../workspace/WorkspaceMountService.js';
import { registerAddHost } from './addHost.js';
import { registerOpenOutputChannel } from './openOutputChannel.js';
import { registerRemoveHost } from './removeHost.js';
import { registerStubCommands } from './stubs.js';
import { registerWorkspaceMountCommands } from './workspaceMountCommands.js';

export interface CommandsDeps {
    readonly hostStore: HostStore;
    readonly secretStore: SecretStore;
    readonly connectionManager: ConnectionManager;
    readonly conversationStore: ConversationStore;
    readonly projectStore: ProjectStore;
    readonly messageStore: MessageStore;
    readonly workspaceMount: WorkspaceMountService;
    readonly logger: Logger;
    /** Creates and opens a conversation; backs `verzeta.newConversation`. */
    readonly newConversation: () => Promise<void>;
}

export function registerAllCommands(context: vscode.ExtensionContext, deps: CommandsDeps): void {
    context.subscriptions.push(
        registerAddHost({
            hostStore: deps.hostStore,
            secretStore: deps.secretStore,
            connectionManager: deps.connectionManager,
            logger: deps.logger,
        }),
        registerRemoveHost({
            hostStore: deps.hostStore,
            secretStore: deps.secretStore,
            connectionManager: deps.connectionManager,
            logger: deps.logger,
        }),
        registerOpenOutputChannel(deps.logger),
        registerWorkspaceMountCommands({
            logger: deps.logger,
            workspaceMount: deps.workspaceMount,
            connectionManager: deps.connectionManager,
            projectStore: deps.projectStore,
            conversationStore: deps.conversationStore,
        }),
        ...registerStubCommands({
            hostStore: deps.hostStore,
            secretStore: deps.secretStore,
            connectionManager: deps.connectionManager,
            logger: deps.logger,
            newConversation: deps.newConversation,
        }),
    );
}
