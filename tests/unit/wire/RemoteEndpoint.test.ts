// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseEndpoint, websocketUrl } from '../../../src/extension/wire/RemoteEndpoint.js';

test('parseEndpoint accepts ws://localhost:9180/', () => {
    const ep = parseEndpoint('ws://localhost:9180/');
    assert.equal(ep.host, 'localhost');
    assert.equal(ep.port, 9180);
    assert.equal(ep.tls, false);
});

test('parseEndpoint accepts wss://server.example.com:9180/ws', () => {
    const ep = parseEndpoint('wss://server.example.com:9180/ws');
    assert.equal(ep.host, 'server.example.com');
    assert.equal(ep.port, 9180);
    assert.equal(ep.tls, true);
});

test('parseEndpoint defaults port to 443 for wss when omitted', () => {
    const ep = parseEndpoint('wss://server.example.com/');
    assert.equal(ep.port, 443);
    assert.equal(ep.tls, true);
});

test('parseEndpoint defaults port to 80 for ws when omitted', () => {
    const ep = parseEndpoint('ws://localhost/');
    assert.equal(ep.port, 80);
    assert.equal(ep.tls, false);
});

test('parseEndpoint rejects http:// scheme', () => {
    assert.throws(() => parseEndpoint('http://localhost:9180/'), /ws:\/\/ or wss:\/\//);
});

test('parseEndpoint rejects empty input', () => {
    assert.throws(() => parseEndpoint(''), /empty/);
});

test('parseEndpoint rejects unparseable URL', () => {
    assert.throws(() => parseEndpoint('not-a-url'), /valid URL/);
});

test('parseEndpoint rejects non-/ws paths', () => {
    assert.throws(() => parseEndpoint('ws://localhost:9180/api'), /path must be \/ws/);
});

test('parseEndpoint accepts path == "/"', () => {
    const ep = parseEndpoint('ws://localhost:9180/');
    assert.equal(ep.port, 9180);
});

test('parseEndpoint rejects port out of range', () => {
    assert.throws(() => parseEndpoint('ws://localhost:0/'), /port/);
    assert.throws(() => parseEndpoint('ws://localhost:99999/'), /port/);
});

test('websocketUrl builds canonical wss URL', () => {
    const url = websocketUrl({ host: 'example.com', port: 9180, tls: true });
    assert.equal(url, 'wss://example.com:9180/ws');
});

test('websocketUrl builds canonical ws URL', () => {
    const url = websocketUrl({ host: 'localhost', port: 9180, tls: false });
    assert.equal(url, 'ws://localhost:9180/ws');
});
