<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

<div align="center">

<img src="resources/icon.png" width="128" alt="Verzeta for VS Code">

# Verzeta™ for VS Code

**Chat with the agents on your Verzeta Studio host from inside VS Code.**

[![License: LGPL-3.0-or-later](https://img.shields.io/badge/License-LGPL%203.0%2B-blue.svg)](LICENSE)
[![VS Code 1.95+](https://img.shields.io/badge/VS%20Code-1.95%2B-success.svg)](#requirements)
[![Built with TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-orange.svg)](https://www.typescriptlang.org/)
[![REUSE 3.0 compliant](https://img.shields.io/badge/REUSE-3.0-brightgreen.svg)](https://reuse.software/)

[![Website](https://img.shields.io/badge/Website-verzeta.com-2563eb.svg)](https://verzeta.com)
[![Follow @VerzetaAI](https://img.shields.io/badge/Follow-%40VerzetaAI-000000.svg?logo=x&logoColor=white)](https://x.com/VerzetaAI)
[![Reddit r/Verzeta](https://img.shields.io/badge/Reddit-r%2FVerzeta-FF4500.svg?logo=reddit&logoColor=white)](https://www.reddit.com/r/Verzeta/)

**[verzeta.com](https://verzeta.com) · [X / Twitter](https://x.com/VerzetaAI) · [Reddit](https://www.reddit.com/r/Verzeta/)**

</div>

Verzeta for VS Code connects VS Code to **Verzeta Studio**, a multi-agent
AI workspace that runs on your own desktop. You chat with one agent at a
time, or with a team of agents in a project room (`@Coord`,
`@Researcher`, `@Writer`, `@Critic`, or any team you define). With your
permission, agents can read and edit files in your workspace and run
commands in it. Each agent uses the provider and model you set for it
on the desktop. The extension connects only to hosts you pair it with.
There is no Verzeta cloud, no telemetry, and the extension never calls a
model provider itself.

<!--
  SCREENSHOT: hero shot of the Verzeta sidebar open next to code, a
  group room mid-conversation with two agents replying. Drop the image
  in media/ and reference it with the absolute raw URL of the public
  repo, e.g.
  ![Verzeta in VS Code](https://raw.githubusercontent.com/Verzeta/Verzeta-VSCode-Extension/main/media/hero.png)
-->

Verzeta has two clients: this extension and
[Verzeta for Android](https://github.com/Verzeta/Verzeta-Android). Both
connect to the same Verzeta Studio host.

---

## Requirements

This extension is a client and does nothing on its own. You need:

- VS Code 1.95 or newer. Showing Verzeta in the Secondary Side Bar needs
  VS Code 1.106 or newer; on older versions Verzeta is in the Activity
  Bar only.
- Verzeta Studio installed and running on a computer you control, with
  Remote Access turned on. See [verzeta.com](https://verzeta.com).
- A network path from VS Code to that computer: the same local network,
  or the host reachable over the internet with TLS turned on.

Without a paired, connected host, the Home tab shows only a card that
asks you to add a host. There is no offline mode.

## Install

In the Extensions view, search for **Verzeta**, or run:

```bash
code --install-extension verzeta.verzeta
```

## Pair with your host

1. In Verzeta Studio on the desktop, open **Settings > Remote Access**
   and click **Manage Remote Access**. Turn on the server switch so it
   reads **Server is running**. Note one of the addresses listed under
   **CLIENTS CAN REACH THIS HOST AT**, for example
   `ws://192.168.1.42:9180/ws`. Then click **Generate pair code**.
2. In VS Code, run **Verzeta: Add Host**, or click **＋ Add host** on the
   Verzeta Home tab.
3. Enter a name for the host and the address from step 1.
4. If the address starts with `wss://`, you are asked for a TLS pin.
   Paste the **SHA-256 FINGERPRINT** shown in the desktop dialog. The
   prompt is optional, but the desktop's self-signed certificate only
   works with it.
5. Enter the 6-digit pair code. A code works once and expires after
   5 minutes.
6. The extension pairs and connects. The Home tab shows the host as
   **CONNECTED**, and its conversations appear in the Chat tab.

See [Install and pair](docs/User/01-install-and-pair.md) for details and
[Troubleshooting](docs/User/09-troubleshooting.md) if pairing fails.

<!-- SCREENSHOT / GIF: the pairing flow (Add Host -> pair code -> connected). -->

---

## What you can do

### Chat with agents

- **Project rooms and group chats.** Talk to several agents in one
  conversation. Each reply shows which agent wrote it.
- **Address agents directly.** Start a message with `@alias` to send it
  to one member (`@Researcher find the prior art`), or with `@everyone`
  to send it to every member.
- **Per-agent provider and model.** Each agent can use a different
  provider and model. You set that up on the desktop.
- **Streaming and reasoning.** Replies stream in as they are generated.
  For models that think before answering, the reasoning is shown in a
  collapsed **Reasoning** section above the reply.
- **All your conversations.** Direct chats, group chats and project
  rooms from the paired host are listed in the Chat tab.

<!-- GIF: a group room where @Coord delegates and two agents reply, attributed inline. -->

### Where the chat can live

- **Activity Bar.** Click the Verzeta icon to open the chat in the side
  bar.
- **Secondary Side Bar.** On VS Code 1.106 and newer, Verzeta can also
  sit in the Secondary Side Bar. Both places show the same view.
- **Editor tab.** Run **Verzeta: Open Chat in Editor**, or click the
  icon in the view's title bar, to open the chat in an editor tab you
  can split or move.

### Editor AI actions

Select code, then open the lightbulb menu (or right-click and choose
**Verzeta**) to send the code to an agent. Each action writes a prompt
from your selection and sends it to the open conversation. The agent
answers in the chat, and it can edit files directly when your workspace
is shared with the chat.

- **Explain**, **Fix bugs**, **Refactor**, **Add tests** and **Add docs**
  on the selected code.
- **Fix this problem** appears on code with an error or warning
  underline. It sends the diagnostic message and the code.
- **Ask an Agent About This…** lets you pick a group member (or
  `@everyone`) and an action, then sends the selection.
- **CodeLens** links (Explain, Add tests, Refactor) above functions and
  classes. They are off by default; turn on `verzeta.codeLens.enabled`
  to show them.

<!-- GIF: select a function -> lightbulb -> Verzeta: Add tests -> agent replies. -->

### Adding context

- **Send Selection to Chat** and **Attach Active File to Chat** from the
  editor's right-click menu.
- **Add Context** (files from this workspace) or **Add Files** (files
  from your computer) from the composer's **+** menu.
- Drag files from the Explorer or your file manager onto the composer.
- Paste an image into the composer to attach it.
- **Add Git Diff to Chat** from the Source Control title bar.

> In Verzeta, `@` addresses agents. To add files or images, use the
> **+** menu, drag and drop, or paste.

### Source control and terminal helpers

- **Generate Commit Message** sends your staged diff (or the working-tree
  diff if nothing is staged) to an agent and asks for a commit message.
  The reply appears in the chat.
- **Send Last Terminal Command to Chat** sends the last command you ran
  in the integrated terminal, with its output, to the chat. It needs
  terminal shell integration.

### Canvas and applying edits

- **Open canvas in editor** (in the chat header's **⋯** menu) opens the
  conversation's canvas in a read-only editor tab. The tab updates when
  the agent changes the canvas.
- An **Apply** button appears on code blocks that name a file. It shows
  the change as a diff and applies it as a normal VS Code edit you can
  undo.

---

## Share your workspace with a chat

Sharing your workspace (a workspace mount) lets the agents in a chat
list, read and write files in your VS Code workspace. The host asks for
files over the paired connection when an agent needs them. Your editor
serves each file, and the host does not keep a copy. File contents an
agent reads are sent to the model provider that agent uses.

- **Share the workspace** from the **Share workspace** banner in the
  chat, or with **Verzeta: Register Workspace Mount**. In a project room
  with one workspace folder open, it is shared automatically on your
  first message (turn off with `verzeta.workspaceMount.autoRegister`). A
  status bar item shows the active share.
- **Permission tiers** control how writes are approved:
    - **Ask.** Every write waits for you to approve it.
    - **Smart.** Edits to listed source and text file types apply
      without asking. Large edits (over 500 changed lines, over 256 KiB,
      or a new file over 200 lines) ask first. You can change the file
      types and the line and size limits with the
      `verzeta.workspaceMount.smartMode.*` settings.
    - **Bypass.** Writes apply without asking. It cannot be the default
      tier; you choose it each time from the tier picker.
- **Safety rules apply in every tier.** A write is refused when the
  file's extension is not on the Smart Mode list, when the path matches
  your blocklist, or when the content looks dangerous (for example
  embedded credentials, or a download piped into a shell).
- **Built-in blocklist.** Agents can never read or write credentials,
  keys, `.env` files, `.git`, `node_modules` or build output folders.
  Globs you add to `verzeta.workspaceMount.blocklist` block matching
  paths too, and `verzeta.workspaceMount.allowlist` can limit agents to
  the paths you list.

<!-- SCREENSHOT: the workspace-mount status bar item + the tier picker. -->

## Running commands in your workspace

When your workspace is shared with a chat, an agent can run shell
commands in it, such as a search, a build or the test suite. You
control this for each conversation in **Chat settings** (the gear in the
chat header), under **Command execution**:

- **Off** (the default). The command runs on the host instead. A banner
  in the chat offers **Ask each time** or **Allow** for this device.
- **Ask.** Each command waits for you to click **Run** or **Cancel**.
- **Allow.** Commands run without asking.

On Linux, commands run inside bubblewrap (`bwrap`), and on macOS inside
`sandbox-exec`, when those are available. Windows has no sandbox, so
commands there run with your full permissions. The extension warns you
once per session when a command runs without a sandbox. A safety filter
blocks dangerous commands in every mode, including Allow.

<!-- GIF: agent runs a grep / test command, the in-chat Ask confirmation, the result. -->

---

## Privacy

- **No Verzeta cloud.** The extension connects only to hosts you pair
  it with.
- **No direct model calls.** The extension never talks to OpenAI,
  Anthropic, Gemini, Ollama or any other model provider. Your host does.
- **No telemetry, analytics or crash reporting.**
- **Your workspace stays on your machine.** Shared files are served on
  request and are not stored on the host.

```
VS Code extension  ──WebSocket──►  Verzeta Studio (your desktop)
                                        │
                                        ▼
                              Model providers you configured
                       (Ollama / OpenAI / Anthropic / Gemini / …)
```

---

## Commands

Commands in the Command Palette, all under the **Verzeta** category:

| Command                                         | What it does                                               |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Verzeta: Add Host                               | Add and pair a Verzeta Studio host.                        |
| Verzeta: Remove Host…                           | Remove a host and its token from VS Code.                  |
| Verzeta: Open Chat in Editor                    | Open the chat in an editor tab.                            |
| Verzeta: Send Selection to Chat                 | Put the selected code into the composer.                   |
| Verzeta: Attach Active File to Chat             | Attach the file in the active editor.                      |
| Verzeta: Attach Open Files to Chat…             | Attach one or more open files.                             |
| Verzeta: Add Context (Workspace Files) to Chat  | Pick workspace files to attach.                            |
| Verzeta: Add Git Diff to Chat                   | Put the current Git diff into the composer.                |
| Verzeta: Generate Commit Message                | Ask an agent to write a commit message from your changes.  |
| Verzeta: Send Last Terminal Command to Chat     | Send the last terminal command and its output to the chat. |
| Verzeta: Ask an Agent About This…               | Pick a member and an action for the selected code.         |
| Verzeta: Register Workspace Mount               | Share this workspace with a chat.                          |
| Verzeta: Unregister Workspace Mount             | Stop sharing the workspace.                                |
| Verzeta: Refresh Workspace Mount Tree           | Send an updated file list to the host.                     |
| Verzeta: Change Workspace Mount Permission Tier | Switch between Ask, Smart and Bypass.                      |

**Verzeta: Pair…** and **Verzeta: New Conversation** also appear in the
Command Palette, but they only show a message. Pair a host with
**Verzeta: Add Host**, and start a chat with **New chat** in the Chat
tab.

**Add to Verzeta Chat** is in the Explorer's right-click menu. The editor
AI actions (Explain, Fix bugs, Refactor, Add tests, Add docs, Fix this
problem) appear in the lightbulb menu and as CodeLens links, not in the
Command Palette.

## Settings

| Setting                                               | Default           | Description                                                                                 |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `verzeta.hosts`                                       | `[]`              | Paired hosts. Use Add Host and Remove Host instead of editing this directly.                |
| `verzeta.defaultHostId`                               | `""`              | The `id` of the host to use at startup. When empty, the first paired host is used.          |
| `verzeta.connectOnStartup`                            | `true`            | Connect to the default host when VS Code starts.                                            |
| `verzeta.log.level`                                   | `"info"`          | How much the Verzeta output channel logs.                                                   |
| `verzeta.initialTab`                                  | `"home"`          | Which tab the Verzeta view opens on.                                                        |
| `verzeta.codeLens.enabled`                            | `false`           | Show Verzeta CodeLens links above functions and classes.                                    |
| `verzeta.workspaceMount.defaultTier`                  | `"ask"`           | Tier pre-selected when you share a workspace. `bypass` cannot be the default.               |
| `verzeta.workspaceMount.blocklist`                    | `[]`              | Extra path globs agents may not list, read or write. The built-in blocklist always applies. |
| `verzeta.workspaceMount.smartMode.extensionAllowlist` | source extensions | File extensions agents may write to. Writes to other extensions are refused in every tier.  |
| `verzeta.workspaceMount.smartMode.maxDiffLines`       | `500`             | In Smart, a write that changes more lines than this asks first.                             |
| `verzeta.workspaceMount.smartMode.maxFileBytes`       | `262144`          | In Smart, a write larger than this many bytes (256 KiB) asks first.                         |
| `verzeta.reconnect.backoffMs`                         | `1000`            | Delay before the one automatic reconnect attempt, in milliseconds.                          |
| `verzeta.workspaceMount.autoRegister`                 | `true`            | Share the workspace automatically in a project room with one folder open.                   |
| `verzeta.workspaceMount.allowlist`                    | `[]`              | When not empty, agents can only use paths matching these globs.                             |

Settings for a single conversation (model, system prompt, sampling,
thinking, memory, command execution and more) are in **Chat settings**
inside the chat, not in VS Code settings, because they belong to the
conversation on the host.

---

## Security

The extension has one runtime dependency, `undici`, which is bundled in.
The package ships two bundled scripts, `dist/extension.js` and
`dist/webview/index.js`, and no `node_modules` folder. Pairing tokens
are stored only in VS Code `SecretStorage`, which uses your operating
system's keychain. When you enter a SHA-256 fingerprint for a `wss://`
host, the extension pins the host's certificate to it. See
[SECURITY.md](SECURITY.md) for details.

## Documentation

User guides are in [docs/User/](docs/User/).

| Topic                                            | Page                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| What Verzeta for VS Code is and how it works     | [Introduction](docs/User/00-introduction.md)                 |
| Installing the extension and pairing with a host | [Install and pair](docs/User/01-install-and-pair.md)         |
| Browsing and managing conversations              | [Conversations](docs/User/02-conversations.md)               |
| Chatting with agents and teams                   | [Chatting](docs/User/03-chatting.md)                         |
| Projects, folders and group chats                | [Projects and rooms](docs/User/04-projects-and-rooms.md)     |
| Editor actions, context and commands             | [Editor integration](docs/User/05-editor-integration.md)     |
| Sharing your workspace with a chat               | [Workspace mount](docs/User/06-workspace-mount.md)           |
| Canvas documents and artifacts                   | [Canvas and artifacts](docs/User/07-canvas-and-artifacts.md) |
| Extension and conversation settings              | [Settings](docs/User/08-settings.md)                         |
| Error messages and how to fix them               | [Troubleshooting](docs/User/09-troubleshooting.md)           |
| Frequently asked questions                       | [FAQ](docs/User/10-faq.md)                                   |
| What stays on your machine                       | [Privacy summary](docs/User/11-privacy-summary.md)           |

## Community

- **Website:** [verzeta.com](https://verzeta.com)
- **X / Twitter:** [@VerzetaAI](https://x.com/VerzetaAI)
- **Reddit:** [r/Verzeta](https://www.reddit.com/r/Verzeta/)
- **Verzeta Studio (desktop host):** [verzeta.com](https://verzeta.com)
- **Verzeta for Android:** [github.com/Verzeta/Verzeta-Android](https://github.com/Verzeta/Verzeta-Android)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). By contributing you accept the
[Contributor License Agreement](CLA.md).

## License

Licensed under **LGPL-3.0-or-later**. See [LICENSE](LICENSE) and
[LICENSES/LGPL-3.0-or-later.txt](LICENSES/LGPL-3.0-or-later.txt).
