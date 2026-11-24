# dcs-map-server

A live map for DCS World — see your aircraft and everything around it on your phone,
tablet, or a second screen while you fly, the same way a car GPS shows where you are.

It runs once, on the same PC where DCS is installed. Every other device just opens a web page —
nothing to install on the tablet, no app store, no account, no internet connection needed. It all
stays on your own home network.

![How it works: the DCS PC reads your flight, the map server turns it into a live map, any screen on your Wi-Fi can open it](docs/overview.svg)

![The map in flight: NATO contact symbols, a BRA line and readout to a selected contact, range rings, and terrain shading](docs/screenshot.jpg)

- **[Handbook](docs/MANUAL.md)** — what's on the map, the controls, the settings, troubleshooting.
- **[Technical guide](docs/DEVELOPERS.md)** — architecture, wire protocol, running it without DCS,
  changing the code.

## Setting it up

### On Windows

Download this project (the green **Code → Download ZIP** button on GitHub, or `git clone`), unzip
it if needed, and double-click **`start.bat`**. It downloads its own copy of Node.js, installs
everything, asks which theater you fly and downloads its map tiles, installs the DCS hook, and
starts the server — nothing else to install, nothing to put on `PATH`, no terminal commands to
type. It asks for the theater again on your next double-click too, but skips every download it's
already done. (Nothing it downloads touches the rest of your system — it all stays inside this
project's own folder.)

### Or, if you'd rather run the steps yourself

You'll need [Node.js](https://nodejs.org) installed on the DCS PC (version 22 or newer). Everything
else below is copy-paste into a terminal, in the folder you downloaded this project into — the same
commands work in PowerShell or cmd.exe.

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
   project's own `runtime/` folder — no Homebrew, no manual download, nothing to put on `PATH`.

   `install-hook` copies `dcs/Scripts/Hooks/dcs-map-server.lua` into every DCS installation it finds
   under `Saved Games\` (stable and open beta). It never overwrites a hook file that's already
   there, so it's always safe to re-run; if you'd rather do it by hand, or it doesn't find your DCS
   install, just copy that file into `Saved Games\DCS\Scripts\Hooks\` yourself.

2. (Re)start DCS, so it picks up the hook.

3. Start the server:

   ```bash
   npm run dev
   ```

4. Open the web address it prints — `http://localhost:8080` on the DCS PC itself, one of the
   other two from a phone or tablet on the same Wi-Fi. Start or join a flight in DCS and the map
   comes alive.

That's the whole setup. From here, the [handbook](docs/MANUAL.md) covers using it — the controls,
keeping a tablet's screen awake, other theaters, and what to try when the map stays blank.

## Contributing

Clone it, fly with it, break it. Bugs, rough edges and ideas are all welcome as
[issues](https://github.com/gentzl/dcs-map-server/issues), and pull requests just as much.
Contacts drawn with the wrong symbol are worth reporting in particular: the map recognises units
by their DCS type name, and nobody flies every asset pack there is. The
[technical guide](docs/DEVELOPERS.md#contributing) has what to know before sending a change.

## Credits

Built on [MapLibre GL JS](https://maplibre.org/) for the map, [Protomaps](https://protomaps.com/)'
[PMTiles](https://github.com/protomaps/PMTiles) format, planet builds and
[go-pmtiles](https://github.com/protomaps/go-pmtiles) for the tiles themselves, and
[Fastify](https://fastify.dev/)/[ws](https://github.com/websockets/ws) for the server. Map data is
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL); terrain is
public-domain SRTM/GMTED. Full attribution and licenses in the
[technical guide](docs/DEVELOPERS.md#license-and-data-sources).

## License

Code is MIT licensed, see [LICENSE](LICENSE). Map and terrain data are open (OpenStreetMap/ODbL,
public-domain terrain) — see the [technical guide](docs/DEVELOPERS.md#license-and-data-sources)
for the details and attribution. This project is not affiliated with or endorsed by Eagle Dynamics.
