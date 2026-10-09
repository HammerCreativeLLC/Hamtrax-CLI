# Commands Brief

Parent: [`../SRC_BRIEF.md`](../SRC_BRIEF.md).

| File | Purpose |
|------|---------|
| `context.ts` | Lazy HTTP-client factory and merged terminal options |
| `whoami.ts` | Account identity command |
| `folders.ts` | Folder list and inspection commands |
| `contacts.ts` | Contact list, create, and confirmed delete commands |
| `activations.ts` | Activation list and create commands |

Commands translate terminal arguments to the API. They do not own logbook rules.
MCP uses the shared HTTP seam directly, so terminal presentation and interactive
prompts never enter the protocol channel.
