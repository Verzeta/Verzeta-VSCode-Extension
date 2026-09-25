// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * TemplateLibrarySheet — full-page overlay showing the host's COMPLETE
 * project-template catalog (built-ins + user-saved, pinned and not).
 * Mirrors Android `TemplateLibraryScreen.kt`.
 *
 * Search + category filter narrow the catalog. Per-card actions:
 *   - Read more  → opens ProjectTemplateDetailSheet
 *   - Pin / Unpin → toggles `template.pinRequested`
 *   - Delete      → user-saved templates only; confirms then sends
 *                   `template.deleteRequested`
 *   - Create      → `projectTemplate.createProjectRequested`
 *
 * Built-in templates are immune to delete (the host returns false
 * regardless); the button is hidden on built-ins to match Android.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ProjectTemplateUi } from '../../../src/shared/wire-types.js';
import { activeHostId } from '../state/hosts.js';
import { projectTemplatesAllFor } from '../state/projectTemplates.js';
import {
    closeTemplateLibrary,
    openTemplateDetail,
    templateLibraryOpen,
} from '../state/projectRoomsUi.js';
import { openQuickStart } from '../state/projectQuickStart.js';
import { send } from '../lib/bus.js';

export function TemplateLibrarySheet() {
    if (!templateLibraryOpen.value) return null;
    const hostId = activeHostId.value;
    if (hostId === undefined) {
        closeTemplateLibrary();
        return null;
    }
    return <LibraryBody hostId={hostId} />;
}

function LibraryBody({ hostId }: { readonly hostId: string }) {
    const templates = projectTemplatesAllFor(hostId);
    const [query, setQuery] = useState<string>('');
    const [category, setCategory] = useState<string>('');
    const [confirmingDelete, setConfirmingDelete] = useState<ProjectTemplateUi | null>(null);

    useEffect(() => {
        send({ type: 'projectTemplates.allRequested', hostId });
    }, [hostId]);

    const categories = useMemo(() => {
        const seen = new Set<string>();
        for (const t of templates) {
            if (t.category.length > 0) seen.add(t.category);
        }
        return [...seen].sort();
    }, [templates]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return templates.filter((t) => {
            if (category.length > 0 && t.category !== category) return false;
            if (needle.length === 0) return true;
            return (
                t.name.toLowerCase().includes(needle) ||
                t.scenario.toLowerCase().includes(needle) ||
                t.description.toLowerCase().includes(needle) ||
                t.category.toLowerCase().includes(needle)
            );
        });
    }, [templates, query, category]);

    return (
        <div
            class="verzeta-prooms-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Template Library"
        >
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={closeTemplateLibrary}
                    aria-label="Back"
                >
                    ‹
                </button>
                <h1 class="verzeta-prooms__title">Template Library</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>HOME</span>
                <span aria-hidden="true">·</span>
                <span>PROJECT ROOMS</span>
                <span aria-hidden="true">·</span>
                <span>TEMPLATE LIBRARY</span>
            </div>
            <div class="verzeta-prooms__scroll">
                <div class="verzeta-library__searchRow">
                    <input
                        type="search"
                        class="verzeta-library__search"
                        placeholder="Search templates by name, scenario, or category…"
                        value={query}
                        onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
                        aria-label="Search templates"
                    />
                    <span class="verzeta-library__count">
                        {visible.length} / {templates.length}
                    </span>
                </div>
                {categories.length > 0 ? (
                    <div class="verzeta-prooms__filters" role="tablist">
                        <button
                            type="button"
                            class={[
                                'verzeta-prooms__filter',
                                category.length === 0 ? 'verzeta-prooms__filter--active' : '',
                            ]
                                .filter((s) => s.length > 0)
                                .join(' ')}
                            onClick={() => setCategory('')}
                        >
                            All
                        </button>
                        {categories.map((c) => (
                            <button
                                key={c}
                                type="button"
                                class={[
                                    'verzeta-prooms__filter',
                                    category === c ? 'verzeta-prooms__filter--active' : '',
                                ]
                                    .filter((s) => s.length > 0)
                                    .join(' ')}
                                onClick={() => setCategory(c)}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                ) : null}
                {templates.length === 0 ? (
                    <p class="verzeta-prooms__empty">
                        No templates on this host yet. Built-ins ship with the host and pinned
                        user-saved templates appear here too.
                    </p>
                ) : visible.length === 0 ? (
                    <p class="verzeta-prooms__empty">
                        No templates match your search. Try a different term or clear the category
                        filter.
                    </p>
                ) : (
                    <div class="verzeta-prooms__tplGrid">
                        {visible.map((t) => (
                            <LibraryCard
                                key={t.id}
                                template={t}
                                onReadMore={() => openTemplateDetail(t.id)}
                                onPin={() =>
                                    send({
                                        type: 'template.pinRequested',
                                        hostId,
                                        templateId: t.id,
                                        pinned: !t.isPinned,
                                    })
                                }
                                onDelete={() => setConfirmingDelete(t)}
                                onCreate={() => {
                                    closeTemplateLibrary();
                                    openQuickStart({
                                        templateId: t.id,
                                        name: t.name,
                                        scenario: t.scenario,
                                        goal: t.goal,
                                        description: t.description,
                                        members: [],
                                    });
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
            {confirmingDelete !== null ? (
                <DeleteConfirm
                    template={confirmingDelete}
                    onCancel={() => setConfirmingDelete(null)}
                    onConfirm={() => {
                        send({
                            type: 'template.deleteRequested',
                            hostId,
                            templateId: confirmingDelete.id,
                        });
                        setConfirmingDelete(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function LibraryCard({
    template,
    onReadMore,
    onPin,
    onDelete,
    onCreate,
}: {
    readonly template: ProjectTemplateUi;
    readonly onReadMore: () => void;
    readonly onPin: () => void;
    readonly onDelete: () => void;
    readonly onCreate: () => void;
}) {
    const banner = templateBannerStyle(template);
    return (
        <article class="verzeta-libcard">
            <span class="verzeta-tplcard__banner" style={banner.style} aria-hidden="true">
                <span class="verzeta-tplcard__tag">{template.tagLabel || template.category}</span>
                <span class="verzeta-tplcard__glyph">{banner.glyph}</span>
            </span>
            <div class="verzeta-libcard__body">
                <div class="verzeta-libcard__head">
                    <span class="verzeta-tplcard__title">{template.name}</span>
                    {template.isUserSaved ? (
                        <span class="verzeta-libcard__badge">User</span>
                    ) : (
                        <span class="verzeta-libcard__badge verzeta-libcard__badge--builtin">
                            Built-in
                        </span>
                    )}
                </div>
                {template.scenario.length > 0 ? (
                    <span class="verzeta-tplcard__scenario">{template.scenario}</span>
                ) : null}
                {template.description.length > 0 ? (
                    <span class="verzeta-tplcard__desc">{template.description}</span>
                ) : null}
                <div class="verzeta-libcard__actions">
                    <button
                        type="button"
                        class="verzeta-libcard__btn verzeta-libcard__btn--primary"
                        onClick={onCreate}
                    >
                        Create project
                    </button>
                    <button type="button" class="verzeta-libcard__btn" onClick={onReadMore}>
                        Read more
                    </button>
                    <button
                        type="button"
                        class="verzeta-libcard__btn"
                        onClick={onPin}
                        title={template.isPinned ? 'Unpin from landing' : 'Pin to landing'}
                    >
                        {template.isPinned ? '★ Pinned' : '☆ Pin'}
                    </button>
                    {template.isUserSaved ? (
                        <button
                            type="button"
                            class="verzeta-libcard__btn verzeta-libcard__btn--danger"
                            onClick={onDelete}
                        >
                            Delete
                        </button>
                    ) : null}
                </div>
            </div>
        </article>
    );
}

function DeleteConfirm({
    template,
    onCancel,
    onConfirm,
}: {
    readonly template: ProjectTemplateUi;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
}) {
    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Delete template"
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">Delete template?</h3>
                </header>
                <div class="verzeta-addmember__body">
                    <p>
                        "{template.name || template.id}" will be removed from your library. Built-in
                        templates aren't affected.
                    </p>
                </div>
                <footer class="verzeta-addmember__footer">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--danger"
                        onClick={onConfirm}
                    >
                        Delete
                    </button>
                </footer>
            </div>
        </div>
    );
}

function templateBannerStyle(t: ProjectTemplateUi): {
    style: { background: string };
    glyph: string;
} {
    const hue = ((t.baseHue % 360) + 360) % 360;
    const bg = `linear-gradient(135deg, hsla(${hue}, 60%, 38%, 0.55) 0%, hsla(${hue}, 60%, 28%, 0.85) 100%)`;
    const glyph =
        t.geometryKind === 'circles'
            ? '◯'
            : t.geometryKind === 'grid'
              ? '▦'
              : t.geometryKind === 'triangle'
                ? '▲'
                : t.geometryKind === 'wave'
                  ? '∿'
                  : t.geometryKind === 'bars'
                    ? '▥'
                    : t.geometryKind === 'arrows'
                      ? '↗'
                      : t.geometryKind === 'spiral'
                        ? '➰'
                        : '⋮⋮';
    return { style: { background: bg }, glyph };
}
