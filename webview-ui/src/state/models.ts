// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-host model-catalog cache for the webview. The chat header
 * subtitle reads `activeProvider`/`activeModel` from this signal,
 * and ModelPickerSheet renders the providers list off it.
 *
 * Two write paths:
 *   - `models.catalog.updated` envelope from the host → full replace.
 *   - `models.active.changed` envelope (echoed when ANY paired client
 *     switches the active model) → mutate `activeProvider` /
 *     `activeModel` keeping the providers list intact.
 */

import { signal } from '@preact/signals';
import type { ModelCatalogUi } from '../../../src/shared/wire-types.js';

const catalogPerHost = signal<ReadonlyMap<string, ModelCatalogUi>>(new Map());

export function modelCatalogFor(hostId: string): ModelCatalogUi | undefined {
    return catalogPerHost.value.get(hostId);
}

export function setModelCatalogFor(hostId: string, catalog: ModelCatalogUi): void {
    const next = new Map(catalogPerHost.value);
    next.set(hostId, catalog);
    catalogPerHost.value = next;
}

/**
 * Update only the `activeProvider` + `activeModel` fields of the
 * cached catalog for `hostId`. If no catalog is cached yet we seed
 * one with an empty providers list so the chat-header subtitle
 * still gets the active-model text (the picker sheet will refetch
 * the full catalog on open).
 */
export function setActiveModelFor(hostId: string, providerId: string, modelName: string): void {
    const existing = catalogPerHost.value.get(hostId);
    const next = new Map(catalogPerHost.value);
    if (existing === undefined) {
        next.set(hostId, {
            providers: [],
            activeProvider: providerId,
            activeModel: modelName,
        });
    } else {
        next.set(hostId, {
            providers: existing.providers,
            activeProvider: providerId,
            activeModel: modelName,
        });
    }
    catalogPerHost.value = next;
}
