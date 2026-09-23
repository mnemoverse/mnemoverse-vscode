---
name: mnemoverse-memory
description: "When to recall from and save to Mnemoverse long-term memory (memory_read, memory_write, memory_feedback and the room tools). Use before answering anything that may have come up in an earlier session (preferences, past decisions, project setup, people, lessons), after a decision, correction or failure worth keeping, when working in a shared room, and when choosing between Mnemoverse and the editor's local /memories files."
---

# Mnemoverse memory

Mnemoverse is long-term memory that lives in the user's Mnemoverse account, not in this workspace. The same memories are available in every tool the user has connected to Mnemoverse, and in shared rooms other people and agents can read. The tools may appear with a server prefix (for example `mcp_mnemoverse_memory_read`); the names below are the tool names without it.

Connecting the tools does not make you use them. These rules say when.

## 1. Recall before acting

Call `memory_read` **before** you:

- start work on a project or topic the user may have touched before;
- choose a library, pattern, tool, or deployment target;
- write tests, commits or docs, where conventions apply;
- answer "how do we usually do X", or anything phrased "again", "like last time", "as we agreed".

Skip recall for general knowledge, arithmetic, or questions fully specified in the current message.

Search with the user's own words plus the project or repository name. If nothing useful comes back, try one broader query, then continue without memory. Do not loop.

State what you are relying on: name the recalled entries (with dates if they have them) before you act on them. If two entries disagree, show both and ask which holds. Do not pick one silently.

## 2. Save after deciding

Call `memory_write` when:

- a **decision** was made that will still matter next week ("we deploy on Railway");
- the user **corrected** you (the strongest signal there is);
- an approach **failed**, and you know why;
- the user stated a preference that goes beyond this task;
- you learned an environment fact the hard way (a port, a flag, a service that must be running).

Do **not** save: file contents you can read again, a restatement of the current task, temporary state, or anything the user marked as temporary.

**Never store secrets:** passwords, API keys, tokens, payment data, MFA codes, government IDs, health records.

One memory, one fact. Write it so it still makes sense out of context in three weeks: what was decided, why, when, and where it came from.

```text
Project deploys on Railway, not Fly.io. The user decided this on 2026-09-23 after a failed Fly deploy. Applies to every service in this repo.
```

When something changes, write a new memory that says what replaced what and from when. There is no delete tool: a wrong or outdated memory is corrected by writing a fresh one.

## 3. Rate what you recalled

After you act on (or reject) recalled memories, call `memory_feedback` with the ids from the `memory_read` results:

- `outcome` near `1` when a memory helped;
- near `-1` when it was wrong or misleading;
- `0` when it was irrelevant.

Ratings change how memories rank in later searches, for this user in every connected tool. Rate honestly; a misleading memory rated as helpful keeps misleading.

## 4. Shared rooms

A room is a separate memory pool shared with other people and agents (Beta). A plain `memory_read` covers only the user's own memories, **not** rooms.

- `memory_list_rooms` lists the rooms and their addresses (`xroom:room_…`).
- To read or write a room, pass its address as `domain` to `memory_read` or `memory_write`.
- Where `memory_feedback` accepts a `domain`, pass the room's address when rating room memories.
- `memory_create_room`, `memory_invite_to_room` and `memory_join_room` manage membership. Create or share a room only when the user asks.

Write to a room only what everyone in it should see.

## 5. Mnemoverse or the editor's local /memories?

The editor may also offer its own memory tool that keeps notes in local `/memories` files. Prefer **Mnemoverse** when the memory should:

- follow the user to other tools and machines (Claude, Cursor, ChatGPT, another editor);
- be shared with a team through a room;
- improve with outcomes, through `memory_feedback`.

Local `/memories` notes suit scratch notes that only matter in this workspace and this editor. Do not save the same fact in both places.

## When memory is unavailable

If a Mnemoverse tool fails (not signed in, network error), say so in one line and continue without memory. Do not retry in a loop. Save the pending decision once the tool works again.
