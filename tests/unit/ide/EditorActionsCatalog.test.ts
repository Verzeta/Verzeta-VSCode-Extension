// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    EDITOR_ACTIONS,
    DIAGNOSTIC_ACTION,
    editorActionById,
    composePrompt,
} from '../../../src/extension/ide/EditorActionsCatalog.js';

describe('editor action catalog', () => {
    test('exposes the expected selection actions', () => {
        assert.deepEqual(
            EDITOR_ACTIONS.map((a) => a.id),
            ['explain', 'fix', 'refactor', 'tests', 'docs'],
        );
    });

    test('editorActionById resolves catalog entries and the diagnostic action', () => {
        assert.equal(editorActionById('explain')?.id, 'explain');
        assert.equal(editorActionById('fixProblem')?.id, DIAGNOSTIC_ACTION.id);
        assert.equal(editorActionById('nope'), undefined);
    });
});

describe('composePrompt', () => {
    const explain = editorActionById('explain');
    assert.ok(explain !== undefined);

    test('substitutes path / language / selection and leaves no placeholders', () => {
        const out = composePrompt(explain, {
            relPath: 'src/a.ts',
            language: 'typescript',
            selection: 'const x = 1;',
        });
        assert.ok(out.includes('src/a.ts'));
        assert.ok(out.includes('```typescript'));
        assert.ok(out.includes('const x = 1;'));
        assert.ok(!out.includes('{sel}'));
        assert.ok(!out.includes('{path}'));
        assert.ok(!out.includes('{lang}'));
    });

    test('substitutes the diagnostic for the fix-problem action', () => {
        const out = composePrompt(DIAGNOSTIC_ACTION, {
            relPath: 'a.ts',
            language: 'typescript',
            selection: 'x',
            diagnostic: 'TS2304: Cannot find name "foo"',
        });
        assert.ok(out.includes('TS2304: Cannot find name "foo"'));
        assert.ok(!out.includes('{diag}'));
    });

    test('prepends @alias only when set', () => {
        const refactor = editorActionById('refactor');
        assert.ok(refactor !== undefined);
        const withAlias = composePrompt(refactor, {
            relPath: 'a.ts',
            language: 'ts',
            selection: 'x',
            alias: 'Alice',
        });
        assert.ok(withAlias.startsWith('@Alice '));
        const noAlias = composePrompt(refactor, {
            relPath: 'a.ts',
            language: 'ts',
            selection: 'x',
        });
        assert.ok(!noAlias.startsWith('@'));
    });
});
