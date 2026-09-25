// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { useEffect, useState } from 'preact/hooks';
import { openAbout, openHelp } from '../state/aboutHelp.js';
import type { ComponentChildren, JSX } from 'preact';
import type {
    ClientUi,
    McpServerUi,
    SearchProviderUi,
    SkillUi,
    ToolUi,
} from '../../../src/shared/wire-types.js';
import type { HostConnectionState, HostSummaryUi } from '../../../src/shared/webview-protocol.js';
import { send } from '../lib/bus.js';
import { activeHostId, hostsList, identityFor, stateOf } from '../state/hosts.js';
import { clientsFor, mcpFor, skillsFor, toolsFor, verifyResultFor } from '../state/catalogs.js';
import { searchProvidersFor } from '../state/searchProviders.js';
import { mcpServerToolsFor } from '../state/detailCaches.js';
import { openRevokedDevices } from '../components/RevokedDevicesScreen.js';
import { SettingsIcon, TabHeader } from '../components/AppShellHeader.js';

export function SettingsTab() {
    return (
        <div
            class="verzeta-tab-panel verzeta-settings"
            id="verzeta-panel-settings"
            role="tabpanel"
            aria-labelledby="verzeta-tab-settings"
        >
            <SettingsHeader />
            <HostsSection />
            <DevicesPairedSection />
            <HostCatalogsSection />
            <SearchProvidersSection />
            <SessionSection />
            <HelpAboutSection />
        </div>
    );
}

function SettingsHeader() {
    const onRefresh = (): void => {
        const hostId = activeHostId.value;
        if (hostId === undefined) return;
        send({ type: 'agents.listRequested', hostId });
        send({ type: 'clients.listRequested', hostId });
        send({ type: 'tools.listRequested', hostId });
        send({ type: 'mcp.listRequested', hostId });
        send({ type: 'skills.listRequested', hostId });
        send({ type: 'verifySession.requested', hostId });
        send({ type: 'search.providers.requested', hostId });
    };
    return (
        <TabHeader
            icon={<SettingsIcon />}
            title="Settings"
            trailing={
                <button
                    type="button"
                    class="verzeta-iconbtn"
                    onClick={onRefresh}
                    aria-label="Refresh catalogs"
                    title="Refresh catalogs"
                >
                    <IconRefresh />
                </button>
            }
        />
    );
}

// ====================================================================
// HOSTS
// ====================================================================

function HostsSection() {
    const hosts = hostsList.value;
    const active = activeHostId.value;
    const activeHost = hosts.find((h) => h.id === active);
    return (
        <section class="verzeta-settings__section">
            <h2 class="verzeta-settings__label">Hosts</h2>
            <div class="verzeta-settings__rows">
                {hosts.length === 0 ? (
                    <NavRow
                        icon={<IconServer />}
                        title="No hosts paired yet"
                        subtitle="Click “Add another host” below to pair your Verzeta Studio host."
                    />
                ) : (
                    hosts.map((host) => (
                        <HostNavRow
                            key={host.id}
                            host={host}
                            state={stateOf(host.id)}
                            isActive={host.id === active}
                        />
                    ))
                )}
                <NavRow
                    icon={<IconPlus />}
                    title="Add another host"
                    subtitle="Pair this device with another Verzeta Studio host."
                    onClick={() =>
                        send({ type: 'host.commandRequested', commandId: 'verzeta.addHost' })
                    }
                />
                {activeHost !== undefined ? (
                    <NavRow
                        icon={<IconKey />}
                        title="Revoke this device"
                        subtitle={`Drop the token issued by ${activeHost.name}.`}
                        danger
                        onClick={() =>
                            send({ type: 'host.revokeSelfRequested', hostId: activeHost.id })
                        }
                    />
                ) : null}
            </div>
        </section>
    );
}

function HostNavRow({
    host,
    state,
    isActive,
}: {
    readonly host: HostSummaryUi;
    readonly state: HostConnectionState['state'];
    readonly isActive: boolean;
}) {
    const identity = identityFor(host.id);
    const subtitle =
        identity !== undefined ? `${host.url} · Authenticated as ${identity.clientName}` : host.url;
    const isConnected = state === 'connected';
    return (
        <NavRow
            icon={<IconServer />}
            title={
                <>
                    {host.name}
                    {isActive ? (
                        <span class={`verzeta-dot verzeta-dot--${state}`} aria-hidden="true" />
                    ) : null}
                    {host.hasTlsPin ? <span class="verzeta-settings__tag">TLS pin</span> : null}
                </>
            }
            subtitle={subtitle}
            actions={
                <>
                    {isConnected ? (
                        <button
                            type="button"
                            class="verzeta-textbtn"
                            onClick={() =>
                                send({ type: 'host.disconnectRequested', hostId: host.id })
                            }
                        >
                            Disconnect
                        </button>
                    ) : (
                        <button
                            type="button"
                            class="verzeta-textbtn"
                            onClick={() => {
                                send({ type: 'host.setActive', hostId: host.id });
                                send({ type: 'host.connectRequested', hostId: host.id });
                            }}
                        >
                            Connect
                        </button>
                    )}
                    <button
                        type="button"
                        class="verzeta-textbtn verzeta-textbtn--danger"
                        onClick={() =>
                            send({ type: 'host.commandRequested', commandId: 'verzeta.removeHost' })
                        }
                    >
                        Remove
                    </button>
                </>
            }
        />
    );
}

// ====================================================================
// DEVICES PAIRED WITH THIS HOST
// ====================================================================

function DevicesPairedSection() {
    const hostId = activeHostId.value;
    const connected = hostId !== undefined && stateOf(hostId) === 'connected';
    const clients = hostId === undefined ? [] : clientsFor(hostId);
    const active = clients.filter((c) => !c.revoked);

    useEffect(() => {
        if (connected && hostId !== undefined) {
            send({ type: 'clients.listRequested', hostId });
        }
    }, [connected, hostId]);

    return (
        <section class="verzeta-settings__section">
            <h2 class="verzeta-settings__label">Devices paired with this host</h2>
            <div class="verzeta-settings__rows">
                <NavRow
                    icon={<IconInfo />}
                    title="What is this?"
                    subtitle="Every device paired with the active host appears here, such as an Android phone or another VS Code window. Each device has its own token. Revoking a device invalidates its token on the host immediately."
                    static
                />
                {!connected ? (
                    <NavRow
                        icon={<IconPerson />}
                        title="Not connected"
                        subtitle="Connect a host above to load its paired device list."
                        static
                    />
                ) : active.length === 0 ? (
                    <NavRow
                        icon={<IconPerson />}
                        title="No other devices"
                        subtitle="This device is the only one paired with the host."
                        static
                    />
                ) : (
                    active.map((client) => (
                        <ClientNavRow key={client.id} client={client} hostId={hostId ?? ''} />
                    ))
                )}
            </div>
        </section>
    );
}

function ClientNavRow({ client, hostId }: { readonly client: ClientUi; readonly hostId: string }) {
    const subtitle =
        client.lastSeenAt > 0 ? `last seen ${formatRelative(client.lastSeenAt)}` : 'never seen';
    return (
        <NavRow
            icon={<IconPerson />}
            title={
                <>
                    {client.name}
                    {client.current ? <span class="verzeta-settings__tag">this device</span> : null}
                </>
            }
            subtitle={subtitle}
            actions={
                !client.current ? (
                    <button
                        type="button"
                        class="verzeta-textbtn verzeta-textbtn--danger"
                        onClick={() =>
                            send({
                                type: 'clients.revokeRequested',
                                hostId,
                                clientId: client.id,
                            })
                        }
                    >
                        Revoke
                    </button>
                ) : null
            }
        />
    );
}

// ====================================================================
// HOST CATALOGS — Revoked Devices summary + Tools/MCP/Skills
// ====================================================================

function HostCatalogsSection() {
    const hostId = activeHostId.value;
    const connected = hostId !== undefined && stateOf(hostId) === 'connected';
    const clients = hostId === undefined ? [] : clientsFor(hostId);
    const revokedCount = clients.filter((c) => c.revoked).length;

    return (
        <section class="verzeta-settings__section">
            <h2 class="verzeta-settings__label">Host catalogs</h2>
            <div class="verzeta-settings__rows">
                {revokedCount > 0 ? (
                    <NavRow
                        icon={<IconHistory />}
                        title="Revoked devices"
                        subtitle={`${revokedCount} previously paired ${revokedCount === 1 ? 'device' : 'devices'}, kept as read-only audit history.`}
                        chevron
                        onClick={openRevokedDevices}
                    />
                ) : null}
                {!connected || hostId === undefined ? (
                    <NavRow
                        icon={<IconWrench />}
                        title="Catalogs unavailable"
                        subtitle="Connect a host to view tools, MCP servers, and skills."
                        static
                    />
                ) : (
                    <>
                        <ToolsCatalogRow hostId={hostId} />
                        <McpCatalogRow hostId={hostId} />
                        <SkillsCatalogRow hostId={hostId} />
                    </>
                )}
            </div>
        </section>
    );
}

function ToolsCatalogRow({ hostId }: { readonly hostId: string }) {
    const [open, setOpen] = useState(false);
    const tools = toolsFor(hostId);
    useEffect(() => {
        if (open) send({ type: 'tools.listRequested', hostId });
    }, [open, hostId]);
    return (
        <>
            <NavRow
                icon={<IconWrench />}
                title="Tools"
                subtitle="Built-in, custom, and MCP tools the assistant can call."
                trailing={<span class="verzeta-settings__trailingCount">{tools.length}</span>}
                chevron
                expanded={open}
                onClick={() => setOpen(!open)}
            />
            {open ? (
                <ul class="verzeta-settings__sublist" role="list">
                    {tools.length === 0 ? (
                        <li class="verzeta-settings__empty">No tools loaded.</li>
                    ) : (
                        tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
                    )}
                </ul>
            ) : null}
        </>
    );
}

function ToolRow({ tool }: { readonly tool: ToolUi }) {
    return (
        <li class="verzeta-settings__sublistRow">
            <div class="verzeta-settings__sublistInfo">
                <div class="verzeta-settings__sublistTitle">
                    {tool.name}
                    <span class={`verzeta-settings__pill verzeta-settings__pill--${tool.kind}`}>
                        {tool.kind === 'built_in' ? 'built-in' : tool.kind}
                    </span>
                </div>
                {tool.description.length > 0 ? (
                    <div class="verzeta-settings__sublistSubtitle">{tool.description}</div>
                ) : null}
                {tool.mcpServer.length > 0 ? (
                    <div class="verzeta-settings__sublistSubtitle">
                        MCP server: <code>{tool.mcpServer}</code>
                    </div>
                ) : null}
            </div>
            <span
                class={`verzeta-settings__pill verzeta-settings__pill--${tool.enabled ? 'connected' : 'disconnected'}`}
            >
                {tool.enabled ? 'enabled' : 'disabled'}
            </span>
        </li>
    );
}

function McpCatalogRow({ hostId }: { readonly hostId: string }) {
    const [open, setOpen] = useState(false);
    const servers = mcpFor(hostId);
    useEffect(() => {
        if (open) send({ type: 'mcp.listRequested', hostId });
    }, [open, hostId]);
    return (
        <>
            <NavRow
                icon={<IconChain />}
                title="MCP Servers"
                subtitle="Configured Model Context Protocol servers and their connection state."
                trailing={<span class="verzeta-settings__trailingCount">{servers.length}</span>}
                chevron
                expanded={open}
                onClick={() => setOpen(!open)}
            />
            {open ? (
                <ul class="verzeta-settings__sublist" role="list">
                    {servers.length === 0 ? (
                        <li class="verzeta-settings__empty">No MCP servers configured.</li>
                    ) : (
                        servers.map((server) => (
                            <McpRow key={server.name} server={server} hostId={hostId} />
                        ))
                    )}
                </ul>
            ) : null}
        </>
    );
}

function McpRow({ server, hostId }: { readonly server: McpServerUi; readonly hostId: string }) {
    const [open, setOpen] = useState(false);
    const tools = mcpServerToolsFor(hostId, server.name);
    useEffect(() => {
        if (open && tools.length === 0) {
            send({ type: 'mcp.serverTools.requested', hostId, serverName: server.name });
        }
    }, [open, hostId, server.name, tools.length]);
    return (
        <li class="verzeta-settings__sublistRow">
            <div class="verzeta-settings__sublistInfo">
                <div class="verzeta-settings__sublistTitle">
                    {server.name}
                    <span class="verzeta-settings__tag">{server.type}</span>
                </div>
                <div class="verzeta-settings__sublistSubtitle">
                    {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'} ·{' '}
                    {server.disabled ? 'disabled' : server.status}
                    <button type="button" class="verzeta-textbtn" onClick={() => setOpen(!open)}>
                        {open ? 'Hide tools' : 'View tools'}
                    </button>
                </div>
                {server.errorMessage.length > 0 ? (
                    <div class="verzeta-settings__sublistSubtitle verzeta-settings__error">
                        {server.errorMessage}
                    </div>
                ) : null}
                {open ? (
                    tools.length === 0 ? (
                        <div class="verzeta-settings__sublistSubtitle">Fetching tools…</div>
                    ) : (
                        <ul class="verzeta-settings__sublist" role="list">
                            {tools.map((t) => (
                                <li key={t.name} class="verzeta-settings__sublistRow">
                                    <div class="verzeta-settings__sublistInfo">
                                        <div class="verzeta-settings__sublistTitle">{t.name}</div>
                                        {t.description.length > 0 ? (
                                            <div class="verzeta-settings__sublistSubtitle">
                                                {t.description}
                                            </div>
                                        ) : null}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
                ) : null}
            </div>
        </li>
    );
}

function SkillsCatalogRow({ hostId }: { readonly hostId: string }) {
    const [open, setOpen] = useState(false);
    const skills = skillsFor(hostId);
    useEffect(() => {
        if (open) send({ type: 'skills.listRequested', hostId });
    }, [open, hostId]);
    return (
        <>
            <NavRow
                icon={<IconSparkle />}
                title="Skills"
                subtitle="Installed skill packs with review state and metadata."
                trailing={<span class="verzeta-settings__trailingCount">{skills.length}</span>}
                chevron
                expanded={open}
                onClick={() => setOpen(!open)}
            />
            {open ? (
                <ul class="verzeta-settings__sublist" role="list">
                    {skills.length === 0 ? (
                        <li class="verzeta-settings__empty">No skills installed.</li>
                    ) : (
                        skills.map((skill) => <SkillRow key={skill.id} skill={skill} />)
                    )}
                </ul>
            ) : null}
        </>
    );
}

function SkillRow({ skill }: { readonly skill: SkillUi }) {
    return (
        <li class="verzeta-settings__sublistRow">
            <div class="verzeta-settings__sublistInfo">
                <div class="verzeta-settings__sublistTitle">
                    {skill.id}
                    {skill.version.length > 0 ? (
                        <span class="verzeta-settings__tag">v{skill.version}</span>
                    ) : null}
                </div>
                {skill.description.length > 0 ? (
                    <div class="verzeta-settings__sublistSubtitle">{skill.description}</div>
                ) : null}
                {skill.tags.length > 0 ? (
                    <div class="verzeta-settings__skillTags">
                        {skill.tags.map((t) => (
                            <span key={t} class="verzeta-settings__skillTag">
                                {t}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </li>
    );
}

// ====================================================================
// SESSION
// ====================================================================

function SessionSection() {
    const hostId = activeHostId.value;
    const state = hostId === undefined ? 'disconnected' : stateOf(hostId);
    const result = hostId === undefined ? undefined : verifyResultFor(hostId);
    const identity = hostId === undefined ? undefined : identityFor(hostId);
    const clients = hostId === undefined ? [] : clientsFor(hostId);
    const activeCount = clients.filter((c) => !c.revoked).length;

    const subtitle =
        identity !== undefined
            ? `Authenticated as ${identity.clientName} · id ${identity.clientId.slice(0, 8)}`
            : labelForState(state);

    return (
        <section class="verzeta-settings__section">
            <h2 class="verzeta-settings__label">Session</h2>
            <div class="verzeta-settings__rows">
                <NavRow
                    icon={<IconInfo />}
                    title={`Loaded ${activeCount} paired ${activeCount === 1 ? 'client' : 'clients'}`}
                    subtitle={subtitle}
                    static
                />
                <NavRow
                    icon={<IconRefresh />}
                    title="Verify session"
                    subtitle="Round-trip auth.me to confirm the host still recognises this token."
                    disabled={state !== 'connected'}
                    onClick={() => {
                        if (hostId !== undefined) {
                            send({ type: 'verifySession.requested', hostId });
                        }
                    }}
                />
                {result !== undefined && result.ok ? (
                    <NavRow
                        icon={<IconCheck />}
                        title={`Verified ${result.latencyMs} ms`}
                        subtitle={`Client ${result.clientName}`}
                        static
                    />
                ) : null}
                {result !== undefined && !result.ok && result.error.length > 0 ? (
                    <NavRow
                        icon={<IconWarn />}
                        title="Verify failed"
                        subtitle={result.error}
                        static
                    />
                ) : null}
            </div>
        </section>
    );
}

// ====================================================================
// HELP & ABOUT
// ====================================================================

function HelpAboutSection() {
    return (
        <section class="verzeta-settings__section">
            <h2 class="verzeta-settings__label">Help &amp; about</h2>
            <div class="verzeta-settings__rows">
                <NavRow
                    icon={<IconBook />}
                    title="Help &amp; docs"
                    subtitle="Install, pair, chat, projects, settings, troubleshoot."
                    chevron
                    onClick={openHelp}
                />
                <NavRow
                    icon={<IconInfo />}
                    title="About Verzeta for VS Code"
                    subtitle="Brand mark, version, license, open-source attributions."
                    chevron
                    onClick={openAbout}
                />
                <NavRow
                    icon={<IconBook />}
                    title="Open output channel"
                    subtitle="Connection and wire-layer diagnostics (View → Output → Verzeta)."
                    chevron
                    onClick={() =>
                        send({
                            type: 'host.commandRequested',
                            commandId: 'verzeta.openOutputChannel',
                        })
                    }
                />
            </div>
        </section>
    );
}

// ====================================================================
// NavRow — the building block (mirrors Android list-row composable)
// ====================================================================

function searchProviderStatus(p: SearchProviderUi): string {
    if (p.active) return 'Active';
    if (p.requiresApiKey && !p.hasKey) {
        return 'Needs an API key. Configure it on the desktop host.';
    }
    if (p.id === 'searxng' && p.baseUrl.length === 0) {
        return 'Needs a base URL. Configure it on the desktop host.';
    }
    if (p.id === 'custom') {
        return 'Configure the endpoint on the desktop host, then activate here.';
    }
    return 'Click to set as active.';
}

function SearchProvidersSection() {
    const hostId = activeHostId.value;
    useEffect(() => {
        if (hostId !== undefined) send({ type: 'search.providers.requested', hostId });
    }, [hostId]);

    const providers = hostId !== undefined ? (searchProvidersFor(hostId)?.providers ?? []) : [];

    return (
        <section class="verzeta-settings__section">
            <h2 class="verzeta-settings__label">Web Search</h2>
            <div class="verzeta-settings__rows">
                {hostId === undefined ? (
                    <NavRow
                        icon={<IconServer />}
                        title="Not connected"
                        subtitle="Connect a host to choose a web-search provider."
                        static
                    />
                ) : providers.length === 0 ? (
                    <NavRow
                        icon={<IconServer />}
                        title="No providers reported"
                        subtitle="The host has not reported any web-search providers yet."
                        static
                    />
                ) : (
                    providers.map((p) =>
                        p.active ? (
                            <NavRow
                                key={p.id}
                                icon={<IconServer />}
                                title={p.displayName}
                                subtitle={searchProviderStatus(p)}
                                trailing={<IconCheck />}
                                static
                            />
                        ) : (
                            <NavRow
                                key={p.id}
                                icon={<IconServer />}
                                title={p.displayName}
                                subtitle={searchProviderStatus(p)}
                                onClick={() =>
                                    send({
                                        type: 'search.setActiveRequested',
                                        hostId,
                                        providerId: p.id,
                                    })
                                }
                            />
                        ),
                    )
                )}
            </div>
        </section>
    );
}

function NavRow({
    icon,
    title,
    subtitle,
    actions,
    trailing,
    chevron,
    expanded,
    danger,
    disabled,
    static: isStatic,
    onClick,
}: {
    readonly icon: JSX.Element;
    readonly title: ComponentChildren;
    readonly subtitle?: ComponentChildren;
    readonly actions?: ComponentChildren;
    readonly trailing?: ComponentChildren;
    readonly chevron?: boolean;
    readonly expanded?: boolean;
    readonly danger?: boolean;
    readonly disabled?: boolean;
    readonly static?: boolean;
    readonly onClick?: () => void;
}) {
    const interactive = onClick !== undefined && isStatic !== true;
    const handler = interactive ? onClick : undefined;
    const classes = [
        'verzeta-navrow',
        interactive ? 'verzeta-navrow--interactive' : '',
        danger === true ? 'verzeta-navrow--danger' : '',
        disabled === true ? 'verzeta-navrow--disabled' : '',
    ]
        .filter((s) => s.length > 0)
        .join(' ');

    const content = (
        <>
            <span class="verzeta-navrow__icon" aria-hidden="true">
                {icon}
            </span>
            <span class="verzeta-navrow__body">
                <span class="verzeta-navrow__head">
                    <span class="verzeta-navrow__title">{title}</span>
                    {trailing !== undefined ? (
                        <span class="verzeta-navrow__trailing">{trailing}</span>
                    ) : null}
                    {chevron === true ? (
                        <span class="verzeta-navrow__chevron" aria-hidden="true">
                            <IconChevron expanded={expanded === true} />
                        </span>
                    ) : null}
                    {actions !== undefined ? (
                        <span class="verzeta-navrow__actions">{actions}</span>
                    ) : null}
                </span>
                {subtitle !== undefined && subtitle !== '' ? (
                    <span class="verzeta-navrow__subtitle">{subtitle}</span>
                ) : null}
            </span>
        </>
    );

    if (interactive) {
        return (
            <button
                type="button"
                class={classes}
                onClick={handler}
                disabled={disabled === true}
                aria-expanded={chevron === true ? expanded === true : undefined}
            >
                {content}
            </button>
        );
    }
    return <div class={classes}>{content}</div>;
}

// ====================================================================
// Inline SVG icons — single-stroke 24x24 grid, currentColor
// ====================================================================

function IconChevron({ expanded }: { readonly expanded: boolean }) {
    // 14 px chevron, rotates 90° when expanded. Replaces the
    // single-character ▾/› that rendered as a tiny dot on most
    // VS Code themes.
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 120ms ease',
            }}
        >
            <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function IconServer() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect
                x="3"
                y="4"
                width="18"
                height="6"
                rx="1.5"
                stroke="currentColor"
                stroke-width="1.6"
            />
            <rect
                x="3"
                y="14"
                width="18"
                height="6"
                rx="1.5"
                stroke="currentColor"
                stroke-width="1.6"
            />
            <circle cx="7" cy="7" r="1" fill="currentColor" />
            <circle cx="7" cy="17" r="1" fill="currentColor" />
        </svg>
    );
}

function IconPlus() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
            />
        </svg>
    );
}

function IconKey() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="8" cy="14" r="4" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M11 12l8-8M16 7l3 3M13 10l3 3"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function IconPerson() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function IconInfo() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M12 11v6M12 7.5v.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />
        </svg>
    );
}

function IconHistory() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M3 4v6h6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            <path
                d="M3.5 12a8.5 8.5 0 1 0 2.5-5.6L3 10"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            <path
                d="M12 8v5l3 2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function IconWrench() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M21 6.5a5 5 0 0 1-6.4 6.4L4 23l-3-3 10.1-10.1A5 5 0 0 1 17.5 3L14 6.5l3 3L21 6V5z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function IconChain() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M10 14l4-4M9 7l-2 2a4 4 0 0 0 5.7 5.7l2-2M15 17l2-2a4 4 0 0 0-5.7-5.7l-2 2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function IconSparkle() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
            <circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.6" />
        </svg>
    );
}

function IconRefresh() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M3 12a9 9 0 0 1 16-5.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-16 5.7L3 16M3 21v-5h5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function IconBook() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7V4z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function IconCheck() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 12l5 5L20 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function IconWarn() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M12 3l10 18H2L12 3z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
            <path
                d="M12 10v5M12 17v.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />
        </svg>
    );
}

// ====================================================================

function labelForState(state: HostConnectionState['state']): string {
    switch (state) {
        case 'disconnected':
            return 'Disconnected';
        case 'connecting':
            return 'Connecting…';
        case 'authenticating':
            return 'Authenticating…';
        case 'connected':
            return 'Connected';
        case 'reconnecting':
            return 'Reconnecting…';
        case 'unauthorized':
            return 'Unauthorized';
        case 'error':
            return 'Error';
    }
}

function formatRelative(timestampMs: number): string {
    // Tolerate seconds OR milliseconds from the host — same as
    // formatRelativeTime in MessageBubble.tsx.
    const ms = timestampMs < 1e11 ? timestampMs * 1000 : timestampMs;
    const deltaSeconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (deltaSeconds < 60) return 'just now';
    if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
    if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
    if (deltaSeconds < 604800) return `${Math.floor(deltaSeconds / 86400)}d ago`;
    const date = new Date(ms);
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}
