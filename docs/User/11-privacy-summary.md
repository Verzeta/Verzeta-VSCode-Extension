<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Privacy at a glance

For the full policy, see [PRIVACY.md](../../PRIVACY.md) at the root of this
repository. This page is a short digest.

## Short version

Verzeta for VS Code sends data only to **your own desktop**. There is no
Verzeta cloud service. The developer cannot read your data because there is no
developer-controlled infrastructure that receives it.

## What the extension stores

| What                                                                                                       | Where                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pairing tokens (one per paired desktop)                                                                    | VS Code `SecretStorage`, backed by the OS keychain (GNOME Keyring / KWallet on Linux, Keychain on macOS, Credential Manager on Windows); never in plaintext files or settings |
| Host configuration (name, URL, TLS pin)                                                                    | VS Code `settings.json` under `verzeta.hosts` (no token is stored here)                                                                                                       |
| Command-execution setting for each conversation (Off / Ask / Allow), and shared workspaces with their tier | VS Code `workspaceState` for the active workspace                                                                                                                             |
| UI preferences (log level, initial tab, CodeLens on/off)                                                   | VS Code `settings.json` under `verzeta.*`                                                                                                                                     |

No database, no message cache, no analytics buffer, no log files beyond the
VS Code Output channel (which stays on your machine).

## What the extension sends off your machine

When you send a message, attach a file, or change a setting, the extension
sends that data **over the WebSocket you opened, to the desktop you paired
with**. If you share your workspace with a chat, files an agent asks for are
sent to that same desktop. The desktop processes everything, may forward it
to the language-model providers you set up there (Ollama, OpenAI,
Anthropic, Gemini or others, as you choose on the desktop), and streams the
responses back.

Nothing is routed through Verzeta-controlled servers. The extension opens a
direct connection to the host you specify during pairing.

## What the extension does NOT collect

The extension does not read, store, or send:

- Your name, email address, or any personal identifier
- Your physical location
- Any advertising or device identifier
- Editor activity, browsing history, or background telemetry of any kind
- Crash reports or stack traces

The extension contains **no third-party analytics, crash-reporting,
advertising or telemetry SDK.** The only dependency that touches
the network is `undici`, used solely as the WebSocket transport for the
connection you initiate.

## What the developer sees

**Nothing.** There are no developer-operated servers that receive your data.
The developer cannot read your chat messages, inspect your desktop's
configuration, or observe your activity.

## Transport security

- **`wss://` (TLS):** Recommended for any host not on the same machine or
  local network. The desktop uses a self-signed certificate when you turn
  on **TLS encryption**. Paste its SHA-256 fingerprint as the TLS pin when
  you add the host, and the extension refuses any other certificate on
  every connection.
- **`ws://` (cleartext):** Intended for local-network or same-machine use
  only. Do not use cleartext WebSockets for a host exposed to the internet.

## Revoking access

Ways to remove a pairing:

1. **From the desktop:** in Verzeta Studio, open **Settings > Remote Access >
   Manage Remote Access**, find this device under **Paired devices**, and
   click **Revoke**. The host invalidates the token right away.
2. **From the extension:** while connected, click **Revoke this device** on
   the Settings tab. The host invalidates the token and the extension
   deletes its stored copy. Run **Verzeta: Remove Host…** to delete the
   local host entry as well.

**Verzeta: Remove Host…** on its own deletes the host and its token from
VS Code only. Uninstalling the extension does not revoke the token on the
host either. Revoke the device first with option 1 or 2.
