# DCS Map Server

A live map for DCS World — see your aircraft and everything around it on your phone,
tablet, or a second screen while you fly.

It runs once, on the same PC where DCS is installed. Every other device just opens a web page —
nothing to install on the tablet, no app store, no account. Your flight data stays on your own
home network; only the terrain shading is loaded from the internet while the map is open.

![DCS Map Server on a phone, a tablet and a second phone: contacts and air defence sites, flight data with airfield info and bearing and range, night mode heading up](docs/screenshot.jpg)

![How it works: the DCS PC reads your flight, the map server turns it into a live map, any screen on your Wi-Fi can open it](docs/overview.svg)

## What's on the map

- **Your aircraft** on an aeronautical chart with terrain, range rings, bullseye and the mission
  clock — north up or heading up.
- **Other units** in military symbology, with air-defence threat rings. Human players are marked
  with a small dot; tap any contact for bearing, range, altitude, aspect and closure.
- **DCS's own airfields** with tower frequencies and navaids, and the **mission's zones** (FOBs,
  objectives, sectors) as on the F10 map.
- **Your flight plan**: the fixed waypoints from the mission editor, or the route your aircraft
  reports. Waypoints entered in the cockpit (e.g. F-16C steerpoints) and dynamic-spawn slots
  aren't available — DCS doesn't hand them out.
- **Measure and coordinate tools**, and a search for zones and airfields.

The map only ever shows what the server's own rules allow — it is no way around fog of war.

## Setting it up

1. Download this project — the green **Code → Download ZIP** button on GitHub — and unzip it.
2. **Double-click `start.bat`.**

That's it. It works out which DCS maps you own by itself and sets everything up.

**Open the web address it prints:** `http://localhost:8080` on the DCS PC itself. From a phone or
tablet on the same Wi-Fi, use one of the other addresses it lists instead — something like
`http://192.168.1.23:8080` or `http://<your-pc-name>.local:8080`. Start or join a flight in DCS and
the map comes alive.

**Updating?** Download the new version and double-click `start.bat` again. It replaces the DCS
hook with the new one (keeping the old as `.bak`); restart DCS once so it loads it.

**Joining a multiplayer server?** Some servers don't let any outside program see the other units —
then the map shows only your own aircraft and says so at the top (*server blocks other units*).
That's the server's setting, not a fault; the [handbook](docs/MANUAL.md#my-aircraft-shows-but-no-other-contacts)
has the details.

## Documentation

- **[Handbook](docs/MANUAL.md)** — using it: the controls, keeping a tablet's screen awake, other
  theaters, troubleshooting a blank map.
- **[Technical guide](docs/DEVELOPERS.md)** — architecture, wire protocol, running it without DCS,
  the [manual setup](docs/DEVELOPERS.md#manual-setup) for development, changing the code, and
  [where the map data comes from](docs/DEVELOPERS.md#where-the-map-comes-from).

## Contributing

Bug reports and suggestions are welcome as
[issues](https://github.com/gentzl/dcs-map-server/issues), changes as pull requests. The
[technical guide](docs/DEVELOPERS.md#contributing) describes what to check before submitting a
change.

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
