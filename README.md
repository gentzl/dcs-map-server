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

You'll need [Node.js](https://nodejs.org) installed on the DCS PC (version 22 or newer). Everything
else below is copy-paste into a terminal, in the folder you downloaded this project into.

1. Install and prepare the map data (one-time, a couple of minutes):

   ```bash
   npm install
   cp node_modules/maplibre-gl/dist/maplibre-gl.css public/  # Windows: run this line in PowerShell, not cmd.exe
   ./tools/fetch-map-assets.sh      # map labels and symbols, ~2.3 MB
   ./tools/fetch-tiles.sh caucasus  # the map itself, ~131 MB — swap in another theater if you fly elsewhere
   ```

2. Copy `dcs/Scripts/Hooks/dcs-map-server.lua` into `Saved Games\DCS\Scripts\Hooks\` and (re)start DCS.
   That's the only change made to your DCS install.

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

## License

Code is MIT licensed, see [LICENSE](LICENSE). Map and terrain data are open (OpenStreetMap/ODbL,
public-domain terrain) — see the [technical guide](docs/DEVELOPERS.md#license-and-data-sources)
for the details and attribution. This project is not affiliated with or endorsed by Eagle Dynamics.
