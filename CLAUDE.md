# Working rules for Claude

## What this is
"Own WIKI" — a local desktop wiki program for fictional stories (macOS + Windows). At the start of every session, `git pull` first (planning chats on claude.ai also push spec changes), then read `SPEC.md`. It is the source of truth. Read `docs/history.md` (scopes and decisions of finished milestones) only when changing a finished feature, and search it instead of reading all of it.

## Rules
- **Only build the program.** Never invent, write, or seed story content. Test data uses neutral placeholders ("Page A", "Example field").
- **Content stays separate from code.** User data lives in project folders chosen by the user, never in this repo.
- **Juku does not need to understand the code.** Build, run, test and verify yourself. Explanations to him are short and user-facing: what changed, what to try, what's next.
- **Work in milestones.** One session per checkpoint (a small milestone without a checkpoint fits one session). Each milestone ends with a working, tested build, not snippets. When a session ends partway through a milestone, add a short **Progress** note to that milestone in SPEC.md (done / left / open questions) so the next session can continue from it.
- **Juku reviews before a milestone is done.** When the build is ready and verified, stop and hand it to him: how to open it, a short list of what to try, and anything you're unsure about. Apply his changes in the same session and hand it back again. Only when he says it's approved: mark the milestone done in SPEC.md, record any decisions his feedback created, and push. For bigger milestones, also show him a checkpoint partway through, so he can redirect early. If his feedback asks for something clearly outside the current milestone, ask whether to add it now or record it for a later milestone in SPEC.md.
- **Install the Mac app at every review handoff** (checkpoints and the final round): after the build passes, quit any running copy and replace `/Applications/Own WIKI.app` with the new build (`rm -rf /Applications/Own\ WIKI.app && ditto src-tauri/target/release/bundle/macos/Own\ WIKI.app /Applications/Own\ WIKI.app`), then launch it once to confirm it opens. Juku uses the copy in Applications.
- **Verify before reporting done:**
  - Tests: `npm test` (unit + Rust) and `npm run test:ui` (Playwright UI tests: the web UI in Chromium against the in-memory backend in `tests/ui/mock/`; extend the mock when a feature adds commands). New features get automated UI tests in `tests/ui/`.
  - Screenshots only to check how new or changed screens look (from the UI tests), plus one final check in the installed app before each handoff. No click-through of every item by hand.
  - Speed tests only when a milestone touches loading, the index, search or big lists.
  - Before each handoff, review only this milestone's diff once, for bugs and duplicated code. Fix those; no other refactoring.
- **File size:** split a file when it's over ~800 lines and you're working in it anyway.
- **Keep SPEC.md current.** When a decision changes or a new one is made, update the relevant section and add a dated line to the decision log. When a milestone is approved, move its detailed scope and its decision-log lines to `docs/history.md` unchanged, and add its lasting rules to "Rules from finished milestones" in SPEC.md.
- **Defining a milestone:** write its "Done when" to match these rules (see "How every milestone is written" in SPEC.md).
- **Ask Juku whenever an instruction of his is ambiguous, unclear, or open to more than one reading — before building on it.** Don't guess at what he meant. Name the specific options you see.
- **Give honest feedback on his requests.** When he asks for a feature or change, briefly say if you see a problem, a conflict with SPEC.md, or a better option before building it. Be direct, no softening. He decides.
- Features, look and behaviour are always his call. Purely technical details his instructions don't touch, decide yourself and note significant ones in the decision log.
- **Git:** commit and push directly to `main` (no branches or pull requests needed). Run `git pull --rebase` right before every push, because planning chats also push. Only push states that build and pass tests. Never force-push.
- Replies: short and direct, no repetition. Don't drop important questions or trade-offs to stay short.
