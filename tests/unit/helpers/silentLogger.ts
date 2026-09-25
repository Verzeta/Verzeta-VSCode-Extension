// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { Logger, LogLevel } from '../../../src/extension/log/Logger.js';

export function silentLogger(): Logger {
    let level: LogLevel = 'info';
    const noop = (_message: string, _context?: Readonly<Record<string, unknown>>): void => {};
    const logger: Pick<
        Logger,
        'error' | 'warn' | 'info' | 'debug' | 'setLevel' | 'getLevel' | 'dispose'
    > = {
        error: noop,
        warn: noop,
        info: noop,
        debug: noop,
        setLevel: (l) => {
            level = l;
        },
        getLevel: () => level,
        dispose: () => {},
    };
    return logger as Logger;
}
