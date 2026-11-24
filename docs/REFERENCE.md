# dcs-map-server — full reference

This is the detailed documentation: every feature, every setting, every troubleshooting step.
For the short version — what this is and how to get it running — see the [main README](../README.md).

## Features

**Map**

- Self-hosted vector tiles (PMTiles built from OpenStreetMap), hypsometric elevation tinting and
  hillshading from an open DEM, glyphs and sprites served locally. No API key, and no third-party
  tile server at runtime apart from the DEM (see below).
- Aeronautical chart presentation: elevation tints, terrain shading, lat/lon graticule with
  coordinate labels, emphasised runways, spot elevations in feet. Switchable to a dimmed night
  presentation.

**Tactical**

- Range rings with bearing ticks, bullseye with BRA readout, a BRA line and full readout
  (affiliation, category, bearing/range/altitude/aspect, ground speed) to a selected contact.
- Threat rings around air defence, drawn geodesically and sized per system type. Default is
  hostile only — a friendly PATRIOT covers half the map at 100 km without being useful in flight.
- Contact symbology following **NATO APP-6 / MIL-STD-2525**: the frame carries affiliation and
  battle dimension (friend rectangle, hostile diamond, air open at the bottom), the icon inside
  carries the object type (air screw, rotor blades, tank treads, protective dome, hull, `CV`).
  Affiliation is relative to the viewer: your own coalition is friend. Fixed wing, rotary wing,
  armour, unspecified ground, air defence, surface vessel, carrier, submarine and weapon are
  distinguished. A symbol legend sits in the settings panel.
- A second symbol set following the in-game map presentation, switchable. Shape carries the
  domain and the content carries the type: a shield with a role letter for air (`F` fighter,
  `C` transport, `K` tanker, `W` AWACS, `H` rotary wing), a rectangle with a pictogram for ground,
  a circle with a code for vessels (`CC`, `CV`, `SS`).
  Colour follows the coalition rather than the viewer's affiliation — blue stays blue even when
  flying red. Redrawn from screenshots of the F10 map; the original artwork ships as protected
  textures and is not redistributed here. The green condition bar above ground and naval markers
  is deliberately left out: the export hook carries no condition, and a permanently full bar would
  claim "undamaged" without knowing it.

**Cockpit conventions**

- MFD-style range steps: 1/5/10/20/50/80/160 nm, the scaling of the Hornet and Viper HSI/HSD
  displays, plus stepless pinch/wheel zoom for fine adjustment. The zoom level is derived from
  range, viewport size and latitude, so "20 NM" means the same distance on every device.
- Coordinates in degrees and decimal minutes, altitude in feet or as a flight level, speed in
  knots, distance in nautical miles, bearings magnetic.
- Follow mode keeps your aircraft centred; free mode lets you pan and zoom to look anywhere,
  keeping whatever orientation the view already had — panning and zooming never fight each other
  or snap the view away from where you're looking.

**Platform**

- Own DCS export hook, schema 3: tab separated, batched, versioned, with real removal events
  instead of timeouts.
- Server-side fog-of-war filtering by `optionsView`.
- Dead reckoning for own aircraft, interpolation buffer for other contacts.
- Tablet ready: HTTPS with the LAN IP in the certificate, Screen Wake Lock, touch controls.

Measured bandwidth per client with 150 objects at 10 Hz: 7.4 KiB/s (nothing moving),
44.5 KiB/s (30 % moving), 224 KiB/s (everything moving).

Still open: MGRS grid, declutter levels, DEM held locally instead of fetched from AWS, contour
lines, further theaters.

## Installing the hook, in detail

Copy `dcs/Scripts/Hooks/dcs-map-server.lua` into `Saved Games\DCS\Scripts\Hooks\`
and restart DCS. That is all — **no `Export.lua` is needed and none is modified.**

This matters because the two mechanisms are easy to confuse:

| | `Scripts/Export.lua` | `Scripts/Hooks/*.lua` |
|---|---|---|
| Entry points | `LuaExportStart`, `LuaExportActivity`, `LuaExportStop` | `DCS.setUserCallbacks` with `onSimulationStart/Frame/Stop` |
| Loaded | once, as a single file shared by every tool | one file per tool, side by side |
| Used by | SRS, DCS-BIOS, many instrument exporters | this project |

The hook route was chosen deliberately: `Export.lua` is a single shared file, so
every tool that wants it has to chain onto whatever is already there. Hooks live
in their own files and cannot collide.

Both environments can call the `Export.Lo*` functions, which is where the
telemetry comes from — `LoGetSelfData`, `LoGetWorldObjects` and friends.

### If you prefer the Export.lua route

Should you want to run the telemetry from `Export.lua` instead — for instance to
keep everything in one place — the important part is to chain rather than
replace. Overwriting the existing handlers silently breaks every other tool:

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
`DCS.getMissionOptions()`, so the fog-of-war setting would have to be obtained
elsewhere, and the export interval is configured in `Config/Export.lua` rather
than derived from the model time.

## Why HTTPS on a LAN

Not for confidentiality — that is secondary on a home network — but because the Screen Wake Lock
API requires a secure context. Over `http://<LAN-IP>` there is none, and a tablet whose display
sleeps mid-flight is useless. `tools/make-cert.sh` puts the LAN IP into the `subjectAltName`;
iOS and Android check only that, never the common name.

## Running without DCS

Check the hook against mocked export APIs:

```bash
lua dcs/test/hook_harness.lua 300 optview_all 150
```

Synthetic telemetry:

```bash
npm run telemetry -- --send --units 20
```

A real recording — DCS/Tacview writes one after every flight:

```bash
npm run acmi -- flight.zip.acmi --list    # show objects
npm run acmi -- flight.zip.acmi --send
```

Or replay a previously captured session (see `npm run capture-ws` below) through the server as if
it were a second live instance:

```bash
npm run replay-ws -- dcs/test/fixtures/real-session-2026-11-23.jsonl --port 8766
MM_UPSTREAM=ws://127.0.0.1:8766/ws npm run dev
```

Both generator tools emit the same wire format as the hook and verify their first datagram
against the server's own parser before sending. Two independent implementations
of one format drift apart otherwise, and that has already happened once.

## Troubleshooting: no contacts appear

Own position shows but nothing else: the mission is withholding them, which is
normal and not a fault of the display. DCS exposes its map setting as
`optionsView`, and two of its values suppress every other unit —
`optview_myaircraft` and `optview_onlymap`.

The display says so: a banner reads `CONTACTS WITHHELD BY MISSION` and the
settings panel shows the reported value. The hook also writes it to
`Saved Games/DCS/Logs/dcs.log` every ten seconds, together with how many objects
the export returned:

```
[map-server] optionsView=optview_myaircraft  objects=0  sent=0
[map-server] mission is withholding other units (map view setting in the mission or server options)
```

The setting belongs to the mission, not to this tool. Single player: the
mission's own difficulty options, or the gameplay settings where the mission
does not force them. Multiplayer: the server decides and you cannot change it.
Filtering happens server-side here by design — see Contributing.

If it's a multiplayer server, this can also mean `allow_object_export` is off in *that server's*
`autoexec.cfg` — a setting you can't change unless you administer it yourself. A single-player
mission or a server you host yourself needs it set to `true`.

### Recording what the hook actually sends

When the log is not enough, record the raw datagrams and have them summarised.
Three causes look identical from outside — nothing arrives, something arrives
unreadably, or the mission withholds it — and this tells them apart:

```bash
MM_CAPTURE=/tmp/hook.jsonl npm run dev     # fly for a minute
npm run capture -- /tmp/hook.jsonl
```

It reports line types, the reported visibility rule, parse errors, the type
levels DCS supplied and the unit names seen, then states which of the three
cases applies.

To capture what the *server* sends to browsers instead (for a test fixture, or to replay a
session later, see above):

```bash
npm run capture-ws -- wss://<host>:8443/ws --out session.jsonl --seconds 90 --insecure
```

## Controls

| Input | Effect |
|---|---|
| `1` `5` `10` `20` `50` `80` `160` | Range scale in nautical miles |
| Wheel, pinch | Stepless zoom |
| Click/touch and drag | Pan the map, switches to FREE |
| `CTR / FREE` | Follow the aircraft, or pan the map freely |
| `HDG / N` | Heading up or north up (follow mode only) |
| `⚙` | Settings (stored in the browser) |
| Tap a contact | BRA line and readout: affiliation, category, bearing, range, altitude, aspect, speed |
| `⚙` → Symbols | Legend of all contact symbols |
| Shift + click | Place the bullseye — the export hook does not provide it |

Settings cover presentation mode, elevation tint, relief strength, place names, range rings,
threat rings, graticule, bullseye, contact filter, contact labels, symbol set, bearing reference
and theater.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MM_HTTP_PORT` | 8080 | HTTP — the app without a certificate, the redirect with one |
| `MM_HTTPS_PORT` | 8443 | HTTPS, as soon as `certs/` holds a certificate |
| `MM_UDP_PORT` | 50000 | Ingest from the DCS hook |
| `MM_UDP_HOST` | 127.0.0.1 | Deliberately loopback only — the LAN hop is the WebSocket |
| `MM_TICK_HZ` | 10 | Broadcast tick rate |
| `MM_TLS` | – | `off` forces plaintext even when a certificate is present |
| `MM_UPSTREAM` | – | Relay from another server's `/ws` instead of reading local UDP (see "Running without DCS") |
| `MM_UPSTREAM_INSECURE` | – | `1` accepts a self-signed certificate on the upstream server |
| `MM_CAPTURE` | – | Path to record every raw datagram the hook sends, for `npm run capture` |

## Layout

```
src/shared/types.ts      Wire format between server and client
src/server/protocol.ts   Parser for the DCS hook's UDP format
src/server/classify.ts   Sorting objects into presentation categories
src/server/threats.ts    Engagement ranges of air defence systems
src/server/world.ts      World state, delta building, fog of war
src/server/ingest.ts     UDP socket
src/server/relay.ts      Upstream-WebSocket relay mode (MM_UPSTREAM)
src/server/index.ts      Fastify + WebSocket + tick
src/client/track.ts      Dead reckoning and interpolation buffer
src/client/style.ts      Map style: elevation tints, shading, vector layers
src/client/symbols/      Contact symbols, drawn at runtime (nato.ts, dcs.ts)
src/client/main.ts       MapLibre, render loop, HUD
dcs/Scripts/Hooks/       DCS export hook (Lua)
dcs/test/                Harness driving the hook against mocked DCS APIs
tools/wire.ts            Datagram writer, counterpart to protocol.ts
tools/zip.ts             Minimal ZIP reader for Tacview archives
tools/capture-ws.ts      Records a live server's WebSocket feed to a file
tools/replay-ws.ts       Replays such a recording as a relay source
tools/                   Telemetry generator and ACMI converter
```

## Contributing

Two things are not negotiable:

1. **Fog of war is filtered server-side.** Client-side filtering would be defeated with the
   developer tools in seconds, and the project would become a cheat tool.
2. **Only ODbL and public domain data sources.** No third-party tile servers without an
   agreement, no keys in the repository, no NC-licensed data in what ships.

See [AGENTS.md](../AGENTS.md) for the code-language convention (English throughout).

## License

Code is MIT licensed, see [LICENSE](../LICENSE).

Map data © OpenStreetMap contributors (ODbL). Terrain from the AWS Terrain Tiles
(SRTM/GMTED, public domain). Glyphs and sprites from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets).

Fetched tiles and glyphs are deliberately kept out of version control: vector tiles are a
derivative database in the sense of the ODbL, so they are fetched by script rather than
redistributed here. Anyone publishing prebuilt tiles takes on the ODbL share-alike obligations.

This project is not affiliated with or endorsed by Eagle Dynamics.
