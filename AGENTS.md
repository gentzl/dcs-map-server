# Agent notes

## Verifying a change

```bash
npm run typecheck   # all four TS projects
npm test            # node --test, well under a second
```

Both before calling anything done. `npm run build` runs the typecheck too.

Rendering is not covered by either — symbols, range rings, pan/zoom and the HUD have no automated
check, so a green suite says nothing about whether the map looks right. To actually look at a
client change without starting DCS, replay a recorded session through the server:

```bash
npm run replay-ws -- dcs/test/fixtures/real-session-2026-11-23.jsonl --port 8766
MM_UPSTREAM=ws://127.0.0.1:8766/ws npm run dev
```

That puts 245 real objects of every category on the map, moving. If you changed anything visual
and didn't look at it, say so rather than implying it was verified.

## Two rules that aren't negotiable

1. **Fog of war is filtered server-side**, in `src/server/world.ts` and nowhere else. Filtering in
   the browser would be defeated with the developer tools in seconds and turn this into a cheat
   tool. `test/world.test.ts` pins the whole matrix, including the allies-only fallback for view
   values DCS might invent later.
2. **Only ODbL and public-domain data sources.** No third-party tile servers without an agreement,
   no keys in the repository, no NC-licensed data in what ships.

## Classification changes

`src/server/classify.ts` and `src/server/threats.ts` are name-based heuristics, because the DCS
type sub-levels aren't documented. They break quietly and in both directions — a substring check
for `str` once turned every Stryker into air defence.

`test/classification-baseline.json` holds the current result for every unit name in the recorded
sessions. When a change makes that test fail, read the diff: it is the list of units whose symbol
just changed on the map. Regenerate only after accepting it — the command is in
[docs/DEVELOPERS.md](docs/DEVELOPERS.md#the-classification-baseline).

## Language

Code language: English, everywhere in code -- comments, identifiers (variables, functions,
classes, types), commit messages. The codebase originally had German comments throughout; those
have since been translated to English project-wide. Don't reintroduce German when writing or
editing code -- if you find any left over, translate it while you're there instead of leaving a
mixed-language file behind.

User-facing text (the UI, README, docs) follows whatever the task at hand calls for and is
unaffected by this rule.

## Where documentation goes

| File | Audience | Contents |
|---|---|---|
| `README.md` | someone who just found the project | What it is, four install steps, nothing else |
| `docs/MANUAL.md` | pilots using it | Controls, settings, symbols, troubleshooting — no code |
| `docs/DEVELOPERS.md` | developers and power users | Architecture, protocol, tools, tests, env vars |
| `AGENTS.md` | this file | Conventions that aren't derivable from the code |

Keep them apart. Env vars and wire formats don't belong in the handbook; "tap a contact to get a
BRA readout" doesn't belong in the technical guide.

## Commits

One concern per commit. Subject in the imperative, sentence case, no prefix or ticket number
("Fix range rings not updating during pinch/wheel zoom"). The body explains *why* — what was
wrong, what it does now — and wraps at roughly 72 columns.
