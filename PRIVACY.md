<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Verzeta™ Privacy Policy (VS Code extension)

_Last updated: 2026-09._

Verzeta for VS Code is a paired companion to the Verzeta Studio
desktop application. **The extension does not run AI or
language-model code in the editor.** It pairs with the user's own
desktop instance of Verzeta Studio over a WebSocket connection, and
all processing happens on that desktop machine, which the user
controls.

## Who runs this service

The Verzeta extension is published by **Aditya Mehra** (sole
developer). There is **no Verzeta-controlled cloud service, no
intermediary server, no developer-accessible data store** that sits
between the extension and your desktop. The extension makes outbound
network calls **only to the desktop hosts you pair it with**.

## What the extension stores

The extension persists a small amount of state through VS Code's own
storage APIs. Nothing else is written by this extension.

- **Pairing tokens**: one bearer credential per paired desktop,
  issued by your desktop's Verzeta Studio instance during pairing.
  Stored in **VS Code `SecretStorage`**, which is backed by the OS
  keychain on every supported platform (libsecret/GNOME Keyring or
  KWallet on Linux, Keychain on macOS, the Credential Manager on
  Windows). The desktop stores only `SHA-256(token)`, and you can
  revoke a device under **Settings > Remote Access > Manage Remote
  Access > Paired devices**, so a leaked token can be invalidated
  immediately.

- **Host configuration**: the hostname, port and scheme (`ws://` or
  `wss://`) of each Verzeta Studio desktop you have paired with, the
  display name you chose and, if you entered one, the SHA-256
  certificate fingerprint (TLS pin). Stored in your VS Code settings
  (`verzeta.hosts`). No token is stored in this setting; tokens live
  only in `SecretStorage`.

- **Per-conversation command-execution policy** (Off / Ask / Allow for
  running commands in your workspace): stored in the extension's
  `workspaceState` (per VS Code workspace), never globally. Workspace
  mount bindings (which folder is shared with which chat, and the
  tier) are also kept there.

- **Other preferences**: small UI and behaviour settings (log level,
  initial tab, CodeLens on/off) under the `verzeta.*` settings
  namespace.

The extension does not write any database, cache, analytics buffer,
cookie, or log file beyond VS Code's own Output channel (which stays
on your machine).

## What the extension sends off-device

When you send a message, attach a file, add context, or change a
configuration, the extension transmits that data **over the WebSocket
you initiated, to the user-controlled desktop you specified during
pairing**. If you share a workspace with a conversation, the files an
agent asks for are served to that same paired desktop. The desktop
processes everything, may forward it to the language-model providers
you have configured there (Ollama running locally, OpenAI, Anthropic,
Gemini or others, as you choose on the desktop), and streams responses
back.

No data is routed through Verzeta-controlled servers. The extension
opens a direct connection to the host you specify during pairing.
Nothing transits a Verzeta-owned middleman.

## What the extension does NOT collect or transmit

The extension does **not** read, store, or send:

- Your name, email address, phone number, or any identifier
- Your physical location
- Any advertising or device identifier
- Browser history, editor activity, or any background telemetry
- Any crash report or stack trace

The extension contains **no third-party analytics, crash-reporting,
advertising, or telemetry SDK**. There are none in its dependency
tree. The only dependency that touches the network is `undici`, used
solely as the WebSocket transport for the connection you initiate.

## What the developer sees

**Nothing.** We do not operate any servers that receive your data.
The developer cannot read your chat messages, see your desktop's
configuration, or observe your activity. There is no service
infrastructure to do so.

## Security

- **Transport security.** When you pair over `wss://`, the extension
  uses TLS. For a self-signed certificate (what the desktop uses when
  you turn on **TLS encryption**), the client pins the certificate by
  its SHA-256 fingerprint. You copy the fingerprint from the desktop's
  Remote Access dialog and paste it into the Add Host flow. Any other
  certificate is refused on later connections.

- **Cleartext (`ws://`) on the local network.** Plain WebSockets are
  intended for local-network use only (e.g. a host on the same
  machine or LAN). For any internet-exposed host you should use
  `wss://` with a CA-signed certificate or a self-signed certificate
  plus fingerprint pin.

- **Token storage.** Tokens live in VS Code `SecretStorage` (the OS
  keychain), never in plaintext settings or files.

For the full security posture and how to report a vulnerability, see
[SECURITY.md](SECURITY.md).

## Revoking access

Ways to remove a pairing:

1. **From the desktop**: open Verzeta Studio, go to **Settings > Remote
   Access > Manage Remote Access**, find the editor under **Paired
   devices**, and click **Revoke**. The host invalidates the token
   immediately.

2. **From the extension**: while connected, click **Revoke this
   device** on the extension's Settings tab. The host invalidates the
   token. Removing the host afterwards (**Verzeta: Remove Host…**)
   deletes the local copy.

Removing a host without revoking it deletes only the local copy of the
token; the token stays valid on the host. Uninstalling the extension
does not revoke the token on the host either. Revoke the device first
with option 1 or 2.

## Your data subject rights

Because we (the developer) do not operate any servers and do not store
any user data on our own infrastructure, there is no data-controller
relationship to invoke GDPR / CCPA-style rights against. All data the
extension produces lives either on your own machine (VS Code's
SecretStorage + settings + workspace state) or on your own paired
desktop, which you operate and control completely.

For data stored on the desktop side, refer to Verzeta Studio's own
privacy policy and compliance posture in the host repository.

## Changes to this policy

When this policy changes we update the date at the top of this file.
Material changes (new data categories, new transit
destinations, new third parties) may also be noted in the extension's release notes.

## Contact

- Email: <hello@verzeta.com> with the subject prefix `[Verzeta Privacy]`.
