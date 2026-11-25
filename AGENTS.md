# Agent notes

## Verifying a change

```powershell
npm run typecheck   # all four TS projects
npm test            # node --test, well under a second
```

Both before calling anything done. `npm run build` runs the typecheck too.

Rendering is not covered by either — symbols, range rings, pan/zoom and the HUD have no automated
check, so a green suite says nothing about whether the map looks right. To actually look at a
client change without starting DCS, replay a recorded session through the server:

```powershell
npm run demo
```

That puts 245 real objects of every category on the map, moving. The committed recordings predate
the mission clock, airbases and zones, so those stay empty in a replay. If you changed anything visual
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

## Platform

DCS itself only runs on Windows, so that's the only platform any tool or script here needs to
work on -- no cross-platform branching, fallback paths, or error messages for Linux/macOS. If
you find one (e.g. a `process.platform` check for a non-Windows case), simplify it away rather
than maintaining it.

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
| `README.md` | someone who just found the project | What it is, two install steps, nothing else |
| `docs/MANUAL.md` | pilots using it | Controls, settings, symbols, troubleshooting — no code |
| `docs/DEVELOPERS.md` | developers and power users | Architecture, protocol, tools, tests, env vars |
| `AGENTS.md` | this file | Conventions that aren't derivable from the code |

Keep them apart. Env vars and wire formats don't belong in the handbook; "tap a contact to get a
BRA readout" doesn't belong in the technical guide.

## Commits

One concern per commit. Subject in the imperative, sentence case, no prefix or ticket number
("Fix range rings not updating during pinch/wheel zoom"). The body explains *why* — what was
wrong, what it does now — and wraps at roughly 72 columns.

## Versioning workflow

Versions are `MAJOR.MINOR.BUILD` (details: [docs/DEVELOPERS.md](docs/DEVELOPERS.md#versioning)).

- **BUILD is automatic.** It is the number of commits since the last `vMAJOR.MINOR` tag, read via
  `git describe` (clone) or `VERSION_ARCHIVE` (GitHub ZIP). Never bump it by hand, never commit a
  build number anywhere, and never add a CI step that commits version bumps.
- **MAJOR/MINOR only on the user's request.** Don't decide on your own that a change deserves a new
  minor. When asked:
  1. Commit the work first, so the tag lands on it.
  2. `git tag -a vMAJOR.MINOR -m "Version MAJOR.MINOR"` on that commit.
  3. Set `version` in `package.json` and `package-lock.json` (both top-level entries) to
     `MAJOR.MINOR.0`, commit that.
  4. Push the branch **and** the tag (`git push origin main vMAJOR.MINOR`) — only when the user
     asked to push. An unpushed tag means ZIP downloads report `0.0.0-unknown`.
- **Don't touch** `VERSION_ARCHIVE` or the `export-subst` line in `.gitattributes`: GitHub fills in
  the placeholder when it builds the ZIP, and it has to stay a literal `$Format:...$` in the repo.
- **Checking the version:** the server prints it on startup and serves it at `/api/version`; the
  web UI shows it at the bottom of the menu. A `-dirty` suffix just means uncommitted
  changes in the working tree.
- In a handoff note, name the version you left the repository at (from `/api/version` or
  `git describe --tags`), not only the commit hash.
