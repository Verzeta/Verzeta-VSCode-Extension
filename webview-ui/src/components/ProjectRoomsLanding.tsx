// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ProjectRoomsLanding — full-page overlay surface that the Home
 * tab's ProjectRoomsCard opens. Mirrors the Android
 * `ProjectRoomsLandingScreen` shape (ui/projectrooms/
 * ProjectRoomsLandingScreen.kt, lines 80-274):
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  ←  Project Rooms                           │
 *   │  HOME · PROJECT ROOMS                       │
 *   │  ┌───────────────────────────────────────┐  │
 *   │  │ Start a project room                  │  │
 *   │  │ Spin up a chat, roster, goal in one   │  │
 *   │  │ shot.                                 │  │
 *   │  │ [ + Blank ]  [ ⚡ Quick start ]       │  │
 *   │  └───────────────────────────────────────┘  │
 *   │                                             │
 *   │  YOUR ROOMS (N)                             │
 *   │  ┌──────────────┐  ┌──────────────┐         │
 *   │  │ Q2 launch    │  │ ENG review   │  …      │
 *   │  │ 4 members    │  │ 3 members    │         │
 *   │  └──────────────┘  └──────────────┘         │
 *   │                                             │
 *   │  TEMPLATES — coming with project_template   │
 *   │  ops in the next tier.                      │
 *   └─────────────────────────────────────────────┘
 *
 * "Blank" opens FolderCreateSheet with type=project pre-set. A
 * folder card tap switches to the Chat tab and selects the project
 * folder so the sidebar drills in. Edit mode for an existing folder
 * (the heartbeats / preferred skills / documents surfaces) lands in
 * the next commit batch.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ProjectTemplateUi } from '../../../src/shared/wire-types.js';
import { activeHostId, hostsList } from '../state/hosts.js';
import { foldersFor, membersFor } from '../state/conversations.js';
import {
    closeProjectRoomsLanding,
    openTemplateDetail,
    openTemplateLibrary,
} from '../state/projectRoomsUi.js';
import { openFolderCreateSheet } from '../state/chatUi.js';
import { setEditingFolderId } from '../state/folderEditor.js';
import { projectTemplatesFor } from '../state/projectTemplates.js';
import { openQuickStart } from '../state/projectQuickStart.js';
import { expandFolder } from '../state/chatNav.js';
import { setTab } from '../state/tabs.js';
import { send } from '../lib/bus.js';

interface ProjectFolderCard {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
    readonly folderType: 'project' | 'organization';
}

export function ProjectRoomsLanding() {
    const hostId = activeHostId.value;
    const hosts = hostsList.value;
    const host = hostId === undefined ? undefined : hosts.find((h) => h.id === hostId);
    const hostLabel = host?.name.toUpperCase() ?? 'HOST';

    const templates = hostId === undefined ? [] : projectTemplatesFor(hostId);
    const [category, setCategory] = useState<string>('');

    useEffect(() => {
        if (hostId === undefined) return;
        send({ type: 'projectTemplates.requested', hostId });
    }, [hostId]);

    const categories = useMemo(() => {
        const seen = new Set<string>();
        for (const t of templates) {
            if (t.category.length > 0) seen.add(t.category);
        }
        return [...seen].sort();
    }, [templates]);

    const visibleTemplates = useMemo(
        () =>
            category.length === 0 ? templates : templates.filter((t) => t.category === category),
        [templates, category],
    );

    const folders = hostId === undefined ? [] : foldersFor(hostId);
    const projectFolders: readonly ProjectFolderCard[] = folders
        .filter(
            (f): f is typeof f & { folderType: 'project' | 'organization' } =>
                f.folderType === 'project' || f.folderType === 'organization',
        )
        .map((f) => ({
            id: f.id,
            name: f.name,
            memberCount: hostId === undefined ? 0 : membersFor(hostId, f.id).length,
            folderType: f.folderType,
        }));

    const onBack = (): void => {
        closeProjectRoomsLanding();
    };

    const onNewBlankProject = (): void => {
        closeProjectRoomsLanding();
        openFolderCreateSheet();
        setTab('chat');
    };

    const onOpenFolder = (folderId: string): void => {
        // Tap → land on the Chat tab with the folder pre-expanded
        // so the user immediately sees the member rows (1:1 chat
        // entry points) and the "Start group chat with all" action
        // row. The Edit button on the card is for those who want
        // to tune metadata; tapping the card body itself goes
        // straight to a usable surface.
        closeProjectRoomsLanding();
        expandFolder(folderId);
        setTab('chat');
        if (hostId !== undefined) {
            send({ type: 'folder.members.requested', hostId, folderId });
        }
    };

    const onEditFolder = (folderId: string): void => {
        setEditingFolderId(folderId);
        closeProjectRoomsLanding();
        openFolderCreateSheet();
        setTab('chat');
    };

    return (
        <div
            class="verzeta-prooms-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Project Rooms"
        >
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={onBack}
                    aria-label="Back to Home"
                >
                    <BackIcon />
                </button>
                <h1 class="verzeta-prooms__title">Project Rooms</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>HOME</span>
                <span aria-hidden="true">·</span>
                <span>PROJECT ROOMS</span>
            </div>

            <div class="verzeta-prooms__scroll">
                <section class="verzeta-prooms__hero" aria-labelledby="verzeta-prooms-hero-title">
                    <h2 id="verzeta-prooms-hero-title" class="verzeta-prooms__heroTitle">
                        Start a project room
                    </h2>
                    <p class="verzeta-prooms__heroDetail">
                        Create a chat with a named-agent team, a shared goal, and per-member model
                        and tool overrides in one step.
                    </p>
                    <div class="verzeta-prooms__heroActions">
                        <button
                            type="button"
                            class="verzeta-btn verzeta-btn--primary"
                            onClick={onNewBlankProject}
                            disabled={hostId === undefined}
                        >
                            <PlusIcon />
                            New project
                        </button>
                    </div>
                </section>

                <section class="verzeta-prooms__rooms" aria-labelledby="verzeta-prooms-rooms-title">
                    <h2 id="verzeta-prooms-rooms-title" class="verzeta-prooms__sectionLabel">
                        <span>Your rooms</span>
                        <span class="verzeta-prooms__sectionLabel-host">
                            <span aria-hidden="true">·</span>
                            <span>{hostLabel}</span>
                        </span>
                        <span class="verzeta-prooms__sectionLabel-count">
                            {projectFolders.length}
                        </span>
                    </h2>
                    {projectFolders.length === 0 ? (
                        <p class="verzeta-prooms__empty">
                            No project rooms on this host yet. Click "New project" above to start
                            one. You can pick agents, assign aliases, set a coordinator, and
                            override per-member models or tools.
                        </p>
                    ) : (
                        <div class="verzeta-prooms__grid">
                            {projectFolders.map((card) => (
                                <FolderCard
                                    key={card.id}
                                    card={card}
                                    onOpen={() => onOpenFolder(card.id)}
                                    onEdit={() => onEditFolder(card.id)}
                                />
                            ))}
                        </div>
                    )}
                </section>

                <section
                    class="verzeta-prooms__templates"
                    aria-labelledby="verzeta-prooms-tpl-title"
                >
                    <h2 id="verzeta-prooms-tpl-title" class="verzeta-prooms__sectionLabel">
                        <span>Templates</span>
                        <span class="verzeta-prooms__sectionLabel-count">{templates.length}</span>
                        <button
                            type="button"
                            class="verzeta-prooms__browseAll"
                            onClick={openTemplateLibrary}
                            disabled={hostId === undefined}
                        >
                            Browse all
                        </button>
                    </h2>
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
                            No templates loaded yet. The host catalog may still be syncing.
                        </p>
                    ) : (
                        <div class="verzeta-prooms__tplGrid">
                            {visibleTemplates.map((t) => (
                                <TemplateCard
                                    key={t.id}
                                    template={t}
                                    onOpen={
                                        hostId !== undefined
                                            ? () =>
                                                  openQuickStart({
                                                      templateId: t.id,
                                                      name: t.name,
                                                      scenario: t.scenario,
                                                      goal: t.goal,
                                                      description: t.description,
                                                      members: [],
                                                  })
                                            : undefined
                                    }
                                    onReadMore={() => openTemplateDetail(t.id)}
                                    onPin={
                                        hostId !== undefined
                                            ? () =>
                                                  send({
                                                      type: 'template.pinRequested',
                                                      hostId,
                                                      templateId: t.id,
                                                      pinned: !t.isPinned,
                                                  })
                                            : undefined
                                    }
                                />
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

function TemplateCard({
    template,
    onOpen,
    onReadMore,
    onPin,
}: {
    readonly template: ProjectTemplateUi;
    readonly onOpen: (() => void) | undefined;
    readonly onReadMore: () => void;
    readonly onPin: (() => void) | undefined;
}) {
    const banner = templateBannerStyle(template);
    const wholeCardClick = onOpen ?? onReadMore;
    return (
        <article class="verzeta-tplcard">
            <button
                type="button"
                class="verzeta-tplcard__bannerBtn"
                onClick={wholeCardClick}
                title={`Quick Start from "${template.name}"`}
            >
                <span class="verzeta-tplcard__banner" style={banner.style} aria-hidden="true">
                    <span class="verzeta-tplcard__tag">
                        {template.tagLabel || template.category}
                    </span>
                    <span class="verzeta-tplcard__glyph">{banner.glyph}</span>
                </span>
                <span class="verzeta-tplcard__body">
                    <span class="verzeta-tplcard__title">{template.name}</span>
                    {template.scenario.length > 0 ? (
                        <span class="verzeta-tplcard__scenario">{template.scenario}</span>
                    ) : null}
                    {template.description.length > 0 ? (
                        <span class="verzeta-tplcard__desc">{template.description}</span>
                    ) : null}
                </span>
            </button>
            <span class="verzeta-tplcard__actions">
                {onOpen !== undefined ? (
                    <button
                        type="button"
                        class="verzeta-libcard__btn verzeta-libcard__btn--primary"
                        onClick={onOpen}
                    >
                        Quick Start
                    </button>
                ) : null}
                <button type="button" class="verzeta-libcard__btn" onClick={onReadMore}>
                    Read more
                </button>
                {onPin !== undefined ? (
                    <button
                        type="button"
                        class="verzeta-libcard__btn"
                        onClick={onPin}
                        title={template.isPinned ? 'Unpin' : 'Pin to landing'}
                    >
                        {template.isPinned ? '★' : '☆'}
                    </button>
                ) : null}
            </span>
        </article>
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

function FolderCard({
    card,
    onOpen,
    onEdit,
}: {
    readonly card: ProjectFolderCard;
    readonly onOpen: () => void;
    readonly onEdit: () => void;
}) {
    const memberWord = card.memberCount === 1 ? 'member' : 'members';
    return (
        <div class="verzeta-prooms__cardWrap">
            <button type="button" class="verzeta-prooms__card" onClick={onOpen}>
                <span class="verzeta-prooms__cardIcon" aria-hidden="true">
                    {card.folderType === 'organization' ? <OrgIcon /> : <ProjectIcon />}
                </span>
                <span class="verzeta-prooms__cardBody">
                    <span class="verzeta-prooms__cardName">{card.name}</span>
                    <span class="verzeta-prooms__cardMeta">
                        {card.folderType === 'organization' ? 'Organization' : 'Project'} ·{' '}
                        {card.memberCount} {memberWord}
                    </span>
                </span>
            </button>
            <button
                type="button"
                class="verzeta-prooms__cardEdit"
                onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                }}
                title="Edit project settings"
                aria-label={`Edit ${card.name}`}
            >
                ⚙
            </button>
        </div>
    );
}

function BackIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M15 6l-6 6 6 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
            />
        </svg>
    );
}

function ProjectIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
            <path
                d="M9 13h6M9 16h4"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function OrgIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 21V8l8-4 8 4v13M9 21v-6h6v6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
            <path
                d="M7 11h2M11 11h2M15 11h2M7 15h2M15 15h2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}
