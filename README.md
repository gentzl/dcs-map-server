# dcs-map-server

A live moving map for DCS World — see your aircraft and everything around it on your phone,
tablet, or a second screen while you fly, the same way a car GPS shows where you are.

It runs once, on the same PC where DCS is installed. Every other device just opens a web page —
nothing to install on the tablet, no app store, no account, no internet connection needed. It all
stays on your own home network.

![How it works: the DCS PC reads your flight, the map server turns it into a live map, any screen on your Wi-Fi can open it](docs/overview.svg)

## Setting it up

You'll need [Node.js](https://nodejs.org) installed on the DCS PC (version 22 or newer). Everything
else below is copy-paste into a terminal, in the folder you downloaded this project into.

1. Install and prepare the map data (one-time, a couple of minutes):

   ```bash
   npm install
   cp node_modules/maplibre-gl/dist/maplibre-gl.css public/
   ./tools/fetch-map-assets.sh      # map labels and symbols, ~2.3 MB
   ./tools/fetch-tiles.sh caucasus  # the map itself, ~131 MB — swap in another theater if you fly elsewhere
   ```

2. Copy `dcs/Scripts/Hooks/dcs-map-server.lua` into `Saved Games\DCS\Scripts\Hooks\` and (re)start DCS.
   That's the only change made to your DCS install.

3. Start the server:

   ```bash
   npm run dev
   ```

4. Open the web address it prints. On the DCS PC itself that's `http://localhost:8080`. From a
   phone or tablet on the same Wi-Fi, use one of the other two addresses instead — a number like
   `http://192.168.1.23:8080`, or a name like `http://DESKTOP-ABC123.local:8080` (easier to type,
   and keeps working even if the number changes later). Can't see the terminal window anymore? On
   the DCS PC, run `ipconfig` (Windows) and look for "IPv4 Address" — that's the number. Start or
   join a flight in DCS and the map comes alive.

That's the whole setup. Want it reachable with a tablet's screen staying awake, a different map
theater, what every setting does, or how to troubleshoot a blank map? → **[Full documentation](docs/REFERENCE.md)**

## License

Code is MIT licensed, see [LICENSE](LICENSE). Map and terrain data are open (OpenStreetMap/ODbL,
public-domain terrain) — see the [full documentation](docs/REFERENCE.md#license) for the details
and attribution. This project is not affiliated with or endorsed by Eagle Dynamics.
