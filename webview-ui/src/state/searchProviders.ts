// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { signal } from '@preact/signals';
import type { SearchProvidersCatalogUi } from '../../../src/shared/wire-types.js';

const catalogPerHost = signal<ReadonlyMap<string, SearchProvidersCatalogUi>>(new Map());

export function searchProvidersFor(hostId: string): SearchProvidersCatalogUi | undefined {
    return catalogPerHost.value.get(hostId);
}

export function setSearchProvidersFor(hostId: string, catalog: SearchProvidersCatalogUi): void {
    const next = new Map(catalogPerHost.value);
    next.set(hostId, catalog);
    catalogPerHost.value = next;
}
