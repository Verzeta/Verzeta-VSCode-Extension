<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Conversations

The Verzeta view is where you browse everything on your paired desktop.
Open it by clicking the Verzeta icon in the Activity Bar.

## The tabs

The view has three tabs:

| Tab          | What it shows                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**     | The active host and its connection state, Project Rooms, other hosts, recent conversations, and **Ping** and **Revoke this device** at the bottom |
| **Chat**     | The conversation list, and the open conversation                                                                                                  |
| **Settings** | Hosts, other devices paired with the host, the host's tools, MCP servers and skills, the web search provider, a session check, and help           |

On the Home tab, the host card has **Open chat** and **Manage** buttons.
On the Settings tab, **Verify session** checks that the host still accepts
this device's token, and **Open output channel** opens the Verzeta log.

## The conversation list

The conversation list in the Chat tab mirrors the desktop's sidebar. Every
chat on the paired desktop appears here, grouped into sections:

| Section           | What it contains                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| **Pinned**        | Conversations pinned on the desktop                                                                    |
| **Project Rooms** | Project and organization folders. Expand one to see its members, its group chats and its direct chats. |
| **Group Chats**   | Group chats that are not in a folder                                                                   |
| **Direct Agents** | 1:1 chats with a specific agent that are not in a folder                                               |
| **Plain Chats**   | Chats with no primary agent that are not in a folder                                                   |

Click a conversation to open it. The list stays up to date: conversations
created on the desktop appear automatically.

## Open Chat in Editor

To have the chat next to your code, click the **Open Chat in Editor** icon
in the view's title bar, or run **Verzeta: Open Chat in Editor**. The chat
opens in an editor tab, which you can drag to any editor group or split.

The side bar view and the editor tab can be open at the same time and stay
in sync.

## Starting a new conversation

1. In the Chat tab, click **New chat**, or run **Verzeta: New
   Conversation** from the Command Palette. The command creates the chat
   on the active host and opens the Verzeta view on it. It asks you to
   connect first if no host is connected.
2. The new chat opens with the host's current model. To change the model,
   click the model name in the chat header.

## Starting a group chat

Click **New group** in the Chat tab. Give the chat a title and add members,
each with an alias. Group chats created on the desktop appear in the list
too, under **Group Chats** or inside the project folder they belong to.

## Deleting a conversation

Each conversation in the list has a delete (trash) button. You are asked
to confirm before it is deleted. Renaming and pinning are done on the
desktop; pinned chats appear under **Pinned**.

## What the Verzeta view does not do

- **Search across hosts.** The list shows conversations from the active
  host only.
- **Bulk actions.** There is no multi-select or bulk delete.
- **Export.** The extension cannot export a conversation. Use the desktop
  to archive one.
