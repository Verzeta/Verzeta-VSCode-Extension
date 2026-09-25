<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Editor integration

This page covers every way to send code to an agent, run AI actions on
code, and use what the agent sends back, without leaving the editor.

---

## Where the chat view lives

The extension adds the chat view in two places:

- **Activity Bar**: click the Verzeta icon to open the chat in the primary
  side bar.
- **Secondary Side Bar**: on VS Code 1.106 and newer, Verzeta also appears
  in the Secondary Side Bar, alongside other chat panels. You can drag its
  tab wherever you like.

Both places show the same view and the same open conversation.

---

## Open Chat in Editor

Click the **Open Chat in Editor** icon (the open-in-new-window icon) in the
view's title bar, or run **Verzeta: Open Chat in Editor** from the Command
Palette. The chat opens in an editor tab that you can split, move to
another editor group, or place next to your code.

The editor tab and the side bar stay in sync; messages sent in one appear
in both.

---

## The Verzeta right-click submenu

Right-clicking in an editor shows a **Verzeta** submenu:

| Item                                      | What it does                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Ask an Agent About This…**              | Sends the selection to an agent you pick (see below). Shown only when text is selected.                   |
| **Send Selection to Chat**                | Adds the selection to the composer as a code block, without sending it. Shown only when text is selected. |
| **Attach Active File to Chat**            | Attaches the whole current file to the composer.                                                          |
| **Attach Open Files to Chat…**            | Lets you pick open files to attach.                                                                       |
| **Add Context (Workspace Files) to Chat** | Opens a picker of workspace files to attach.                                                              |

Context goes into the composer of the chat that is open.

---

## Code Actions (lightbulb, `Ctrl+.`)

Select code and open the Code Actions menu (`Ctrl+.` / `Cmd+.`, or click the
lightbulb). With a selection, the menu offers:

| Action                 | What the agent does                                                   |
| ---------------------- | --------------------------------------------------------------------- |
| **Verzeta: Explain**   | Explains what the selected code does.                                 |
| **Verzeta: Fix bugs**  | Finds problems in the selection and suggests fixes.                   |
| **Verzeta: Refactor**  | Rewrites the selection to be clearer or more efficient.               |
| **Verzeta: Add tests** | Writes unit tests for the selected code.                              |
| **Verzeta: Add docs**  | Adds doc comments to functions, classes and methods in the selection. |

Each action writes a prompt from your selection and the file, and sends it
to the open conversation right away. The agent's reply appears in the
chat. If your workspace is shared with the chat (see
[Workspace mount](06-workspace-mount.md)), the agent can also edit your
files directly. You can also click **Apply** on a code block in the reply
that names a file (see [Canvas and artifacts](07-canvas-and-artifacts.md#applying-a-code-block-to-a-file)).

### Fix this problem

When the cursor or selection touches an error or warning underline, one
more action appears:

- **Verzeta: Fix this problem**: sends the diagnostic message and the
  affected code. Useful for compiler errors, linter warnings and type
  errors.

---

## CodeLens (off by default)

CodeLens shows **Verzeta: Explain**, **Verzeta: Add tests** and
**Verzeta: Refactor** links above functions, methods and classes, so you
can run an action without selecting text.

CodeLens is off by default. To turn it on, add this to your settings:

```json
"verzeta.codeLens.enabled": true
```

Or search for "Verzeta CodeLens" in the Settings UI. The lenses offer three
of the five actions, on up to 60 functions or classes per file.

---

## Ask an Agent About This…

**Verzeta: Ask an Agent About This…** is also in the right-click submenu.
When the open chat has members, pick **@everyone** (every member) or one
member's alias, then pick an action (Explain, Fix bugs, Refactor, Add
tests, Add docs). The message is sent right away. In a 1:1 chat only the
action picker appears. When you run it from the Command Palette with
nothing selected, the whole file is used.

---

## Generate Commit Message

Open the **Source Control** view (`Ctrl+Shift+G`). When a Git repository
is open, the title bar shows a **sparkle icon** for **Verzeta: Generate
Commit Message**.

Clicking it reads your staged diff (or the working-tree diff if nothing is
staged) and sends it to the open conversation with a request for a short
commit message. The agent's reply appears in the chat. Copy it into the
commit message box.

Next to it is **Add Git Diff to Chat**. It puts the diff into the composer
without sending it, so you can add a question first.

---

## Send Last Terminal Command to Chat

Right-click in an integrated terminal and choose **Send Last Terminal
Command to Chat**. It sends the last command you ran and its output to
the open conversation. If the command failed, the message asks the agent
to help fix it. Use it after a failed build or test run.

> **Note:** The extension only sees commands that finished in a terminal
> with shell integration active. Without shell integration the command
> stays in the menu but shows "Verzeta: run a command in the integrated
> terminal first (requires shell integration)."

---

## Adding context with the composer + menu

In the composer, the **+** button opens a menu with two options:

- **Add Context**: pick files from this workspace.
- **Add Files**: browse files on your computer.

Added files appear as chips in the composer. Remove a chip before sending
to leave that file out.

### Drag and drop

Drag one or more files from the VS Code Explorer, or from your file
manager, onto the composer to attach them. If dropping does nothing, hold
**Shift** while you drop.

### Paste an image

Copy an image and paste it (`Ctrl+V` / `Cmd+V`) into the composer. The
image is attached as a chip and sent with your next message.

---

## Which conversation receives an action

Editor actions go to the conversation that is open in the Verzeta view.
If no conversation is open when you run an action, the extension asks "No
active Verzeta conversation. Create one for this action?" Click **Create
chat**, then pick a model, or press Esc to keep the current one.

If you switch conversations in the Verzeta view, later actions go to the
newly opened one.
