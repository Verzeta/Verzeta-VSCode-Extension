<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Projects, folders, and group chats

Verzeta organizes conversations into **folders**. A folder can be a plain
container, or a **project** or **organization** with named members and its
own settings. Group chats let several agents, each with an alias, work
together in one conversation.

Everything lives on your paired Verzeta Studio host. The extension shows
the same data as the desktop.

---

## Folders and project folders

The Chat tab shows your folder tree. There are three types of folder:

| Type             | When to use                                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| **Regular**      | A plain container for conversations. No members, no settings.                       |
| **Project**      | A focused effort with several agents. Has members, preferred skills and documents.  |
| **Organization** | A broader workspace that can hold several projects. Also has members and documents. |

To create a folder, click **New folder** in the Chat tab. To edit one,
click the gear on its header.

---

## Project members

A project or organization folder has a **team**: a list of agents, each
with:

- A unique **alias** (for example `@Coord`, `@Researcher`, `@Writer`,
  `@Critic`). You address agents in chat by their alias.
- An optional **coordinator** mark for the agent that directs the others.

In the folder editor you can add members, set their aliases and choose the
coordinator. Every member needs an alias: **Save** stays disabled until
each one has one. Each member also has a **Configure** button with a
provider, model and tool whitelist. The editor shows the choices already
saved on the host, including ones made on the desktop.

- For a member of a project that already exists, **Apply** in Configure
  saves the three choices on the host right away. You do not need to
  click **Save**. Clearing a choice removes that override. If the host
  cannot save it, an error appears.
- For a new project, or a member you just added, the choices are saved
  with the team when you click **Create** or **Save**.

Saving the folder keeps every member's provider, model and tools, and
who added the member, so a save from the extension does not undo
settings made on the desktop.

---

## Project Rooms and templates

The **Project Rooms** card on the Home tab opens a page with your rooms and
a set of templates. Click **New project**, or **Quick Start** on a
template, to fill in a name, scenario, goal, description and teammates,
including each teammate's provider, model and tools, then click **Create
room**. **Save as template** keeps these choices in your own template. **Browse all** opens the **Template Library**.

If the host cannot create the room, the reason appears in the Quick Start
form and the form stays open, so you can fix it and try again.

---

## Start a group chat or 1:1 conversations

After you create a project with members, Verzeta asks **Start chatting
with your team?** and offers:

- **Create a 1:1 conversation with each member**: a separate 1:1 chat with
  each member.
- **Start a group chat with all members**: one conversation where all
  members take part. It needs at least two members.

Later, you can click **Start Group Chat with All** under a project, or a
member's name to open a 1:1 chat with that member.

---

## Addressing agents in group chats

In a group chat, each reply shows the alias of the agent that wrote it.
To address one agent, start your message with its alias:

- `@Researcher what do you know about WebSockets?` goes to the
  `@Researcher` agent.
- With no alias, the coordinator decides who responds.

**Ask an Agent About This…** in the editor uses the same aliases (see
[Editor integration](05-editor-integration.md)).

---

## Project documents

Projects can have **project documents**: reference files stored on the
host that agents can use during the conversation. Upload them in the
folder editor's **Project documents** section, up to 16 MB per file, or
from the desktop.

The folder editor also has **Project heartbeats** (scheduled agent runs),
**Preferred skills** and an **Activity log**. Editing a heartbeat from the
extension keeps the report criteria and self-configuration setting chosen
on the desktop. **View recent runs** on a heartbeat lists that heartbeat's
latest runs, or says there are none.

---

## What the extension does not do here

- **Install skills or tools.** The desktop controls what is installed.
  You can choose a project's preferred skills from the extension.
- **Reorder or merge folders.** Use the desktop for that.
