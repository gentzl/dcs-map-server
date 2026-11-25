# Technical guide

For working on the code, running it without DCS, or driving it beyond what the settings panel
exposes. If you just want to fly with it, the [handbook](MANUAL.md) is the one you want.

- [Manual setup](#manual-setup)
- [Detecting owned maps](#detecting-owned-maps)
- [How it fits together](#how-it-fits-together)
- [Source layout](#source-layout)
- [The DCS hook](#the-dcs-hook)
- [Wire protocol](#wire-protocol)
- [Running without DCS](#running-without-dcs)
- [Recording what actually goes over the wire](#recording-what-actually-goes-over-the-wire)
- [Tests](#tests)
- [Environment variables](#environment-variables)
- [HTTPS on a LAN](#https-on-a-lan)
- [Performance](#performance)
- [Still open](#still-open)
- [Contributing](#contributing)
- [License and data sources](#license-and-data-sources)

## Manual setup

The [README](../README.md) points players at `start.bat`, a one-click installer that works out
which maps they own by itself on every run (see [Detecting owned maps](#detecting-owned-maps)) and
downloads tiles for each one. For development, or if you'd rather run the steps yourself:

Clone the repo (`git clone`). You'll need [Node.js](https://nodejs.org) installed (version 22 or
newer). Everything below is copy-paste into a terminal, in the project folder — the same commands
work in PowerShell or cmd.exe.

1. Install and prepare the map data (one-time, a couple of minutes):

   ```bash
   npm install
   cp node_modules/maplibre-gl/dist/maplibre-gl.css public/
   npm run fetch-assets        # map labels and symbols, ~2.3 MB
   npm run fetch-tiles -- caucasus  # the map itself, ~131 MB — swap in another theater if you fly elsewhere
   npm run install-hook        # copies the DCS export hook into Saved Games, see below
   ```

   > In cmd.exe (not PowerShell), `cp` isn't a command — use
   > `copy node_modules\maplibre-gl\dist\maplibre-gl.css public\` instead.

   `fetch-tiles` downloads the `pmtiles` tool it needs by itself the first time it runs, into this
   project's own `runtime/` folder — nothing to put on `PATH`.

   `install-hook` copies `dcs/Scripts/Hooks/dcs-map-server.lua` into every DCS installation it finds
   under `Saved Games\` (stable and open beta). It never overwrites a hook file that's already
   there, so it's always safe to re-run; if you'd rather do it by hand, or it doesn't find your DCS
   install, just copy that file into `Saved Games\DCS\Scripts\Hooks\` yourself.

2. (Re)start DCS, so it picks up the hook.

3. Start the server:

   ```bash
   npm run dev
   ```

4. Open the web address it prints — `http://localhost:8080` on the DCS PC itself, or one of the
   other addresses it lists from a phone or tablet on the same Wi-Fi.

This path doesn't touch `theaters.json` -- `fetch-tiles` just downloads whatever theater you pass
it, as many times as you like.

## Finding DCS and detecting owned maps

`tools/dcs-paths.js` finds where DCS lives; `tools/detect-owned-theaters.js` then reads which maps
are installed straight from the game's own files, so bootstrap.js doesn't have to ask -- checked
fresh on every run, so a map bought later just shows up on the next start.

**Saved Games folder** (hook, `dcs.log`): read from Windows' known-folder entry
(`HKCU\...\Explorer\User Shell Folders`, value `{4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}`), so a
Saved Games folder moved to another drive is honoured. Absent means the default
`%USERPROFILE%\Saved Games`. `install-hook` uses the same lookup.

**Install folder**, per DCS variant (`DCS`, `DCS.openbeta`, `DCS.openalpha`), first hit wins:

1. `Saved Games\<variant>\Logs\dcs.log` (or `dcs.log.old`): DCS writes
   `Command line: "...\bin\DCS.exe"` there on every launch, so it stays correct when the registry
   doesn't -- most commonly after Windows was reinstalled with the game drive kept, which wipes
   the registry while DCS and its updater keep working fine.
2. `HKCU\Software\Eagle Dynamics\<DCS World | DCS World OpenBeta | DCS World 2 OpenAlpha>\Path`,
   written once by the ED installer.

Plus a folder the player typed in earlier (`dcs-install.json`, git-ignored). Every candidate must
contain `bin\DCS.exe` (or `bin-mt\DCS.exe`), otherwise it's ignored as stale. If nothing is found,
setup asks once for the folder and remembers the answer; Enter skips.

**Maps**: every playable terrain ships a folder under `Mods\terrains\` (e.g. `SinaiMap`,
`MarianaIslands`); `TERRAIN_FOLDER_NAMES` maps those back to this project's theater keys. That's
the ground truth, unlike the installer's own `autoupdate.cfg` bookkeeping, which can list a terrain
that failed to install or omit one installed by other means.

None of this is officially documented, so every failure mode -- no install found, prompt skipped,
unreadable `Mods\terrains`, an unknown folder name -- returns `null` rather than guessing, and the
caller falls back to `theaters.json` and then to asking which maps you own
(`tools/theater-config.js`). Caucasus is always included once detection succeeds at all, since it
ships free with the base game.

`configure-maps.bat` (`tools/reconfigure-theaters.js`) exists only for when detection fails -- it
tries detection first too, and only prompts if that also comes back empty.

## How it fits together

Three pieces, one direction of flow:

1. A **Lua hook** inside DCS reads the simulation through the export API and sends one UDP
   datagram per tick to localhost.
2. The **server** (Node + Fastify) parses those datagrams into world state, applies fog-of-war
   filtering, and broadcasts deltas over WebSocket on its own fixed cadence — decoupled from the
   DCS framerate, which is what makes delta building possible at all.
3. The **client** (MapLibre in the browser) interpolates those deltas, dead-reckons the own
   aircraft between updates, and draws the map.

UDP never leaves the DCS PC; `MM_UDP_HOST` is deliberately loopback. The LAN hop is the WebSocket.

Fog of war is applied in step 2 and nowhere else. See [Contributing](#contributing).

## Source layout

```
src/shared/types.ts      Wire format between server and client
src/server/protocol.ts   Parser for the DCS hook's UDP format
src/server/classify.ts   Sorting objects into presentation categories
src/server/threats.ts    Engagement ranges of air defence systems
src/server/world.ts      World state, delta building, fog of war
src/server/ingest.ts     UDP socket
src/server/relay.ts      Upstream-WebSocket relay mode (MM_UPSTREAM)
src/server/index.ts      Fastify + WebSocket + tick
src/client/geo.ts        Geodetic maths, range/zoom, cockpit formatting
src/client/track.ts      Dead reckoning and interpolation buffer
src/client/style.ts      Map style: elevation tints, shading, vector layers
src/client/symbols/      Contact symbols, drawn at runtime (nato.ts, dcs.ts)
src/client/main.ts       MapLibre, render loop, HUD
dcs/Scripts/Hooks/       DCS export hook (Lua)
dcs/test/                Harness driving the hook against mocked DCS APIs
dcs/test/fixtures/       Recorded sessions, used by the tests
test/                    Automated tests (node --test)
tools/wire.ts            Datagram writer, counterpart to protocol.ts
tools/zip.ts             Minimal ZIP reader for Tacview archives
tools/capture-ws.ts      Records a live server's WebSocket feed to a file
tools/replay-ws.ts       Replays such a recording as a relay source
tools/                   Telemetry generator and ACMI converter
```

## The DCS hook

Copy `dcs/Scripts/Hooks/dcs-map-server.lua` into `Saved Games\DCS\Scripts\Hooks\` and restart DCS.
That is all — **no `Export.lua` is needed and none is modified.** `npm run install-hook`
(`tools/install-hook.ts`) does this copy automatically for every DCS variant it finds, and never
overwrites a hook file that's already there.

This matters because the two mechanisms are easy to confuse:

| | `Scripts/Export.lua` | `Scripts/Hooks/*.lua` |
|---|---|---|
| Entry points | `LuaExportStart`, `LuaExportActivity`, `LuaExportStop` | `DCS.setUserCallbacks` with `onSimulationStart/Frame/Stop` |
| Loaded | once, as a single file shared by every tool | one file per tool, side by side |
| Used by | SRS, DCS-BIOS, many instrument exporters | this project |

The hook route was chosen deliberately: `Export.lua` is a single shared file, so every tool that
wants it has to chain onto whatever is already there. Hooks live in their own files and cannot
collide.

Both environments can call the `Export.Lo*` functions, which is where the telemetry comes from —
`LoGetSelfData`, `LoGetWorldObjects` and friends.

### If you prefer the Export.lua route

Should you want to run the telemetry from `Export.lua` instead — for instance to keep everything
in one place — the important part is to chain rather than replace. Overwriting the existing
handlers silently breaks every other tool:

```lua
-- Saved Games\DCS\Scripts\Export.lua
local previousStart    = LuaExportStart
local previousActivity = LuaExportActivity
local previousStop     = LuaExportStop

LuaExportStart = function()
    if previousStart then previousStart() end
    -- open your socket here
end

LuaExportActivity = function()
    if previousActivity then previousActivity() end
    -- send here; LuaExportActivity fires on the export interval,
    -- not once per rendered frame
end

LuaExportStop = function()
    if previousStop then previousStop() end
    -- close your socket here
end
```

Two differences to keep in mind on that route: `Export.lua` has no equivalent of
`DCS.getMissionOptions()`, so the fog-of-war setting would have to be obtained elsewhere, and the
export interval is configured in `Config/Export.lua` rather than derived from the model time.

## Wire protocol

Parser in `src/server/protocol.ts`, writer in `tools/wire.ts`. The two are independent
implementations of the same format, which is exactly how formats drift apart — so the tools verify
their first datagram against the server's own parser before sending, and the tests round-trip
every packet type through both.

**Schema 3** is what the hook sends. Tab separated, several records per datagram, behind a header
line that carries the schema version, the DCS model time and the mission's visibility rule:

```
MM<TAB>3<TAB><modelTime><TAB><optionsView>
O<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>unitName<TAB>groupName<TAB>coalition<TAB>tas<TAB>ralt<TAB>wow<TAB>aoa<TAB>accelY<TAB>chaff<TAB>flare<TAB>windX<TAB>windY<TAB>windZ
A<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>unitName<TAB>groupName<TAB>coalition<TAB>level1<TAB>level2
W<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>coalition
D<TAB>id
```

`O` is the own aircraft, `A` another unit, `W` a weapon, `D` a removal. `level1`/`level2` are the
DCS type levels; without `level1` air defence cannot be separated from other ground targets, which
is why schema 2 was replaced. The hook strips tabs and line breaks from names; commas may stay.

**Schema 1** is the older comma-separated format with no header, kept for anyone running the
telemetry out of their own `Export.lua`. It is ambiguous by construction: names are inserted
unescaped, so a comma inside one shifts every following field. The parser recovers by searching
for the contiguous lat/lon/alt/hdg block rather than silently misreading coordinates — which works
as long as the shifted fragment doesn't itself read as a number. `tools/wire.ts` sidesteps the
problem entirely by replacing commas with spaces when it writes schema 1.

## Running without DCS

Check the hook against mocked export APIs:

```bash
lua dcs/test/hook_harness.lua 300 optview_all 150
```

It writes the datagrams to stdout and checks them: header per datagram, schema version, the
configured `optionsView` coming back out, the field count of every line type, a `D` line once
objects disappear, the own aircraft not also sent as an ordinary unit, and a comma in a group name
surviving while a tab does not. It exits non-zero and says what broke, so it belongs in CI rather
than in a careful read of its output — which is where it runs.

Synthetic telemetry:

```bash
npm run telemetry -- --send --units 20
```

A real recording — DCS/Tacview writes one after every flight:

```bash
npm run acmi -- flight.zip.acmi --list    # show objects
npm run acmi -- flight.zip.acmi --send
```

Or replay a previously captured session through the server as if it were a second live instance:

```bash
npm run replay-ws -- dcs/test/fixtures/real-session-2026-11-23.jsonl --port 8766
MM_UPSTREAM=ws://127.0.0.1:8766/ws npm run dev
```

The replay route is the one to use when you're changing the client: it puts 245 real objects of
every category on the map, with real movement, without starting DCS.

## Recording what actually goes over the wire

When the log isn't enough, record the raw datagrams and have them summarised. Three causes look
identical from outside — nothing arrives, something arrives unreadably, or the mission withholds
it — and this tells them apart:

```bash
MM_CAPTURE=/tmp/hook.jsonl npm run dev     # fly for a minute
npm run capture -- /tmp/hook.jsonl
```

It reports line types, the reported visibility rule, parse errors, the type levels DCS supplied
and the unit names seen, then states which of the three cases applies.

To capture what the *server* sends to browsers instead — for a test fixture, or to replay later:

```bash
npm run capture-ws -- wss://<host>:8443/ws --out session.jsonl --seconds 90 --insecure
```

Recordings committed as fixtures are described in
[`dcs/test/fixtures/README.md`](../dcs/test/fixtures/README.md), including what was anonymised.

## Tests

```bash
npm run typecheck   # all four TS projects, including the tests
npm test            # compiles the tests, then runs them
```

Node's built-in runner, no test framework. `npm test` compiles `test/` to `dist-test/` and runs
every `*.test.js` there. The whole suite is well under a second.

What's covered, and why those parts:

| File | Covers |
|---|---|
| `test/protocol.test.ts` | Every packet type round-tripped through `tools/wire.ts` and `src/server/protocol.ts`, both schemas, plus framing and error handling |
| `test/world.test.ts` | Delta building, heartbeats, staleness and dropping — and the fog-of-war matrix, including against both recorded sessions |
| `test/classify.test.ts` | Classification of every unit name in the recorded sessions, against a checked-in baseline |
| `test/threats.test.ts` | Which air defence units get a threat ring and which don't |
| `test/geo.test.ts` | The geodetic maths and cockpit formatting the BRA readout depends on |
| `test/leaders.test.ts` | Which contacts get a velocity leader, and how long it is |
| `test/server.test.ts` | The real server end to end: a datagram in over UDP, messages out over the WebSocket |

### The classification baseline

`test/classification-baseline.json` holds every distinct unit name from the recorded sessions
together with the category and threat ring the current code produces for it.

Classification is name-based, because the DCS type sub-levels aren't documented. That makes it a
heuristic which breaks in both directions, quietly: a substring check for `str` once turned every
M1126/M1128 Stryker into air defence. The baseline exists so that a change to a pattern shows up
as a list of units whose symbol just changed on the map, rather than as a surprise in flight.

So when a classification change makes that test fail, **read the diff before regenerating it** —
it is the actual effect of your change, spelled out. To regenerate after you've accepted it:

```bash
npm run build:test --silent
node --input-type=module -e '
  import fs from "node:fs";
  const { classify } = await import("./dist-test/src/server/classify.js");
  const { threatOf } = await import("./dist-test/src/server/threats.js");
  const entries = JSON.parse(fs.readFileSync("test/classification-baseline.json", "utf8"));
  for (const e of entries) {
    e.category = classify({ name: e.name, level1: e.level1 });
    delete e.threatM; delete e.threatLabel;
    const t = e.category === "sam" ? threatOf(e.name) : null;
    if (t) { e.threatM = t.rangeM; e.threatLabel = t.label; }
  }
  fs.writeFileSync("test/classification-baseline.json", JSON.stringify(entries, null, 2) + "\n");
'
```

### What the tests don't cover

Rendering. Symbols, range rings, pan and zoom behaviour, the HUD — none of that is checked
automatically, and a green suite says nothing about whether the map looks right. Changes there
have to be looked at, which is what the replay route under
[Running without DCS](#running-without-dcs) is for.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MM_HTTP_PORT` | 8080 | HTTP — the app without a certificate, the redirect with one |
| `MM_HTTPS_PORT` | 8443 | HTTPS, as soon as `certs/` holds a certificate |
| `MM_UDP_PORT` | 50000 | Ingest from the DCS hook |
| `MM_UDP_HOST` | 127.0.0.1 | Deliberately loopback only — the LAN hop is the WebSocket |
| `MM_TICK_HZ` | 10 | Broadcast tick rate |
| `MM_TLS` | – | `off` forces plaintext even when a certificate is present |
| `MM_UPSTREAM` | – | Relay from another server's `/ws` instead of reading local UDP |
| `MM_UPSTREAM_INSECURE` | – | `1` accepts a self-signed certificate on the upstream server |
| `MM_CAPTURE` | – | Path to record every raw datagram the hook sends, for `npm run capture` |

## HTTPS on a LAN

Not for confidentiality — that is secondary on a home network — but because the Screen Wake Lock
API requires a secure context. Over `http://<LAN-IP>` there is none, and a tablet whose display
sleeps mid-flight is useless.

```bash
./tools/make-cert.sh
```

puts the LAN IP into the `subjectAltName`; iOS and Android check only that, never the common name.
The server picks the certificate up from `certs/` on its next start and serves HTTPS on
`MM_HTTPS_PORT`, redirecting plain HTTP to it.

## Performance

Measured bandwidth per client with 150 objects at 10 Hz:

| Scene | Per client |
|---|---|
| Nothing moving | 7.4 KiB/s |
| 30 % moving | 44.5 KiB/s |
| Everything moving | 224 KiB/s |

The floor is set by the heartbeat: a stationary object is re-sent every three seconds even when it
hasn't changed, so the client doesn't dim it as stale.

## Still open

- Declutter levels. Several hundred ground units at a wide range step are noise, and the velocity
  leaders add to it; a rule such as "surface contacts only below a given range" would make the
  wide steps usable.
- MGRS grid, DEM held locally instead of fetched from AWS, contour lines, further theaters.
- Reading the mission's own bullseye, which would remove the one manual step in setting the
  display up. There is a route: `coalition.getMainRefPoint(side)` returns it, but only in the
  mission scripting environment, which a hook reaches through
  `net.dostring_in('mission', ...)` -- converting to lat/lon with `coord.LOtoLL` inside that call,
  since the reference point comes back in map coordinates. The open question is multiplayer: the
  mission environment lives on the server, and this runs on the player's PC, so it is likely to
  work single-player and when hosting and to come back empty as a client. Worth probing from the
  hook and logging the result before building anything on it.
- The active waypoint/flight plan on the map. Unlikely to be generally possible: the export API's
  `LoGet*` functions expose aircraft state (position, fuel, sensors) but nothing documented gives
  the route a player set up in the mission planner, and what partial access exists is tucked away
  per aircraft module rather than a stable, documented, cross-module call. Someone who knows a
  specific module's export quirks would have to confirm this one way or the other; absent that, it
  stays unbuilt rather than guessed at.
- A small number of ship classes with a genuine area air-defence system have a threat ring
  (Ticonderoga/Arleigh Burke-class, Aegis; Kirov/Slava-class, SA-N-6) -- see threats.ts. Frigates
  and corvettes with a shorter-range system are deliberately left out until someone can confirm
  the actual in-game numbers; adding a wrong range would be worse than no ring.
- `start.bat`, the zero-friction Windows installer, is built (`tools/bootstrap-node.ps1` downloads
  and checksum-verifies a portable Node into `runtime/node/`, `tools/bootstrap.js` then runs
  `npm install`, the CSS copy, `fetch-assets`, `fetch-tiles`, `install-hook` and the server, opening
  the browser at the address the server itself prints) but **not yet tried on an actual Windows
  machine** -- only Node-for-Node testable pieces could be verified from this macOS dev machine:
  the PowerShell download/checksum/extract logic ran for real under `pwsh`, and the spawn/tee/open
  logic in bootstrap.js was exercised against the real dev server. The batch file itself
  (`%PROCESSOR_ARCHITECTURE%` branch, `errorlevel` handling, the final `cmd /c start`) has only been
  read, not run. Someone with a Windows PC should try a clean double-click before this is called done.

## Contributing

Pull requests are welcome, and so is an [issue](https://github.com/gentzl/dcs-map-server/issues)
that only describes a problem — a report of a unit drawn with the wrong symbol is worth as much as
a patch, since classification rests on DCS type names and no one flies every asset pack. Include
the type name as DCS spells it (the contact label shows it) and, if you can, a recording made with
`npm run capture-ws`.

Fork, branch, and before sending anything:

```bash
npm run typecheck
npm test
```

Neither covers rendering, so anything visual has to be looked at — see
[Running without DCS](#running-without-dcs) for how, without starting the game.

Two things are not negotiable:

1. **Fog of war is filtered server-side.** Client-side filtering would be defeated with the
   developer tools in seconds, and the project would become a cheat tool.
2. **Only ODbL and public domain data sources.** No third-party tile servers without an
   agreement, no keys in the repository, no NC-licensed data in what ships.

Code is English throughout — comments, identifiers, commit messages. See
[AGENTS.md](../AGENTS.md) for that and the rest of the working conventions.

## License and data sources

Code is MIT licensed, see [LICENSE](../LICENSE).

Map data © OpenStreetMap contributors (ODbL). Terrain from the AWS Terrain Tiles
(SRTM/GMTED, public domain). Glyphs and sprites from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets), which in turn uses the
[Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) family (SIL Open Font License).

Built on, and grateful to:

- [MapLibre GL JS](https://maplibre.org/) — the map renderer the client runs on.
- [Protomaps](https://protomaps.com/) — the [PMTiles](https://github.com/protomaps/PMTiles) format,
  the daily OpenStreetMap-based planet builds `fetch-tiles` pulls each theater's tiles from, and
  [go-pmtiles](https://github.com/protomaps/go-pmtiles), the tool that extracts them
  (`ensurePmtiles` in `tools/fetch-tiles.ts` downloads it automatically).
- [Fastify](https://fastify.dev/) and [ws](https://github.com/websockets/ws) — the server and its
  WebSocket layer.
- [Eagle Dynamics](https://www.digitalcombatsimulator.com/) — DCS World's own export API, without
  which none of this would have anything to show.

Fetched tiles and glyphs are deliberately kept out of version control: vector tiles are a
derivative database in the sense of the ODbL, so they are fetched by script rather than
redistributed here. Anyone publishing prebuilt tiles takes on the ODbL share-alike obligations.

This project is not affiliated with or endorsed by Eagle Dynamics.
