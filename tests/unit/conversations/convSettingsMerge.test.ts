// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { overlayWrittenSettings } from '../../../src/extension/conversations/convSettingsMerge.js';
import { parseConvSettings } from '../../../src/extension/wire/RemoteJson.js';

const stale = parseConvSettings({ temperature: 0.7, toolsEnabled: true, agentPattern: 'direct' });

test('written fields replace the read-back values', () => {
    assert.ok(stale !== undefined);
    const merged = overlayWrittenSettings(stale, { toolsEnabled: false, agentPattern: 'react' });
    assert.equal(merged.toolsEnabled, false);
    assert.equal(merged.agentPattern, 'react');
    assert.equal(merged.temperature, 0.7);
});

test('undefined fields in the patch leave the read-back value alone', () => {
    assert.ok(stale !== undefined);
    const patch: Record<string, unknown> = { temperature: undefined };
    const merged = overlayWrittenSettings(stale, patch);
    assert.equal(merged.temperature, 0.7);
});
