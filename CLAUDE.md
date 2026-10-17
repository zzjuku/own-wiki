# Working rules for Claude

## What this is
"Own WIKI" — a local desktop wiki program for fictional stories (macOS + Windows). Read `SPEC.md` at the start of every session. It is the source of truth.

## Rules
- **Only build the program.** Never invent, write, or seed story content. Test data uses neutral placeholders ("Page A", "Example field").
- **Content stays separate from code.** User data lives in project folders chosen by the user, never in this repo.
- **Juku does not need to understand the code.** Build, run, test and verify yourself. Explanations to him are short and user-facing: what changed, what to try, what's next.
- **Work in milestones.** One milestone per session. Each ends with a working, tested build, not snippets.
- **Verify before reporting done:** run the tests, launch the app, click through the changed feature, and check it on screen.
- **Keep SPEC.md current.** When a decision changes or a new one is made, update the relevant section and add a dated line to the decision log.
- **Ask Juku whenever an instruction of his is ambiguous, unclear, or open to more than one reading — before building on it.** Don't guess at what he meant. Name the specific options you see.
- Features, look and behaviour are always his call. Purely technical details his instructions don't touch, decide yourself and note significant ones in the decision log.
- Replies: short and direct, no repetition. Don't drop important questions or trade-offs to stay short.
