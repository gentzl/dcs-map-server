# dcs-map-server

A live navigation display for DCS World in the browser: one server on the DCS PC, any number of
clients on the LAN. No per-client install, no API key.

Built for the pilot in the cockpit, not for a controller looking down from above — own aircraft
centred, heading up, smooth motion, cockpit units throughout.

## Features

**Map**

- Self-hosted vector tiles (PMTiles built from OpenStreetMap), hypsometric elevation tinting and
  hillshading from an open DEM, glyphs and sprites served locally. No API key, and no third-party
  tile server at runtime apart from the DEM (see below).
- Aeronautical chart presentation: elevation tints, terrain shading, lat/lon graticule with
  coordinate labels, emphasised runways, spot elevations in feet. Switchable to a dimmed night
  presentation.

**Tactical**

- Range rings with bearing ticks, bullseye with BRA readout, BRAA to a selected contact including
  aspect angle.
- Threat rings around air defence, drawn geodesically and sized per system type. Default is
  hostile only — a friendly PATRIOT covers half the map at 100 km without being useful in flight.
- Contact symbology following **NATO APP-6 / MIL-STD-2525**: the frame carries affiliation and
  battle dimension (friend rectangle, hostile diamond, air open at the bottom), the icon inside
  carries the object type (air screw, rotor blades, tank treads, protective dome, hull, `CV`).
  Affiliation is relative to the viewer: your own coalition is friend. Fixed wing, rotary wing,
  armour, unspecified ground, air defence, surface vessel, carrier, submarine and weapon are
  distinguished. A symbol legend sits in the settings panel.
- A second symbol set loosely following the in-game map presentation, switchable.
  **This is an approximation.** The original artwork ships as protected textures inside the DCS
  installation and no usable reference was obtainable from accessible sources. Only the confirmed
  characteristics are implemented: filled compact shapes, colour by coalition rather than by
  affiliation, and directional shapes for air and surface vessels.

**Cockpit conventions**

- MFD-style range steps: 5/10/20/40/50/80/160 nm, the scaling of the Hornet and Viper HSI/HSD
  displays. The zoom level is derived from range, viewport size and latitude, so "40 NM" means the
  same distance on every device.
- Coordinates in degrees and decimal minutes, altitude in feet or as a flight level, speed in
  knots, distance in nautical miles, bearings magnetic.

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

## Getting started

```bash
npm install
cp node_modules/maplibre-gl/dist/maplibre-gl.css public/
./tools/fetch-map-assets.sh          # glyphs and sprites, ~2.3 MB
./tools/fetch-tiles.sh caucasus      # map tiles, ~131 MB
./tools/make-cert.sh                 # optional, for tablet access
npm run dev                          # builds and starts the server
```

Without a certificate the server runs on `http://localhost:8080`. With one in `certs/` it runs on
`https://<LAN-IP>:8443`, and port 8080 redirects there.

Fetching tiles requires the [pmtiles CLI](https://github.com/protomaps/go-pmtiles)
(`brew install pmtiles`). It pulls only the bytes of the requested region out of the public
Protomaps planet build via HTTP range requests — no Java, no key, about 20 seconds.

Install the hook by copying `dcs/Scripts/Hooks/dcs-map-server.lua` into
`Saved Games\DCS\Scripts\Hooks\`.

### Why HTTPS on a LAN

Not for confidentiality — that is secondary on a home network — but because the Screen Wake Lock
API requires a secure context. Over `http://<LAN-IP>` there is none, and a tablet whose display
sleeps mid-flight is useless. `tools/make-cert.sh` puts the LAN IP into the `subjectAltName`;
iOS and Android check only that, never the common name.

### Running without DCS

Check the hook against mocked export APIs:

```bash
lua dcs/test/hook_harness.lua 300 optview_all 150
```

Synthetic telemetry:

```bash
python3 tools/generate_telemetry.py --send
```

A real recording — DCS/Tacview writes one after every flight:

```bash
python3 tools/acmi_to_telemetry.py flight.zip.acmi --list   # show objects
python3 tools/acmi_to_telemetry.py flight.zip.acmi --send
```

## Controls

| Input | Effect |
|---|---|
| `+` / `−`, wheel, pinch | Step through range scales |
| `5` `20` `50` `160` | Jump to a range scale |
| `HDG / N` | Heading up or north up |
| `⚙` | Settings (stored in the browser) |
| Tap a contact | BRAA readout: bearing, range, altitude, aspect |
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

## Layout

```
src/shared/types.ts      Wire format between server and client
src/server/protocol.ts   Parser for the DCS hook's UDP format
src/server/classify.ts   Sorting objects into presentation categories
src/server/threats.ts    Engagement ranges of air defence systems
src/server/world.ts      World state, delta building, fog of war
src/server/ingest.ts     UDP socket
src/server/index.ts      Fastify + WebSocket + tick
src/client/track.ts      Dead reckoning and interpolation buffer
src/client/style.ts      Map style: elevation tints, shading, vector layers
src/client/symbols/      Contact symbols, drawn at runtime (nato.ts, dcs.ts)
src/client/main.ts       MapLibre, render loop, HUD
dcs/Scripts/Hooks/       DCS export hook (Lua)
dcs/test/                Harness driving the hook against mocked DCS APIs
tools/                   Telemetry generator and ACMI converter
```

## Contributing

Two things are not negotiable:

1. **Fog of war is filtered server-side.** Client-side filtering would be defeated with the
   developer tools in seconds, and the project would become a cheat tool.
2. **Only ODbL and public domain data sources.** No third-party tile servers without an
   agreement, no keys in the repository, no NC-licensed data in what ships.

## License

Code is MIT licensed, see [LICENSE](LICENSE).

Map data © OpenStreetMap contributors (ODbL). Terrain from the AWS Terrain Tiles
(SRTM/GMTED, public domain). Glyphs and sprites from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets).

Fetched tiles and glyphs are deliberately kept out of version control: vector tiles are a
derivative database in the sense of the ODbL, so they are fetched by script rather than
redistributed here. Anyone publishing prebuilt tiles takes on the ODbL share-alike obligations.

This project is not affiliated with or endorsed by Eagle Dynamics.
