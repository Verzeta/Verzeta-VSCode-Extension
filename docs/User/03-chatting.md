<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Chatting

Open a conversation in the Chat tab and type in the composer at the bottom
of the chat. Replies stream in as the agent writes them.

## Sending a message

Type your message and press **Enter**, or click the send button. Press
**Shift+Enter** for a new line. Your message goes to the paired desktop,
and the reply streams back as it is generated.

## Stopping a reply

While a reply is streaming, the send button becomes a stop button
(**Stop generation**). Click it to stop the reply. The desktop stops
generating.

If the desktop is still busy with a reply when your message arrives, it
queues the message and the extension shows "Message queued. It will be
sent when the current reply finishes."

## Mentioning agents

In a group conversation you can send a message to a specific agent by
starting it with the agent's alias:

| Mention                                                         | Effect                                 |
| --------------------------------------------------------------- | -------------------------------------- |
| `@everyone`                                                     | All agents in the conversation respond |
| `@Coord` / `@Researcher` / `@Writer` / `@Critic` (or any alias) | Only that agent responds               |

Start the message with `@` and the agent's alias. In a 1:1 chat you do not
need a mention, because there is only one agent.

## Composer toggles

Next to the send button are three toggles:

- **Thinking**: ask models that support it to reason before answering.
- **Tools**: let agents use the host's tools in this conversation.
- **RAG**: add retrieved context to the prompt for this conversation.

The same switches are in **Chat settings** (the gear in the chat header).

## Starting a task

Click the **Start task** button (the calendar icon with a check mark,
next to **+**) to open
**Start a task**. Describe the goal and click **Start task**. The agent
keeps working, using tools as needed, until the goal is done. Track
progress in **Plans** in the chat header's **⋯** menu.

## Attaching files and images

### Paste an image

Copy an image and press `Ctrl+V` / `Cmd+V` in the composer. The image is
attached to your next message.

### Drag and drop files

Drag one or more files from the VS Code Explorer or from your file manager
onto the composer. The files are attached to your next message. If
dropping does nothing, hold **Shift** while you drop.

### The + menu

Click **+** in the composer and choose:

- **Add Context**: pick files from this workspace.
- **Add Files**: browse files on your computer.

### Attach active or open files

Right-click in the editor, open the **Verzeta** submenu, and choose:

| Command                        | What it attaches                    |
| ------------------------------ | ----------------------------------- |
| **Attach Active File to Chat** | The file open in the focused editor |
| **Attach Open Files to Chat…** | A picker that lists all open files  |

You can also right-click a file in the Explorer and choose **Add to Verzeta
Chat**. Right-clicking an editor tab offers **Attach Active File to Chat**.

### Attachment limits

- Up to 8 attachments per message.
- Files you attach from VS Code (the editor, the Explorer or **Add
  Context**) can be at most 4 MiB each.
- Files you add with **Add Files**, paste or drop from your file manager
  can be at most 16 MiB each, and all attachments together at most 16 MiB.
- File names cannot start with a dot or contain `/`, `\` or `..`. Such a
  file is refused when you attach it, with a message, and nothing else in
  the composer is lost.

See [Troubleshooting](09-troubleshooting.md#attachment-rejected) for the
exact messages.

### Add Git Diff

Click **Add Git Diff to Chat** in the Source Control title bar, or run it
from the Command Palette. It puts the working-tree diff (or the staged diff,
if the working tree has no changes) into the composer as text, so you can
ask the agent to review your changes. Diffs longer than 60,000 characters
are cut off.

## Editor right-click (Verzeta submenu)

When you right-click in an editor, the **Verzeta** submenu offers:

| Action                                    | What it does                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ask an Agent About This…**              | In a group chat, pick a member or `@everyone`, then pick an action (Explain, Fix bugs, Refactor, Add tests, Add docs). The selection is sent right away. Needs a selection. |
| **Send Selection to Chat**                | Puts the selection into the composer as a code block, without sending it. Needs a selection.                                                                                |
| **Attach Active File to Chat**            | Attaches the current file                                                                                                                                                   |
| **Attach Open Files to Chat…**            | Opens a picker of open files                                                                                                                                                |
| **Add Context (Workspace Files) to Chat** | Opens a picker of workspace files                                                                                                                                           |

## Generate Commit Message

In the Source Control view, click the **Generate Commit Message** sparkle
icon, or run **Verzeta: Generate Commit Message**. It sends your staged diff
(or the working-tree diff if nothing is staged) to the open conversation
and asks the agent for a commit message. The reply appears in the chat;
copy it into the commit message box.

## Send Last Terminal Command

Right-click in the integrated terminal and choose **Send Last Terminal
Command to Chat**. It sends the last command you ran and its output to the
open conversation. If the command failed, the message asks the agent to
help fix it. Shell integration must be active in the terminal.

## Reasoning

For models that reason before answering (such as qwen3, DeepSeek-R1, Claude
with extended thinking, Gemini 2.5 and OpenAI o1 / o3), the reply has a
collapsed **Reasoning** section above it when the model produced any. Click
it to expand or collapse it.

The reasoning is shown for reading only. It is not sent back to the host
on later turns.

To turn reasoning on, use the **Thinking** toggle next to the send button
or in **Chat settings**.

## Slash commands

Type `/` in the composer to see the available slash commands with short
hints: `/help`, `/compact` (summarise older messages now), `/flashmemory`
(clear the conversation's messages after you confirm), `/artifacts`,
`/showtools`, `/showmcptools`, `/tools`, `/clear`. Pick one to put it in
the composer. Its output appears in the chat as a system entry.

## The context gauge

Next to the send button, a small gauge shows how full the model's context
window was at the last exchange:

- **Grey**: plenty of room.
- **Amber (70% or more)**: older messages may soon stop fitting, and
  automatic compaction may run soon.
- **Red (90% or more)**: the window is nearly full.

The gauge appears after the first reply of the session.

## System entries

Some rows in the chat come from the system rather than a person or agent:
compaction receipts, turn notes and sub-agent reports. A sub-agent report
appears when a background task the agent handed off has finished. Short
notes appear as a centered line; full reports appear as a card you can
copy.

## What the chat does not do

- **Edit or unsend messages.** There is no edit or retract.
- **Emoji reactions.** Not supported.
- **Voice input.** The extension does not use the microphone.
