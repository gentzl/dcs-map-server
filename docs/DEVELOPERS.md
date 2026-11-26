# Technical guide

For working on the code, running it without DCS, or driving it beyond what the menu exposes. If you just want to fly with it, the [handbook](MANUAL.md) is the one you want.

- [Manual setup](#manual-setup)
- [Finding DCS and detecting owned maps](#finding-dcs-and-detecting-owned-maps)
- [How it fits together](#how-it-fits-together)
- [Where the map comes from](#where-the-map-comes-from)
- [Source layout](#source-layout)
- [The DCS hook](#the-dcs-hook)
- [Wire protocol](#wire-protocol)
- [Running without DCS](#running-without-dcs)
- [Recording what actually goes over the wire](#recording-what-actually-goes-over-the-wire)
- [Tests](#tests)
- [Server endpoints](#server-endpoints)
- [Environment variables](#environment-variables)
- [HTTPS on a LAN](#https-on-a-lan)
- [Performance](#performance)
- [Still open](#still-open)
- [Contributing](#contributing)
- [License and data sources](#license-and-data-sources)

## Manual setup

The [README](../README.md) points players at `start.bat`, a one-click installer that works out
which maps they own by itself on every run (see
[Finding DCS and detecting owned maps](#finding-dcs-and-detecting-owned-maps)) and
downloads tiles for each one. For development, or if you'd rather run the steps yourself:

Clone the repo (`git clone`). You'll need [Node.js](https://nodejs.org) installed (version 22 or
newer). The project is Windows-only. Every command in this guide is for **PowerShell**, run in the
project folder, which is the one that contains `package.json`:

```powershell
cd D:\Programs\dcs-map-server\dcs-map-server   # wherever you cloned or unzipped it
```

1. Install and prepare the map data (one-time, a couple of minutes):

   ```powershell
   npm install
   Copy-Item node_modules\maplibre-gl\dist\maplibre-gl.css public\
   npm run fetch-assets        # map labels and symbols, ~2.3 MB
   npm run fetch-tiles -- caucasus  # the map itself, ~131 MB — swap in another theater if you fly elsewhere
   npm run install-hook        # copies the DCS export hook into Saved Games, see below
   npm run extract-navdata     # airfield frequencies from your DCS install, see below
   ```

   `extract-navdata` reads each installed theater's `Radio.lua` and `Beacons.lua` from
   `Mods\terrains\<theater>\` into `navdata\<theater>.json`, which the server hands to the map
   (`/api/navdata/<theater>`) for the airfield readout. The files are Eagle Dynamics', so this runs
   locally and `navdata\` is git-ignored -- nothing of them is redistributed, the same as with the
   tiles. They are read as text, never executed (`tools/navdata.ts`). Without a DCS install it
   does nothing, and airfields simply show without frequencies.

   `fetch-tiles` downloads the `pmtiles` tool it needs by itself the first time it runs, into this
   project's own `runtime\` folder — nothing to put on `PATH`.

   `install-hook` copies `dcs/Scripts/Hooks/dcs-map-server.lua` into every DCS installation it finds
   under `Saved Games\` (stable and open beta). An older version of this project's own hook --
   recognised by its header line, `-- dcs-map-server -- Export Hook` (`Export-Hook` in the
   earliest versions) -- is replaced, and kept as `dcs-map-server.lua.bak`. Any other file at
   that path is left alone, so it's always safe to re-run. If you'd rather do it by hand, or it
   doesn't find your DCS install, copy that file into `Saved Games\DCS\Scripts\Hooks\` yourself.
   Either way, restart DCS: it only loads hooks at startup. Keep the header line when editing the
   hook, or the next update won't recognise it.

2. (Re)start DCS, so it picks up the hook.

3. Start the server:

   ```powershell
   npm run dev
   ```

4. Open the web address it prints — `http://localhost:8080` on the DCS PC itself, or one of the
   other addresses it lists from a phone or tablet on the same Wi-Fi.

This path doesn't touch `theaters.json` -- `fetch-tiles` just downloads whatever theater you pass
it, as many times as you like.

## Finding DCS and detecting owned maps

In the normal case a player never deals with any of this. `start.bat` detects the owned maps on
every run and downloads tiles for each one, so a map bought later just needs another
double-click on `start.bat`. Only when detection fails does setup ask, once, and
`configure-maps.bat` changes that answer later. Every run writes what it checked and found to
`setup.log` next to `start.bat`, the first thing to look at when detection seems wrong.

How it works: `tools/dcs-paths.js` finds where DCS lives; `tools/detect-owned-theaters.js` then reads which maps
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

## Where the map comes from

The base map is the real world, not DCS's own map. From the game come the contacts (aircraft,
ships, ground units), the airfields and the mission's zones.

- **Vector data** (roads, towns, rivers, runways, airfield names): OpenStreetMap, via the daily
  [Protomaps](https://protomaps.com/) planet build. `npm run fetch-tiles -- <theater>`
  (`tools/fetch-tiles.ts`) cuts each theater's extent (`THEATER_BOUNDS` in
  `src/shared/theaters.ts`) out of that build into `tiles\<theater>.pmtiles`, and the server serves
  it under `/tiles/`.
- **Airports** come from two places. Runways are always OpenStreetMap: `src/client/chart.ts`
  draws them from the `roads` layer (`kind: aeroway`). Airfield symbols and names come from DCS
  itself whenever the hook supplies them (`B` lines, see [Wire protocol](#wire-protocol);
  `src/client/airbases.ts`), blue or red as the export reports them, grey for neutral. Grey
  means "unknown": in a multiplayer test the export had 13 of 21 fields blue, all matching F10,
  and 8 neutral that F10 also showed blue -- a mission script changing ownership isn't fully
  followed by the export. Red and blue are believed, neutral is not (`SHOW_OWNERSHIP`). Helipads
  and FARPs without a runway (`level2` 18, all named "woRunWay") are left out, they already arrive
  as static objects. The OpenStreetMap airfield names (`pois` layer, `kind: aerodrome`) are then
  hidden, and only shown without DCS data, e.g. when replaying an older recording.
- **Airfield frequencies and navaids**: the theater's own `Radio.lua` and `Beacons.lua` in the
  local DCS install, read at setup (`npm run extract-navdata`, see [Manual setup](#manual-setup)).
- **Mission zones**: the mission file's trigger zones, sent by the hook (`Z` lines).
- **Flight plan**: the player's own fixed waypoints, sent by the hook (`R` lines).
- **Terrain shading and elevation tints**: public-domain SRTM/GMTED from the AWS Terrain Tiles,
  fetched live by the browser (`TERRAIN_TILES` in `src/client/style.ts`), so they need an internet
  connection while the map is open.

Most of the time this matches DCS, but not always. The airfields themselves follow DCS (above),
but their runways, and everything else on the base map, are shown the way OpenStreetMap has them
today; nothing on the base map is checked against DCS's own data. Licenses and attribution are
under [License and data sources](#license-and-data-sources).

## Source layout

```
src/shared/types.ts      Wire format between server and client
src/shared/theaters.ts   Theater extents; which theater a position lies in
src/server/protocol.ts   Parser for the DCS hook's UDP format
src/server/classify.ts   Sorting objects into presentation categories
src/server/threats.ts    Engagement ranges of air defence systems
src/server/world.ts      World state, delta building, fog of war; airbases and zones
src/server/ingest.ts     UDP socket
src/server/relay.ts      Upstream-WebSocket relay mode (MM_UPSTREAM)
src/server/index.ts      Fastify + WebSocket + tick, HTTP endpoints
src/client/geo.ts        Geodetic maths, range/zoom, cockpit formatting
src/client/track.ts      Dead reckoning and interpolation buffer
src/client/style.ts      Map style: elevation tints, shading, vector layers
src/client/chart.ts      Aviation layers of the base map (runways, OSM airfields)
src/client/overlays.ts   Range rings, threat rings, bullseye, velocity leaders
src/client/graticule.ts  Lat/lon grid
src/client/airbases.ts   DCS airfields: symbol, frequency matching, the airfield readout
src/client/zones.ts      Mission zones: which to draw, and their outlines
src/client/find.ts       Find in the menu: zones and airfields by name
src/client/settings.ts   Settings and view, stored in the browser
src/client/symbols/      Contact symbols, drawn at runtime (nato.ts, dcs.ts)
src/client/main.ts       MapLibre, render loop, HUD, menu, input
dcs/Scripts/Hooks/       DCS export hook (Lua)
dcs/test/                Harness driving the hook against mocked DCS APIs
dcs/test/fixtures/       Recorded sessions, used by the tests
test/                    Automated tests (node --test)
tools/bootstrap.js       What start.bat runs: setup steps, then the server
tools/wire.ts            Datagram writer, counterpart to protocol.ts
tools/zip.ts             Minimal ZIP reader for Tacview archives
tools/capture-ws.ts      Records a live server's WebSocket feed to a file
tools/replay-ws.ts       Replays such a recording as a relay source
tools/demo.ts            npm run demo: replay plus server in one window
tools/navdata.ts         Reads a theater's Radio.lua / Beacons.lua (as text)
tools/extract-navdata.ts npm run extract-navdata: writes navdata\<theater>.json
tools/                   Telemetry generator and ACMI converter
```

## The DCS hook

Copy `dcs/Scripts/Hooks/dcs-map-server.lua` into `Saved Games\DCS\Scripts\Hooks\` and restart DCS.
That is all — **no `Export.lua` is needed and none is modified.** `npm run install-hook`
(`tools/install-hook.ts`) does this copy automatically for every DCS variant it finds, updating
an older version of this hook and leaving any other file at that path alone (see
[Manual setup](#manual-setup)).

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
line that carries the schema version, the DCS model time, the mission's visibility rule, the
mission start time (seconds after midnight) and a blocked-objects flag. Start plus model time is
the mission's clock time, the one the F10 map shows and the map's status bar displays. The last
two fields were added later and are optional: older hooks send four, and an empty start time
means the hook couldn't find it. The flag is `1` when `LoGetWorldObjects()` returned `nil` instead
of a list -- the server has object export switched off (`allow_object_export`), so no other unit
and no airbase will ever arrive -- and the map then says so instead of just looking empty.

```
MM<TAB>3<TAB><modelTime><TAB><optionsView><TAB><missionStart><TAB><objectsBlocked>
O<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>unitName<TAB>groupName<TAB>coalition<TAB>tas<TAB>ralt<TAB>wow<TAB>aoa<TAB>accelY<TAB>chaff<TAB>flare<TAB>windX<TAB>windY<TAB>windZ
A<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>unitName<TAB>groupName<TAB>coalition<TAB>level1<TAB>level2<TAB>human
W<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>coalition
D<TAB>id
B<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>coalition<TAB>level2
Z<TAB>id<TAB>name<TAB>hidden<TAB>type<TAB>radius<TAB>lat<TAB>lon<TAB>r,g,b,a<TAB>lat,lon;lat,lon;...
R<TAB>source<TAB>next<TAB>lat,lon,alt,name;lat,lon,alt,name;...
```

`O` is the own aircraft, `A` another unit, `W` a weapon, `D` a removal, `B` an airbase, `Z` a
trigger zone, `R` the player's flight plan. `level1`/`level2` are the DCS type levels; without `level1` air defence cannot be
separated from other ground targets, which is why schema 2 was replaced. The hook strips tabs and
line breaks from names; commas may stay.

`human` on an `A` line is `1` when a person flies the unit (DCS's `Flags.Human`), else `0`; for a
player, `unitName` is the player's name. `Flags.AI_ON` is no use for this -- it is true for players
too (probed 2026-11-25: another player's F-16 had `Human = true`, an AI aircraft `false`). The field
came later: the parser still takes the older twelve-field line, as no human. It only ever marks
units the view rules already let through, so it reveals nothing F10 doesn't; the map puts a small
dot at the symbol's top right and shows the name in the BRAA readout.

`B` lines carry DCS's own airbases from `LoGetWorldObjects('airdromes')`, which the plain object
list does not contain. The hook sends the whole list at mission start and then once a minute: a
base can change hands, and a server started mid-mission still gets it. A separate record type
rather than an `A` line, because a base is a map feature and not a contact -- no fog of war (every
player sees DCS's airfields on F10), no staleness, no heartbeat. The server passes a base on only
when it is new or has changed, and tells clients to drop them all when the mission ends. A server
older than this logs the unknown `B` lines as dropped and otherwise carries on.

`Z` lines carry the mission's trigger zones from `DCS.getCurrentMission()`, converted to lat/lon
by the hook with `Export.LoLoCoordinatesToGeoCoordinates` (the doubled "Lo" is DCS's spelling) --
mission files use map coordinates, and only the game knows the theater's projection. `type` 0 is
a circle (`radius`, centre), 2 a quad (the vertex list, last field). The hook converts them once
per mission and re-sends them every five minutes for a server started late; the server handles
them like airbases. Which zones are drawn, and how, is the client's call (`src/client/zones.ts`):
only main zones (no `-1`, `-sp`, `-hsp`, `-runway-1` suffix), sorted into sectors (over 10 km
across), airfield zones (named like a DCS airbase, blue if that base is reported blue) and
objectives (red). Zones carry no type and no owner, so size and name are all there is to go by. A circle's
vertex list is empty, so its line ends in a tab -- which is why the parser trims only line breaks
and spaces off a datagram, never tabs.

`R` lines carry the player's own flight plan, fixed waypoints only, every five seconds, the whole
route in one line (so a shorter route can't leave stale points behind; capped at 100 points).
`source` is `aircraft` when `Export.LoGetRoute()` returns a route -- then `next` is the index of
`goto_point`, and world `x`/`z` go through `LoLoCoordinatesToGeoCoordinates` -- or `mission` for
the route of the player's group in `DCS.getCurrentMission()`, with `next` -1 (the mission file
can't say which point is being flown to). The group is found by the slot from
`net.get_player_info(net.get_my_player_id(), 'slot')`, which is the mission `unitId` (`1234_2`
for a second seat), and by `LoGetSelfData().UnitName` in single player, where there is no slot.
An empty `source` with no points means there is no flight plan; the server then sends `route:
null`. Unlike units the route is no fog-of-war matter: it is the player's own plan, which F10
shows them anyway. The server passes it on only when it changed. `alt` is the planned altitude in
metres as given, whatever the waypoint's `alt_type` (baro or radar).

What doesn't arrive, by DCS's design rather than the hook's: waypoints entered in the cockpit or
drawn with the F10 route tool on modules with their own navigation computer (`LoGetRoute()` stays
`nil` on the F-16C, probed 2026-11-25), and any route for a dynamic-spawn slot, whose unit isn't in
the mission file. The hook logs which case applies (`flight plan: ...` in `dcs.log`). `npm run
demo` adds a made-up route (`replay-ws --demo-extras`) when a recording has none, so the layer can
be seen without DCS; the same option marks a recording's anonymised `Player-N` units as human.

**Schema 1** is the older comma-separated format with no header, kept for anyone running the
telemetry out of their own `Export.lua`. It is ambiguous by construction: names are inserted
unescaped, so a comma inside one shifts every following field. The parser recovers by searching
for the contiguous lat/lon/alt/hdg block rather than silently misreading coordinates — which works
as long as the shifted fragment doesn't itself read as a number. `tools/wire.ts` sidesteps the
problem entirely by replacing commas with spaces when it writes schema 1.

## Running without DCS

Check the hook against mocked export APIs:

```powershell
lua dcs\test\hook_harness.lua 300 optview_all 150
```

This needs a Lua interpreter on `PATH` (for example `winget install DEVCOM.Lua`).

It writes the datagrams to stdout and checks them: header per datagram, schema version, the
configured `optionsView` and the mission start time coming back out, the field count of every line
type, a `D` line once objects disappear, airbase (`B`) and zone (`Z`) lines being sent, the own
aircraft not also sent as an ordinary unit, and a comma in a group name surviving while a tab
does not. It exits non-zero and says what broke, so it belongs in CI rather
than in a careful read of its output — which is where it runs.

**Replaying a recorded session** is the route to use when you're changing the client. It puts real
objects of every category on the map, with real movement, without starting DCS. The recording is
fed through the server as if it came from a second live instance.

The quickest way is one command in one PowerShell window:

```powershell
npm run demo
```

It builds the project, starts the replay and the server together, and prints the address to open,
normally `http://localhost:8080`. Ctrl+C stops both. A recording's path can be given relative to
the folder you're in, or to the project folder (`tools/user-path.ts`; npm itself always runs the
script in the project folder). To play the other recording instead:

```powershell
npm run demo -- dcs\test\fixtures\real-session-2026-11-23-multiplayer.jsonl
```

To run the two halves separately, for example to restart only the server while the replay keeps
going, use **two PowerShell windows**, both in the project folder. Each window runs a process that
keeps going until you stop it with Ctrl+C.

Window 1, the recording:

```powershell
npm run replay-ws -- dcs\test\fixtures\real-session-2026-11-23.jsonl --port 8766
```

Window 2, the server, pointed at the recording instead of the DCS hook:

```powershell
$env:MM_UPSTREAM = "ws://127.0.0.1:8766/ws"
npm run dev
```

Then open `http://localhost:8080`. The recording loops by default; add `--once` to the first
command to play it a single time. On start, `replay-ws` prints the window 2 commands ready to copy. Two recordings ship in `dcs\test\fixtures\` (see the
[README](../dcs/test/fixtures/README.md) there):

| File | Content |
|---|---|
| `real-session-2026-11-23.jsonl` | Single-player, one A-10A, 245 objects, 90 seconds |
| `real-session-2026-11-23-multiplayer.jsonl` | Multiplayer, 301 objects, 30 seconds |

Both predate the mission start time, airbases and zones, so in a replay the clock reads
`--:--:--` and those layers stay empty.

`$env:MM_UPSTREAM` stays set for as long as that PowerShell window is open. To go back to the
DCS hook in the same window, clear it first:

```powershell
Remove-Item Env:MM_UPSTREAM
```

**Synthetic telemetry** goes to the server's normal UDP input. Start the server in window 1
without `MM_UPSTREAM` (`npm run dev`), then in window 2:

```powershell
npm run telemetry -- --send --units 20
```

**A Tacview recording** goes the same way. DCS/Tacview writes one after every flight. Window 1
runs `npm run dev`, window 2 runs:

```powershell
npm run acmi -- flight.zip.acmi --list    # show objects
npm run acmi -- flight.zip.acmi --send
```

## Recording what actually goes over the wire

When the log isn't enough, record the raw datagrams and have them summarised. Three causes look
identical from outside — nothing arrives, something arrives unreadably, or the mission withholds
it — and this tells them apart:

```powershell
$env:MM_CAPTURE = "$env:TEMP\hook.jsonl"
npm run dev                                # fly for a minute, then Ctrl+C
Remove-Item Env:MM_CAPTURE
npm run capture -- "$env:TEMP\hook.jsonl"
```

It reports line types, the reported visibility rule, parse errors, the type levels DCS supplied
and the unit names seen, then states which of the three cases applies.

To capture what the *server* sends to browsers instead — for a test fixture, or to replay later:

```powershell
npm run capture-ws -- wss://192.168.1.23:8443/ws --out session.jsonl --seconds 90 --insecure
```

Replace the address with the one the server prints.

Recordings committed as fixtures are described in
[`dcs/test/fixtures/README.md`](../dcs/test/fixtures/README.md), including what was anonymised.

## Tests

```powershell
npm run typecheck   # all four TS projects, including the tests
npm test            # compiles the tests, then runs them
```

Node's built-in runner, no test framework. `npm test` compiles `test/` to `dist-test/` and runs
every `*.test.js` there. The whole suite is well under a second.

What's covered, and why those parts:

| File | Covers |
|---|---|
| `test/protocol.test.ts` | Every packet type round-tripped through `tools/wire.ts` and `src/server/protocol.ts`, both schemas, plus framing, the optional start-time field and error handling |
| `test/world.test.ts` | Delta building, heartbeats, staleness and dropping — and the fog-of-war matrix, including against both recorded sessions; airbases |
| `test/zones.test.ts` | Zone lines round-tripped, which zones count as main zones, circle outlines, the server's handling |
| `test/navdata.test.ts` | Reading Radio.lua / Beacons.lua, matching airfields, the airfield readout's rows and runway columns |
| `test/theaters.test.ts` | Which theater a position lies in |
| `test/find.test.ts` | Find: ordering of hits, airfield over its zone, nothing the map doesn't draw |
| `test/install-hook.test.ts` | Installing the hook: never someone else's file, updating an older version of our own |
| `test/classify.test.ts` | Classification of every unit name in the recorded sessions, against a checked-in baseline |
| `test/threats.test.ts` | Which air defence units get a threat ring and which don't |
| `test/geo.test.ts` | The geodetic maths and cockpit formatting the BRA readout depends on, the mission clock, runway headings |
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

```powershell
npm run build:test --silent
@'
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
'@ | node --input-type=module
```

The script goes to Node through the pipe because PowerShell 5.1 strips the double quotes from an
argument passed with `node -e`. The closing `'@` has to start at the beginning of its line.

### What the tests don't cover

Rendering. Symbols, range rings, pan and zoom behaviour, the HUD — none of that is checked
automatically, and a green suite says nothing about whether the map looks right. Changes there
have to be looked at, which is what the replay route under
[Running without DCS](#running-without-dcs) is for.

## Server endpoints

| Path | What |
|---|---|
| `/` | The map |
| `/ws` | WebSocket: one snapshot, then deltas (`src/shared/types.ts`) |
| `/tiles/<theater>.pmtiles` | The theater's map tiles, read by range requests |
| `/api/theaters` | Which theaters have tiles |
| `/api/navdata/<theater>` | Airfield frequencies and navaids, `[]` if none were extracted |
| `/api/version` | The running version |
| `/health` | Counts (units, airbases, zones), and how long since the hook's last packet |

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

Use [mkcert](https://github.com/FiloSottile/mkcert) to create the certificate. It sets up a small
certificate authority of your own and issues the certificate from it:

```powershell
winget install FiloSottile.mkcert
mkcert -install
New-Item -ItemType Directory -Force certs | Out-Null
mkcert -key-file certs\key.pem -cert-file certs\cert.pem localhost 127.0.0.1 192.168.1.23
```

Replace `192.168.1.23` with the PC's LAN IP (`ipconfig` lists it). The IP has to be in the
certificate, because iOS and Android check only the `subjectAltName`, never the common name.

The server picks the certificate up from `certs\` on its next start and serves HTTPS on
`MM_HTTPS_PORT`, redirecting plain HTTP to it.

To stop the tablet from showing a warning, install the CA there too. `mkcert -CAROOT` shows the
folder that holds `rootCA.pem`. Copy that file to the device and trust it there. Otherwise accept
the browser's warning once; after that the page counts as a secure context and Wake Lock works.

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
  display up. Probed on 2026-11-25 as a multiplayer client: `coalition.getMainRefPoint()` via
  `net.dostring_in` comes back `nil` (the mission scripting environment is closed to clients), but
  the bullseye of every coalition is in the mission data the hook already reads,
  `DCS.getCurrentMission().mission.coalition.<side>.bullseye`, in map coordinates that
  `Export.LoLoCoordinatesToGeoCoordinates` converts -- the same route the zones take. Not built
  yet.
- More that DCS exposes to a hook and the map doesn't use yet (probed 2026-11-25, multiplayer
  client): editor drawings
  (`mission.drawings`: lines, text boxes, the tanker tracks and frontlines on F10); the radio
  beacons as a layer of their own (the data is in `navdata\` already). Not reachable as a client:
  F10 map marks (`world.getMarkPanels()`) and which side holds a zone, both runtime state of the
  mission scripting environment.
- ICAO codes, runway lengths and runway names for the airfield readout. F10 shows them, but they
  are in an encrypted terrain file, not in anything the hook or setup can read.
- Waypoints entered in the cockpit (F-16C steerpoints) or with the F10 route tool. The fixed
  flight plan is on the map (`R` lines), but these never reach the hook: probed on 2026-11-25
  with an F-16C as a multiplayer client, `LoGetRoute()` and `LoGetNavigationInfo()` stay `nil`
  after both. Which other modules report a route through `LoGetRoute()` is unchecked.
- A small number of ship classes with a genuine area air-defence system have a threat ring
  (Ticonderoga/Arleigh Burke-class, Aegis; Kirov/Slava-class, SA-N-6) -- see threats.ts. Frigates
  and corvettes with a shorter-range system are deliberately left out until someone can confirm
  the actual in-game numbers; adding a wrong range would be worse than no ring.

## Contributing

Pull requests are welcome, and so is an [issue](https://github.com/gentzl/dcs-map-server/issues)
that only describes a problem — a report of a unit drawn with the wrong symbol is worth as much as
a patch, since classification rests on DCS type names and no one flies every asset pack. Include
the type name as DCS spells it (the contact label shows it) and, if you can, a recording made with
`npm run capture-ws`.

Fork, branch, and before sending anything:

```powershell
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

## Versioning

Versions are `MAJOR.MINOR.BUILD`. `MAJOR.MINOR` is set by hand as an annotated git tag; `BUILD`
is the number of commits since that tag and counts up by itself — nothing is committed to bump it.
The server prints the version on startup and serves it at `/api/version`.

```powershell
git tag -a v0.4320 -m "Version 0.4320"   # new minor (or major), build starts again at 0
git push origin v0.4320
```

Also update `version` in `package.json` to `MAJOR.MINOR.0` so npm agrees; the build number itself
is never written there.

A git clone gets the version from `git describe`. GitHub's "Download ZIP" has no `.git`, but GitHub
builds it with `git archive`, which fills in the placeholder in `VERSION_ARCHIVE`
(`export-subst` in `.gitattributes`). Tags have to be pushed for either to see them; without one
the version reads `0.0.0-unknown`. The first version, `0.4319`, is D-C-S as alphabet positions
(4, 3, 19).
