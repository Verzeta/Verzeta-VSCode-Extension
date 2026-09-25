<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Frequently asked questions

## Do I need the Verzeta Studio desktop to use this extension?

**Yes.** The extension is a client with no AI of its own. It connects to a
running Verzeta Studio host over a WebSocket. Without a paired host, the
Home tab shows only a card that asks you to add a host.

Verzeta Studio is free and open source. It runs on Linux and Windows.

---

## Does the extension run AI locally?

No. The extension sends your messages to the Verzeta Studio host over the
paired connection. The host runs the language models, either locally
(through Ollama) or through cloud providers (OpenAI, Anthropic, Gemini and
others) with API keys you set up on the host.

---

## Which AI models can I use?

Any model you have set up on the Verzeta Studio host. The host supports
local models through Ollama and cloud providers such as OpenAI, Anthropic
and Gemini. To pick a model for a chat, click the model name in the chat
header. Each agent's provider and model are set on the host.

---

## Is my data sent anywhere outside my own infrastructure?

The extension sends data only to the Verzeta Studio host you paired with.
The developer (Aditya Mehra) runs no relay servers, telemetry endpoints or
cloud services. Nothing from Verzeta sits between VS Code and your host.
Your host then sends prompts, and any file contents an agent reads, to the
model providers you set up on it.

---

## How is the connection secured?

- **`wss://`** (recommended for remote hosts): the connection uses TLS.
  When you turn on **TLS encryption** on the desktop, it uses a self-signed
  certificate. Enter its SHA-256 fingerprint as the TLS pin when you add
  the host, and the extension refuses any other certificate. If you leave
  the pin blank, the certificate must be signed by an authority your
  system trusts.
- **`ws://`** (the default): no encryption. Use it only on a trusted local
  network or on the same computer. Do not use `ws://` over the internet.

Pairing tokens are stored only in VS Code's `SecretStorage`, which uses
your operating system's keychain, never in settings files.

---

## What is stored locally by the extension?

- **Host configuration** (name, URL, TLS pin): VS Code settings
  (`verzeta.hosts`), plus `verzeta.defaultHostId`.
- **Pairing tokens**: VS Code `SecretStorage` (the OS keychain). Never
  written to disk in plain text.
- **Shared workspaces and their tier, and the command-execution setting
  for each conversation**: VS Code's per-workspace state.
- **Blocklist and Smart Mode options**: VS Code settings.

No message history is cached locally. All conversation data lives on the
host.

---

## How do I revoke a pairing?

**From the extension:** while connected, click **Revoke this device** on
the Settings tab (or at the bottom of the Home tab). The host invalidates
the token right away, and the extension deletes its stored copy. To delete
the local host entry too, run **Verzeta: Remove Host…**. To use the host
again later, run **Verzeta: Pair…** with a new pair code.

**Verzeta: Remove Host…** on its own removes the local host entry and its
stored token. It does not revoke the token on the host.

**From the host:** open Verzeta Studio, go to **Settings > Remote Access >
Manage Remote Access**, find this device under **Paired devices**, and
click **Revoke**. The token stops working right away. Then remove the host
in the extension.

---

## Can I pair the extension with more than one host?

Yes. Run **Verzeta: Add Host** for each host. The first host you pair is
used by default. To change that, set `verzeta.defaultHostId` to the host's
`id` from the `verzeta.hosts` setting, or click **Connect** next to another
host on the Settings tab. Each host has its own token, conversation list
and models.

---

## Can Verzeta for Android and Verzeta for VS Code be connected to the same host at the same time?

Yes. Both are clients of the same host. They can be connected at the same
time, see the same conversations and receive the same updates. Tool
confirmation prompts appear on the connected clients; once one client
answers, the prompt closes on the others.

---

## Does it work in Remote-SSH, WSL, Dev Containers or Codespaces?

Yes, but the extension runs on the remote machine. The host address must
be reachable from that machine, and `localhost` means the remote machine,
not your desktop. Shared workspaces and agent commands also run there, and
the device appears on the desktop under the remote machine's name. The
extension does not run in VS Code for the Web (vscode.dev).

---

## Why is Verzeta turned off in some folders?

VS Code turns Verzeta off in Restricted Mode. Trust the folder (run
**Workspaces: Manage Workspace Trust**) to use it there.

---

## Why does `@` in chat address agents instead of attaching context?

In Verzeta, `@` addresses agents (`@Researcher`, `@everyone`, and so on).
That is how you send a message to specific agents in a group chat. To add
files, selections or images, use the **+** menu, drag and drop, paste, or
the right-click **Verzeta** submenu.

---

## What happens if the extension and Verzeta Studio are on different versions?

The extension does not check the host's version. If they do not match, you
may see errors that mention `unknown_op`. Update both to the same release.

---

## Why is CodeLens off by default?

CodeLens shows **Verzeta: Explain**, **Verzeta: Add tests** and **Verzeta:
Refactor** links above functions and classes. In large files this can feel
cluttered, so it is off by default. Turn it on with
`"verzeta.codeLens.enabled": true`.

---

## Where do I report a bug or ask a question?

Open an issue at
<https://github.com/Verzeta/Verzeta-VSCode-Extension/issues>. When you
report a bug, include the output from the **Verzeta** output channel
(**View > Output**, then **Verzeta**) with `verzeta.log.level` set to
`debug`.
