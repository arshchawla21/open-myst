# Myst Review — Features & Development Tracker

Status legend: `planned` · `in-progress` · `done` · `cut` · `deferred`

Each feature has a phase (matches `plan.md` §13) and a short rationale so future-me can tell why it's in the list.

## MVP scope

The MVP is: a user can open a project, drop sources, write a markdown document, chat with the LLM about it, and inline-comment on the document to get edits or answers. Review Mode and the verification sidebar are post-MVP.

---

## Foundation

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| F1 | Electron + Vite + React + TS scaffold | 0 | planned | Project skeleton, HMR, IPC bridge. |
| F2 | Three-pane main window (sources / document / chat) | 0 | planned | Collapsible side panels, resizable. |
| F3 | Settings screen with OpenRouter API key | 0 | planned | Key stored in OS keychain. |
| F4 | New project / Open project flows | 0 | planned | Folder picker, scaffold project files. |
| F5 | Project metadata (`project.json`) | 0 | planned | Name, default model, created date. |
| F6 | `agent.md` template ships with every new project | 0 | planned | User-editable system prompt. |

## Document editor

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| D1 | Markdown editor in center pane | 1 | planned | CodeMirror 6 (decision deferred vs. Tiptap). |
| D2 | Beautiful markdown rendering | 1 | planned | remark/rehype + KaTeX + Shiki. |
| D3 | Autosave to `document.md` | 1 | planned | Debounced. |
| D4 | Plain editor mode (Mode A) | 1 | planned | No AI interaction on document. |
| D5 | Keyboard shortcuts (save, bold, italic, headings) | 7 | planned | Standard writer shortcuts. |
| D6 | Dark / light theme | 7 | planned | OS-aware. |

## Chat panel

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| C1 | Streaming chat against OpenRouter | 2 | planned | Token stream to renderer. |
| C2 | Persistent transcript in `chat.jsonl` | 2 | planned | Append-only. |
| C3 | Context bundle assembly (agent + document + index) | 2 | planned | See plan §10. |
| C4 | Context squishing v1 (summarize old turns) | 2 | planned | Threshold-based. Cached in `.myst/context-cache.json`. |
| C5 | Per-project model override | 2 | planned | Stored in `project.json`. |
| C6 | Stop / regenerate controls | 2 | planned | Standard chat affordances. |

## Sources

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| S1 | Drop zone for files | 3 | planned | Electron file drop into left pane. |
| S2 | PDF text extraction | 3 | planned | `pdfjs-dist` in main process. |
| S3 | Markdown / plaintext ingestion | 3 | planned | Copy-through. |
| S4 | Per-source markdown file (`source_<slug>.md`) | 3 | planned | Structured wiki, no RAG. |
| S5 | Per-source metadata (`.meta.json`) | 3 | planned | Original filename, type, date. |
| S6 | Auto-generated `sources/index.md` (one-line summaries) | 3 | planned | LLM call on ingest. |
| S7 | Sources list UI with previews | 3 | planned | Click to open source file. |
| S8 | Remove / rename source | 3 | planned | Keeps `index.md` in sync. |

## Inline commenting (core)

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| I1 | Selection → Comment button | 4 | planned | Triggered from text selection. |
| I2 | Paragraph-level comment affordance | 4 | planned | Gutter button next to each paragraph. |
| I3 | Word-based anchoring with context window | 4 | planned | See plan §8. |
| I4 | Orphan detection on edits | 4 | planned | Flag, don't delete. |
| I5 | Comment types: edit request vs. question | 4 | planned | Detected from comment + explicit toggle. |
| I6 | Mini conversation thread per comment | 4 | planned | Separate memory from main chat. |
| I7 | LLM edit proposal parsing (`myst-edit` blocks) | 4 | planned | Structured fenced format. |
| I8 | Inline diff rendering | 4 | planned | With change summary from LLM. |
| I9 | Accept / Reject / Discuss controls | 4 | planned | Accept applies to `document.md`. |
| I10 | Try Again asks for a specific instruction first | 4 | planned | Prevents identical retries. |
| I11 | Comment persistence (`comments.json`) | 4 | planned | Open / resolved / orphaned states. |
| I12 | Reopen resolved comments | 4 | planned | Undo-friendly. |

## Review Mode (fullscreen workspace)

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| R1 | Fullscreen Review Mode workspace | 5 | deferred | Post-MVP. Built on inline commenting primitives. |
| R2 | Reply immediately toggle | 5 | deferred | Live back-and-forth. |
| R3 | Reply when prompted toggle + batch Run | 5 | deferred | Queue comments, process together. |
| R4 | Exit returns to main view with state preserved | 5 | deferred | Unresolved comments persist. |

## Source verification

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| V1 | Verification comment type | 6 | deferred | "Does the source actually say this?" |
| V2 | Scoped sidebar chat per comment | 6 | deferred | Reuses mini-conversation primitive. |
| V3 | Ad-hoc source upload scoped to sidebar | 6 | deferred | PDF / md / paste. |
| V4 | Confirmation / challenge output format | 6 | deferred | With reasoning in the sidebar. |

## Packaging & distribution

| # | Feature | Phase | Status | Notes |
|---|---|---|---|---|
| P1 | `electron-builder` config | 7 | planned | macOS, Windows, Linux. |
| P2 | Code signing (mac + win) | 7 | planned | Needed for App Store + SmartScreen. |
| P3 | Auto-update | 7 | planned | Squirrel on mac/win. |
| P4 | Web build experiment | 7 | deferred | Same renderer, thin server. |

---

## Cut / non-goals

- Vector DB / embeddings / RAG frameworks — structured markdown wiki instead.
- Real-time multiplayer.
- Mobile.
- Fine-tuning or a custom model.
- Plugin system.
- Telemetry / analytics / accounts.

## Open decisions tracked here

| Decision | Options | Status |
|---|---|---|
| Editor engine | CodeMirror 6 vs. Tiptap vs. Milkdown | open — prototype needed |
| Default model | Gemma 3 27B vs. Gemini 2.5 Flash vs. other | open — quality/cost pass |
| Monetization | own-key vs. hosted subscription | deferred — ship own-key first |
| Web delivery | Electron only vs. also a hosted web build | deferred — Phase 7 |

## Development log

> Append-only notes per working session. Date · what changed · what's next.

- **2026-04-12** · Initial `plan.md` and `features.md` written from the Review Mode proposal plus the expanded desktop-app direction (project folders, sources wiki, inline commenting as primary mode, Review Mode deferred post-MVP). Next: scaffold Phase 0 (Electron + Vite + React + TS) and decide editor engine with a small prototype.
