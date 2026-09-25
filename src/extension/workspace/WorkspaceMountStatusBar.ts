// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';
import type { Logger } from '../log/Logger.js';
import { type Disposable, DisposableStore } from '../infra/disposables.js';
import type { WorkspaceMountInfoUi } from '../../shared/wire-types.js';
import type { WorkspaceMountService } from './WorkspaceMountService.js';
import {
    STATUS_BAR_MENU_COMMAND,
    STATUS_BAR_PRIORITY,
    buildStatusBarLabel,
} from './WorkspaceMountStatusBarLabel.js';

export {
    STATUS_BAR_MENU_COMMAND,
    STATUS_BAR_PRIORITY,
    buildStatusBarLabel,
    formatTier,
    tailFromFsPath,
    workspaceTail,
} from './WorkspaceMountStatusBarLabel.js';
export type { StatusBarLabel } from './WorkspaceMountStatusBarLabel.js';

export interface WorkspaceMountStatusBarOptions {
    readonly logger: Logger;
    readonly service: WorkspaceMountService;
}

export class WorkspaceMountStatusBar implements Disposable {
    private readonly logger: Logger;
    private readonly service: WorkspaceMountService;
    private readonly item: vscode.StatusBarItem;
    private readonly subs = new DisposableStore();
    private disposed = false;

    constructor(options: WorkspaceMountStatusBarOptions) {
        this.logger = options.logger;
        this.service = options.service;
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            STATUS_BAR_PRIORITY,
        );
        this.item.command = STATUS_BAR_MENU_COMMAND;
        this.subs.add({ dispose: () => this.item.dispose() });

        const onAdded = (info: WorkspaceMountInfoUi): void => this.render(info);
        const onChanged = (info: WorkspaceMountInfoUi): void => this.render(info);
        const onRemoved = (): void => this.renderEmpty();
        this.service.on('mountAdded', onAdded);
        this.service.on('mountChanged', onChanged);
        this.service.on('mountRemoved', onRemoved);
        this.subs.add({
            dispose: () => {
                this.service.off('mountAdded', onAdded);
                this.service.off('mountChanged', onChanged);
                this.service.off('mountRemoved', onRemoved);
            },
        });

        const initial = this.service.getActiveMounts()[0];
        if (initial !== undefined) this.render(initial);
        else this.renderEmpty();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.subs.dispose();
    }

    private render(info: WorkspaceMountInfoUi): void {
        const label = buildStatusBarLabel(info);
        this.item.text = label.text;
        this.item.tooltip = label.tooltip;
        this.item.backgroundColor =
            info.permissionTier === 'bypass'
                ? new vscode.ThemeColor('statusBarItem.warningBackground')
                : undefined;
        this.item.show();
        this.logger.debug('workspace-mount: status bar updated', {
            folderId: info.folderId,
            tier: info.permissionTier,
        });
    }

    private renderEmpty(): void {
        this.item.text = '';
        this.item.tooltip = undefined;
        this.item.backgroundColor = undefined;
        this.item.hide();
        this.logger.debug('workspace-mount: status bar cleared', {});
    }
}
