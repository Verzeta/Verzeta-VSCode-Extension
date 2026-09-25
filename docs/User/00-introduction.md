<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# What is Verzeta for VS Code?

Verzeta for VS Code is a client for **Verzeta Studio**, the multi-agent AI
workspace that runs on your desktop. The extension does not run AI or
language models inside the editor. Conversations and tool calls live on the
desktop where Verzeta Studio is installed. Project files you share from
VS Code stay in your workspace, and agents read them on request.

You install Verzeta Studio on a desktop or laptop, turn on Remote Access,
and pair this extension with it. You can then use your desktop's agents
from VS Code.

## What you can do from VS Code

- Chat with the AI agents on your desktop. Replies stream in as they are
  generated.
- Browse and open every conversation on the paired desktop (direct agent
  chats, group chats and project rooms) from the Chat tab.
- Address individual agents in a group chat with `@alias` mentions
  (`@Coord`, `@Researcher`, `@Writer`, `@Critic`, and so on).
- Attach files, paste images, drag and drop files from the Explorer, or add
  the current Git diff without leaving the editor.
- Send the selected code or the active file to the chat from the right-click
  menu.
- Pick a group member and an action (Explain, Fix bugs, Refactor, Add tests,
  Add docs) for the selected code.
- Generate a commit message from your changes with the Source Control
  toolbar.
- Send the last terminal command and its output to the chat for help.
- Open the chat in an editor tab ("Open Chat in Editor") so it sits next to
  your code.
- Share your workspace with a chat so agents can read and edit files and,
  if you allow it, run commands.
- Read the reasoning of models that think before answering.
- Turn on CodeLens links (Explain, Add tests, Refactor) above functions and
  classes. They are off by default.

## What it does not do

- **No standalone AI.** Without a paired and connected desktop, the Home
  tab shows only a card that asks you to add a host. There is no offline
  mode.
- **No data goes to Verzeta servers.** The extension connects only to
  desktops you pair it with. There is no Verzeta-operated cloud service.
- **No direct model calls.** The extension does not talk to OpenAI,
  Anthropic, Gemini, Ollama or any other model provider. Your paired
  Verzeta Studio host does that.
- **No telemetry, analytics or crash reporting.**

## How the host and client work together

```
VS Code extension  ──WebSocket──►  Verzeta Studio (desktop)
                                        │
                                        ▼
                              Language-model providers
                              (Ollama / OpenAI / Anthropic
                               / Gemini / others, your config)
```

The extension sends your messages and attachments to the desktop over a
WebSocket and shows what the desktop sends back. The desktop handles model
selection, tools, context and agent routing. You set up providers once on
the desktop, and the extension uses them.

## What you need

- **VS Code 1.95 or newer.**
- **A reachable Verzeta Studio host.** Verzeta Studio must be installed and
  running on a computer you control, with Remote Access turned on.
- **A network path between them.** Both on the same local network, or the
  desktop reachable over the internet with TLS turned on.

See [Install and pair](01-install-and-pair.md) for setup.
