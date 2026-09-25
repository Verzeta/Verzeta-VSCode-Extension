// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { isSafeUploadFileName, unsafeFileNameMessage } from '../../../src/shared/wire-limits.js';
import {
    addPendingAttachment,
    clearPendingAttachments,
    pendingAttachments,
} from '../../../webview-ui/src/state/composer.js';
import { hasBlankAlias } from '../../../webview-ui/src/lib/members.js';

test('isSafeUploadFileName mirrors the host rule', () => {
    assert.equal(isSafeUploadFileName('main.py'), true);
    assert.equal(isSafeUploadFileName('.env'), false);
    assert.equal(isSafeUploadFileName('.gitignore'), false);
    assert.equal(isSafeUploadFileName('a/b.txt'), false);
    assert.equal(isSafeUploadFileName('a\\b.txt'), false);
    assert.equal(isSafeUploadFileName('x..y'), false);
    assert.equal(isSafeUploadFileName(''), false);
});

test('unsafeFileNameMessage names the file and has no em dash', () => {
    const message = unsafeFileNameMessage('.env');
    assert.match(message, /"\.env"/);
    assert.equal(message.includes(String.fromCharCode(0x2014)), false);
});

test('staging a dotfile is refused with a message and stages nothing', () => {
    clearPendingAttachments();
    const error = addPendingAttachment({
        fileName: '.env',
        mimeType: 'text/plain',
        rawBytes: 10,
        contentBase64: 'YWJj',
    });
    assert.equal(error, unsafeFileNameMessage('.env'));
    assert.equal(pendingAttachments.value.length, 0);
});

test('staging an empty file says it is empty', () => {
    clearPendingAttachments();
    const error = addPendingAttachment({
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        rawBytes: 0,
        contentBase64: '',
    });
    assert.equal(error, '"empty.txt" is empty.');
});

test('staging a normal file succeeds', () => {
    clearPendingAttachments();
    const error = addPendingAttachment({
        fileName: 'notes.md',
        mimeType: 'text/markdown',
        rawBytes: 3,
        contentBase64: 'YWJj',
    });
    assert.equal(error, null);
    assert.equal(pendingAttachments.value.length, 1);
    clearPendingAttachments();
});

test('hasBlankAlias flags an empty or whitespace alias', () => {
    assert.equal(hasBlankAlias([{ alias: 'Coder' }, { alias: 'Writer' }]), false);
    assert.equal(hasBlankAlias([{ alias: 'Coder' }, { alias: '' }]), true);
    assert.equal(hasBlankAlias([{ alias: '   ' }]), true);
    assert.equal(hasBlankAlias([]), false);
});
