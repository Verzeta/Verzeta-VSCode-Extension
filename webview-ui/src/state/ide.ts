// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { signal } from '@preact/signals';

export interface IdeNotice {
    readonly level: 'info' | 'warn' | 'error';
    readonly message: string;
}

export const ideNotice = signal<IdeNotice | null>(null);

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export function setIdeNotice(notice: IdeNotice | null): void {
    ideNotice.value = notice;
    if (dismissTimer !== null) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
    }
    if (notice !== null) {
        const ms = notice.level === 'error' ? 8000 : 4000;
        dismissTimer = setTimeout(() => {
            ideNotice.value = null;
            dismissTimer = null;
        }, ms);
    }
}

export function clearIdeNotice(): void {
    setIdeNotice(null);
}
