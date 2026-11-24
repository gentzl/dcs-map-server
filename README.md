# dcs-map-server

A live map for DCS World — see your aircraft and everything around it on your phone,
tablet, or a second screen while you fly, the same way a car GPS shows where you are.

It runs once, on the same PC where DCS is installed. Every other device just opens a web page —
nothing to install on the tablet, no app store, no account, no internet connection needed. It all
stays on your own home network.

![How it works: the DCS PC reads your flight, the map server turns it into a live map, any screen on your Wi-Fi can open it](docs/overview.svg)

![The map in flight: NATO contact symbols, a BRA line and readout to a selected contact, range rings, and terrain shading](docs/screenshot.jpg)

## Setting it up

1. Download this project — the green **Code → Download ZIP** button on GitHub — and unzip it.
2. **Double-click `start.bat`.**

That's it. It downloads its own copy of Node.js, installs everything, asks which theater you fly
and downloads its map tiles, installs the DCS hook, and starts the server — nothing else to
install, nothing to put on `PATH`, no terminal commands to type. (Nothing it downloads touches the
rest of your system — it all stays inside this project's own folder.) Next time, just double-click
it again — it asks the theater question once more, but skips every download it's already done.

Open the web address it prints — `http://localhost:8080` on the DCS PC itself, one of the other
two from a phone or tablet on the same Wi-Fi. Start or join a flight in DCS and the map comes
alive.

## Documentation

- **[Handbook](docs/MANUAL.md)** — using it: the controls, keeping a tablet's screen awake, other
  theaters, troubleshooting a blank map.
- **[Technical guide](docs/DEVELOPERS.md)** — architecture, wire protocol, running it without DCS,
  the [manual setup](docs/DEVELOPERS.md#manual-setup) for development, changing the code.

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
