# Try it

First ask the agent to call `memory_stats`. Inspect the actual response: visible tools or a connection label alone do not verify access.

In the agent chat, send a fact that is true, with your editor's name and today's date. For example, if you are setting it up in VS Code today:

> Remember that I set up Mnemoverse memory in VS Code today. Use today's date and call memory_write to save it.

The **Try it** button prepares a fact with your editor and today's date. Check that `memory_write` confirms storage. If it returns `NOT STORED` or `stored: false`, no new memory was saved: keep the returned reason, do not assume a duplicate, and do not retry blindly.

Then open a **new** chat and ask:

> Call memory_read: when and where did I set up Mnemoverse memory?

Verify that the actual `memory_read` result contains the saved date and editor, in the same domain if you chose one. An answer without the tool result is not proof. If writing succeeded but read-back failed, verification is incomplete. Other tools connected to the same Mnemoverse account can read the same memories; for ChatGPT, follow the [published-plugin guide](https://mnemoverse.com/docs/api/chatgpt).

When a recalled memory helps or misleads, the agent can rate it (`memory_feedback`). Ratings change how memories rank in later searches.
