// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import js from '@eslint/js';
import tsEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
    {
        ignores: [
            'dist/**',
            'dist-tests/**',
            'node_modules/**',
            '.vscode-test/**',
            '*.vsix',
            // The webview-ui directory has its own block below with a
            // browser globals set + Preact JSX support.
        ],
    },
    js.configs.recommended,
    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
                project: ['./tsconfig.json', './tsconfig.tests.json'],
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                WebSocket: 'readonly',
                fetch: 'readonly',
                AbortController: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tsEslint,
        },
        rules: {
            'no-unused-vars': 'off',
            'no-undef': 'off',

            // TypeScript-aware strictness.
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unsafe-call': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            '@typescript-eslint/strict-boolean-expressions': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',

            // Core JS hygiene.
            'no-console': ['error', { allow: ['error', 'warn'] }],
            'no-debugger': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-throw-literal': 'error',
            'no-unused-expressions': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
            eqeqeq: ['error', 'always'],

            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'openai',
                            message:
                                'LLM SDKs forbidden. All LLM dispatch goes through the wire protocol.',
                        },
                        { name: '@anthropic-ai/sdk', message: 'LLM SDKs forbidden.' },
                        { name: '@google/generative-ai', message: 'LLM SDKs forbidden.' },
                        { name: '@google-cloud/aiplatform', message: 'LLM SDKs forbidden.' },
                        { name: 'ollama', message: 'LLM SDKs forbidden.' },
                        { name: 'cohere-ai', message: 'LLM SDKs forbidden.' },
                        { name: 'replicate', message: 'LLM SDKs forbidden.' },
                        {
                            name: 'ws',
                            message:
                                'Use Node 22+ native WebSocket. The `ws` package is an unnecessary supply-chain risk.',
                        },
                        {
                            name: 'keytar',
                            message:
                                'Use vscode.SecretStorage. Native modules are forbidden (build-script attack vector).',
                        },
                        { name: 'node-fetch', message: 'Use Node 22+ native fetch.' },
                        { name: 'axios', message: 'Use Node 22+ native fetch.' },
                        {
                            name: 'lodash',
                            message:
                                'Lodash and similar utility mega-libraries are forbidden. Use native JS or write the helper inline.',
                        },
                        { name: 'underscore', message: 'See lodash rule.' },
                    ],
                    patterns: [
                        { group: ['lodash/*'], message: 'Lodash forbidden.' },
                        { group: ['firebase*'], message: 'No analytics / cloud SDKs.' },
                        { group: ['@sentry/*'], message: 'No telemetry SDKs.' },
                    ],
                },
            ],

            // ANALYTICS / TELEMETRY GLOBALS — forbidden surfaces.
            'no-restricted-globals': [
                'error',
                { name: 'analytics', message: 'No analytics globals.' },
                { name: 'gtag', message: 'No analytics globals.' },
            ],
        },
    },
    {
        // Tests use node:test's `test()` which returns a Promise the
        // runner consumes — top-level test() calls do not need to be
        // awaited by the test author. Disable no-floating-promises
        // in this scope only.
        files: ['tests/**/*.ts'],
        rules: {
            '@typescript-eslint/no-floating-promises': 'off',
        },
    },
    {
        // Preact webview app — browser globals, JSX, separate tsconfig.
        files: ['webview-ui/**/*.ts', 'webview-ui/**/*.tsx'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
                project: ['./webview-ui/tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: { jsx: true },
                jsxPragma: null,
            },
            globals: {
                window: 'readonly',
                document: 'readonly',
                HTMLElement: 'readonly',
                MessageEvent: 'readonly',
                navigator: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                IntersectionObserver: 'readonly',
                ResizeObserver: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tsEslint,
        },
        rules: {
            'no-unused-vars': 'off',
            'no-undef': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            'no-console': ['error', { allow: ['error', 'warn'] }],
            'no-debugger': 'error',
            'no-eval': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
            eqeqeq: ['error', 'always'],
            // Forbidden runtime imports — keep the supply-chain surface
            // identical to the extension host's rules. Preact + signals
            // are explicitly allowed (they are first-party imports the
            // webview app legitimately needs).
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        { name: 'react', message: 'Use Preact (L18); do not import React.' },
                        {
                            name: 'react-dom',
                            message: 'Use Preact (L18); do not import React DOM.',
                        },
                        { name: 'marked', message: 'Markdown is hand-rolled (L20).' },
                        { name: 'markdown-it', message: 'Markdown is hand-rolled (L20).' },
                        { name: 'react-markdown', message: 'Markdown is hand-rolled (L20).' },
                        {
                            name: '@tanstack/virtual',
                            message: 'Virtualization is hand-rolled (L19).',
                        },
                        { name: 'react-window', message: 'Virtualization is hand-rolled (L19).' },
                        { name: 'lodash', message: 'No utility mega-libraries.' },
                    ],
                    patterns: [
                        { group: ['lodash/*'], message: 'No utility mega-libraries.' },
                        { group: ['@tanstack/*'], message: 'Virtualization is hand-rolled (L19).' },
                    ],
                },
            ],
        },
    },
];
