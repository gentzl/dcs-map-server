# Handbook

Everything you can do with the map once it's running: what you're looking at, how to
control it, what every setting does, and what to try when something doesn't look right.

Getting it installed and started in the first place is the [README](../README.md). If you want to
know how it works inside, change the code, or run it without DCS, that's the
[technical guide](DEVELOPERS.md).

- [Opening the map on a tablet or phone](#opening-the-map-on-a-tablet-or-phone)
- [Choosing your theater](#choosing-your-theater)
- [What's on the map](#whats-on-the-map)
- [Controls](#controls)
- [Settings](#settings)
- [When something looks wrong](#when-something-looks-wrong)

## Opening the map on a tablet or phone

The server runs on the DCS PC and prints its web addresses when it starts. On the DCS PC itself,
open `http://localhost:8080`. From any other device on the same Wi-Fi, use one of the other
addresses it lists instead:

- a number like `http://192.168.1.23:8080` — always works, but can change when your router hands
  out new addresses
- a name like `http://DESKTOP-ABC123.local:8080` — easier to type and survives that change

Nothing gets installed on the tablet. It's a web page.

**Keeping the screen awake.** A tablet whose display sleeps halfway through a flight is useless.
The map asks the browser to keep the screen on, but browsers only allow that over a secure
connection. If you've set up a certificate (see the [technical guide](DEVELOPERS.md#https-on-a-lan)),
open the `https://` address instead and the screen stays lit. Your browser will warn you that it
doesn't recognise the certificate — that's expected for a certificate you made yourself on your
own network. Accept it once and the warning is gone.

Without a certificate everything else still works; only the stay-awake feature is unavailable.

## Choosing your theater

The map itself is ordinary OpenStreetMap material — the same roads, towns and rivers any map of
that part of the world shows. A "theater" here is just the patch of the world the DCS map of that
name sits on.

`start.bat` works out which maps you own straight from your DCS installation and downloads tiles
for each one, every time it runs — so a map you buy later just shows up the next time you
double-click it, nothing to redo by hand.

If it can't tell automatically (an unusual install setup), it asks once instead, and
**`configure-maps.bat`** lets you change that answer any time. Every run writes exactly what it
checked and found to **`setup.log`** next to `start.bat` — if map detection looks wrong, that file
is the first thing to check (or to send along when asking for help).

Available: `caucasus`, `syria`, `persiangulf`, `sinai`, `normandy`, `marianas`, `kola`, `iraq`,
`afghanistan` — each one roughly 100–150 MB on disk. If you own more than one, switch between the
ones you've downloaded in the settings panel.

If the map is blank but your aircraft symbol moves correctly, the tiles for the theater you're
flying in haven't been fetched yet, or the settings panel is pointed at a different one.

## What's on the map

**The map itself** is an aeronautical chart: terrain tinted by elevation, hill shading, a
latitude/longitude graticule with labels, emphasised runways, and spot elevations in feet. There's
a dimmed night presentation for flying after dark.

**Your aircraft** sits at the centre in follow mode, pointing the way you're heading.

**Other contacts** are drawn with proper military symbology. Two symbol sets are available:

- *NATO* (the default) is based on APP-6 / MIL-STD-2525. Close to the standard, but not strictly
  conforming: the frames are filled here where the standard leaves them open, because a tinted
  outline is unreadable over cluttered terrain at arm's length. The frame tells you who and where:
  a rectangle is friendly, a diamond is hostile, a frame open at the bottom means airborne. The
  icon inside tells you what: an air screw, rotor blades, tank treads, a protective dome for air
  defence, a hull for ships. Where the shape can't say it, a letter does — `C` transport,
  `K` tanker, `W` AWACS, `CV` carrier. Friend and hostile are relative to *you* — your own
  coalition is always the friendly shape, whichever side you're flying.
- *DCS* approximates the game's own F10 map. Shape carries the domain, content carries the type: a
  shield with a role letter for aircraft (`F` fighter, `C` transport, `K` tanker, `W` AWACS,
  `H` helicopter), a rectangle with a pictogram for ground units, a circle with a code for vessels
  (`CC`, `CV`, `SS`). Colour follows the coalition rather than your point of view — blue stays
  blue even when you're flying red.

A legend of every symbol sits in the settings panel under *Symbols*.

**Range rings** are drawn around your aircraft with bearing ticks, so you can judge distance at a
glance. Only the one or two rings that are actually useful at your current range are shown.

**Threat rings** mark how far air defence systems can reach, sized per system type and drawn to
follow the curve of the earth. By default only the opposing side's are shown — a friendly PATRIOT
site covers half the map at 100 km without telling you anything you need in flight.

**The bullseye** is a reference point everyone on the radio calls distances from. DCS's export
doesn't provide the mission's bullseye, so you place it yourself: shift-click where it belongs.

**A short line ahead of each aircraft** shows where it will be in a minute — long for something
fast, short for something slow. It's there so you can read the geometry of the whole picture at a
glance: who's converging on whom, who's running. Only aircraft get one; a stub on every parked
truck would bury what it's meant to show.

**Tapping a contact** draws a line to it and shows the full readout: affiliation, category,
coordinates, bearing and range from you, the contact's own bullseye position, altitude, aspect,
ground speed, closure and the time that leaves. It stays up until you tap that same contact again
— a stray tap anywhere else never drops it, and instead just shows the coordinates there, next to
where you tapped, alongside it. Aspect tells you where it's pointing relative to you — `HOT`
straight at you, `FLANK`, `BEAM`, `DRAG`, `COLD` straight away. Closure is how fast the gap is
actually shutting, which is not the same as how fast either of you is flying: forty miles is two
and a half minutes head-on and never at all behind someone faster than you.

**Double-tapping open ground** draws the same line and readout to that fixed point instead of a
contact — for a rally point, a run-in heading, or anywhere you just want bearing, range, bullseye
position and time to get there without waiting for something to fly past it. It has no altitude,
aspect or speed of its own, since it isn't moving. Tapping a contact afterward replaces it, the
same as switching between two contacts.

Altitudes for aircraft are in thousands of feet — `31.9` is thirty-one thousand nine hundred, the
way it goes over the radio. Things on the ground keep plain feet.

Everything is in cockpit units: distances in nautical miles, altitude in feet or as a flight
level, speed in knots, coordinates in degrees and decimal minutes, bearings magnetic.

## Controls

| Input | Effect |
|---|---|
| `1` `5` `10` `20` `50` `80` `160` | Range scale in nautical miles |
| Wheel, pinch | Stepless zoom |
| Click/touch and drag, or arrow keys | Pan the map, switches to FREE |
| `CTR / FREE` | Follow the aircraft, or pan the map freely |
| `HDG / N` | Heading up or north up (follow mode only) |
| `MEAS` | Measure between two points: tap the start, tap the end |
| `⚙` | Settings |
| Tap empty ground | Coordinates at that point |
| Tap a contact | Line and readout to it, coordinates included |
| Double-tap empty ground | Line and readout (bearing, range, bullseye, time) to that fixed point |
| `⚙` → Symbols | Legend of all contact symbols |
| Shift + click, or press and hold | Place the bullseye |

`MEAS` is for the questions the contact readout can't answer — how far your ingress leg is, how
wide you have to go round a SAM, whether a divert field is reachable. Tap it, tap two points, and
you get the bearing, the distance, and how long it takes at your current speed. Tap two more
points to measure something else, or press `MEAS` again to clear it.

The range buttons follow the scaling of the Hornet's and Viper's HSI/HSD displays, so a press
gives you a known distance rather than just some zoom level. "20 NM" covers the same real distance
on a phone as on a monitor. Pinch and wheel are there for fine adjustment, and they never fight
the range buttons or snap the view away from where you're looking.

## Settings

Open with `⚙`. Settings are stored in the browser, per device — your tablet and your second
monitor can be set up differently.

| Setting | Options | What it does |
|---|---|---|
| Symbols | NATO / DCS | Which symbol set contacts are drawn with |
| Presentation | Chart / Night | Light aeronautical chart, or dimmed for night flying |
| Elevation tint | on / off | Terrain coloured by height |
| Relief | on / off, strength | Hill shading. Stronger shows more terrain but washes out the tints |
| Range rings | on / off | Distance rings around your aircraft |
| Threat rings | Hostile / All / None | Air defence engagement ranges |
| Graticule | on / off | Latitude/longitude grid with labels |
| Bullseye | on / off | The reference point and its readout |
| Bearings | Magnetic / True | Magnetic is what you call on the radio; true is for map work |
| Place names | on / off | Town and feature labels from the map data |
| Contact labels | on / off | Name and altitude beside every contact — quickly too much in a busy
mission |
| Contacts | All / Air only / None | Which contacts are drawn at all |
| Theater | per fetched theater | Which map you're looking at |

## When something looks wrong

### My aircraft shows, but no other contacts

The mission is withholding them. This is normal and not a fault of the display: DCS lets a mission
restrict what the map may show, and two of those settings suppress every other unit.

You'll see a banner reading `CONTACTS WITHHELD BY MISSION`, and the settings panel shows which
setting the mission reported.

The setting belongs to the mission, not to this tool:

- **Single player** — the mission's own difficulty options, or your gameplay settings where the
  mission doesn't force them.
- **Multiplayer** — the server decides, and you can't change it.

Filtering happens on the server here by design: doing it in the browser would make this a cheat
tool, since anyone could switch it off with the developer tools.

On a multiplayer server it can also mean that `allow_object_export` is switched off in *that
server's* configuration — again, not something you can change unless you run the server yourself.

### The map is blank, but my aircraft moves

The tiles for this theater haven't been downloaded, or the settings panel is set to a different
theater. See [Choosing your theater](#choosing-your-theater).

### Nothing appears at all

Check, in order:

1. Is the hook installed? `dcs/Scripts/Hooks/dcs-map-server.lua` has to be in
   `Saved Games\DCS\Scripts\Hooks\`, and DCS has to have been restarted since you put it there.
2. Is the server running, and does the page load at all? Its own console window shows a colored
   line for this: green `Hook connected` once DCS is sending data, yellow `Hook not connected`
   while it's waiting.
3. Are you in a flight? The map comes alive when a mission starts.

The hook writes its status to `Saved Games/DCS/Logs/dcs.log` every ten seconds, which tells you
whether it's running and how many objects it's seeing:

```
[map-server] optionsView=optview_all  objects=245  sent=244
```

If that line never appears, the hook isn't loaded. If it appears with `objects=0`, DCS isn't
handing out any — see the first question above.

### The tablet can't reach the address

Both devices have to be on the same network, and the PC's firewall has to allow the connection.
If you can't see the terminal window with the address any more, run `ipconfig` on the DCS PC and
look for "IPv4 Address".

Anything beyond this is in the [technical guide](DEVELOPERS.md).
