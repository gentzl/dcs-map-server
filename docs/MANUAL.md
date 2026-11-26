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
name sits on. The airfields are the exception: once you're in a flight, their symbols and names
come straight from DCS — a disc with the runway across it, turned to the runway's direction. Blue
or red when DCS reports the field as held by that side; grey when it doesn't say, which means
"unknown", not "neutral" — missions that change hands by script don't always pass that on.

`start.bat` works out which maps you own straight from your DCS installation and downloads tiles
for each one, every time it runs — so a map you buy later just shows up the next time you
double-click it, nothing to redo by hand.

If it can't find DCS by itself (for example because DCS has never been started on this PC), it
asks once for the folder DCS is installed in (the one containing `bin\DCS.exe`) and remembers it.
If you skip that, it asks which maps you own instead, and **`configure-maps.bat`** lets you change
that answer any time. Every run writes exactly what it
checked and found to **`setup.log`** next to `start.bat` — if map detection looks wrong, that file
is the first thing to check (or to send along when asking for help).

Available: `caucasus`, `syria`, `persiangulf`, `sinai`, `normandy`, `marianas`, `kola`, `iraq`,
`afghanistan` — each one roughly 100–150 MB on disk. The map switches to the theater your aircraft
is in by itself. Picking one by hand in the menu holds until you fly into another one.

If the map is blank but your aircraft symbol moves correctly, the tiles for the theater you're
flying in haven't been fetched yet.

## What's on the map

**The map itself** is an aeronautical chart: terrain tinted by elevation, hill shading, a
latitude/longitude graticule with labels, emphasised runways, and spot elevations in feet. There's
a dimmed night presentation for flying after dark.

**Your aircraft** sits at the centre in follow mode, pointing the way you're heading.

**The status bar** along the top reads, left to right: the mission's clock time — the same as on
the F10 map — with a dot that's filled while connected; your position; altitude; true airspeed;
heading; wind; bearing and range from the bullseye to you; and the range the map currently shows.
If the clock reads `--:--:--`, your hook is older than the map, see
[Nothing appears at all](#nothing-appears-at-all).

**Airfields** are DCS's own, with their names (see [Choosing your theater](#choosing-your-theater)
for the colours). Tap one for its frequencies — see below.

**Mission zones** are the areas the mission defines, drawn the way the F10 map shows them. Only
the main zone of each objective is shown, not the numbered parts and spawn points around it.
There are three kinds:

- **Objectives** — towns, FOBs, Alpha to Kilo: a red area with the name in red behind a ★.
- **Airfield zones** — named like an airfield: blue when DCS reports that airfield as blue,
  otherwise red.
- **Sectors** — the large areas, such as ship and patrol sectors (anything over 10 km across):
  pale, with a thin edge and no star, never red.

Who actually holds an objective isn't known to the map: missions keep that in their own scripts,
which a player's PC can't read. So objectives are red whoever holds them — where F10 shows one
blue, the map doesn't. Switch zones off in the menu if a mission has too many.

Zones and airfields may take a moment to appear. DCS sends the zones when you get into your
aircraft and then only every five minutes, the airfields every minute. If the map server was
started — or restarted — after you jumped in, the zones show up within five minutes, the airfields
within one.

**Your flight plan** is drawn as a dashed magenta line through your waypoints, numbered from 0 like
in the mission editor, with the mission builder's names (`IP`, `TGT` …) where there are any. When
your aircraft reports which waypoint it is flying to, that one is a filled dot and the top bar
shows bearing and distance to it, e.g. `WP1 074M/19`. It appears within five seconds of getting
into your aircraft.

Only **fixed waypoints** reach the map — the ones DCS hands out:

- **The route from the mission editor** for your flight. That works in a slot the mission builder
  placed, in single player and in multiplayer.
- **The route your aircraft itself reports**, which only some aircraft do (mostly the simpler,
  FC3-style ones).

**Not shown**, because DCS doesn't hand them to outside programs:

- **Waypoints you enter or change in the cockpit**, for example steerpoints in the F-16C, and
  routes drawn with the F10 route tool. Aircraft with their own navigation computer, such as the
  F-16C, keep them to themselves (checked with the F-16C; other aircraft not yet).
- **Dynamic-spawn slots** — slots the server creates on the fly instead of placing them in the
  mission editor. They have no route in the mission, so the map shows none.

Switch the flight plan off in the menu under **Overlays → Flight plan**.

**Other contacts** are drawn with proper military symbology. Two symbol sets are available:

- *NATO* (the default) is based on APP-6 / MIL-STD-2525. Close to the standard, but not strictly
  conforming: the frames are filled here where the standard leaves them open, because a tinted
  outline is unreadable over cluttered terrain at arm's length. The frame tells you who and where:
  a rectangle is friendly, a diamond is hostile, a frame open at the bottom means airborne (hostile
  aircraft keep the closed diamond; the icon shows they fly). The icon inside tells you what: a
  rounded bow tie for fixed-wing aircraft, an angular one for helicopters, tank treads, a protective dome for air
  defence, a hull for ships. Where the shape can't say it, a letter does — `C` transport,
  `K` tanker, `W` AWACS, `CV` carrier. Friend and hostile are relative to *you* — your own
  coalition is always the friendly shape, whichever side you're flying.
- *DCS* approximates the game's own F10 map. Shape carries the domain, content carries the type: a
  shield with a role letter for aircraft (`F` fighter, `C` transport, `K` tanker, `W` AWACS,
  `H` helicopter), a rectangle with a pictogram for ground units, a circle with a code for vessels
  (`CC`, `CV`, `SS`). Colour follows the coalition rather than your point of view — blue stays
  blue even when you're flying red.

A legend of every symbol sits in the menu under *Symbols*.

**Range rings** are drawn around your aircraft with bearing ticks, so you can judge distance at a
glance. Only the one or two rings that are actually useful at your current range are shown.

**Threat rings** mark how far air defence systems can reach, sized per system type and drawn to
follow the curve of the earth. By default only the opposing side's are shown — a friendly PATRIOT
site covers half the map at 100 km without telling you anything you need in flight.

**The bullseye** is a reference point everyone on the radio calls distances from. DCS's export
doesn't provide the mission's bullseye, so you place it yourself: shift-click where it belongs.

**A short line ahead of each aircraft** shows where it will be in half a minute — long for
something fast, short for something slow, and never more than about one and a half symbol widths
on screen. It's there so you can read the geometry of the whole picture at a
glance: who's converging on whom, who's running. Only aircraft get one; a stub on every parked
truck would bury what it's meant to show.

**Human players** have a small dot at the top right of their symbol; AI has none. Tap one and the readout
names the player, e.g. `Olli (F-16C_50)`. This only marks contacts the map shows anyway — it
never reveals a unit the server hides. It needs the current hook; with an older one nobody gets a
dot.

**Tapping a contact** draws a line to it and shows the full readout: affiliation, category,
coordinates, bearing and range from you, the contact's own bullseye position, altitude, aspect,
ground speed, closure and the time that leaves. It stays up until you tap that same contact again
— a stray tap anywhere else never drops it. Aspect tells you where it's pointing relative to you — `HOT`
straight at you, `FLANK`, `BEAM`, `DRAG`, `COLD` straight away. On a large monitor the readout
is laid out as a small table in the order it goes over the radio — bearing and range, altitude and
aspect, then speed, closure, time and bullseye; on a phone it stays a single wrapping line. Closure is how fast the gap is
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
| `1` `5` `10` `20` `50` `80` `160` | Jump straight to that range, in nautical miles |
| `−` `+` | Zoom out or in by half or double the range, past 1 and 160 nm too |
| Wheel, pinch | Stepless zoom |
| Click/touch and drag, or arrow keys | Pan the map, switches to FREE |
| `CTR / FREE` | Follow the aircraft (the default), or pan the map freely |
| `HDG / N` | Heading up, or north up (the default); follow mode only |
| `☰ MENU` | Find, tools and settings |
| `MENU` → Find | Type part of a name — `FOB`, `Damascus`, `Alpha` — and pick a hit (or press Enter for the first): the map jumps there and selects it, line and readout included. `CTR` brings you back to your aircraft |
| `MENU` → Tools → Measure | Measure between two points: tap the start, tap the end |
| `MENU` → Tools → Coordinates | Each tap shows coordinates there, plus bearing and range from you and from bullseye |
| `MENU` → Tools → Off, or `Esc` | Back to normal taps |
| Tap a contact | Line and readout to it, coordinates included |
| Tap an airfield | Line to it and its data: elevation, runway, tower frequencies, navaids; tap again to drop it |
| Tap a mission zone | Line and readout to its centre, named; tap again to drop it (the large sectors can't be tapped) |
| Double-tap empty ground | Line and readout (bearing, range, bullseye, time) to that fixed point |
| `MENU` → Symbols | Legend of all contact symbols |
| Shift + click, or press and hold | Place the bullseye |

The tools at the top of the menu take over a tap on the map. Only one is active at a time; picking
one closes the menu, and the button turns yellow and shows which tool is on (`☰ MEAS`,
`☰ COORD`), so you know why a tap isn't selecting a contact. With no tool active, a tap on empty
ground does nothing.

**Tapping an airfield** draws the line to it and shows the rows of DCS's own F10 airfield window,
as far as there is data for them — a row with nothing in it is left out:

```
KRASNODAR-CENTER
BRAA 303M / 76.9 nm   BULLS 313M/233   Vc 320   T 14.4 min
COALITION    NEUTRAL
ELEVATION    98 ft
COORDINATES  N45°05.100' E038°55.500'
RSBN         ch 40 (MB)
ATC (MHz AM) 3.800, 38.600, 122.000, 251.000
RUNWAYS      081°M           261°M
PRMG         ch 38 (MB)      --
OUTER NDB    625 (MB)        625 (OC)
INNER NDB    303 (M)         303 (O)
```

Approach aids (ILS, PRMG, outer and inner NDB) sit in the column of the runway direction they
serve, like on F10. Runways are given as their two magnetic headings rather than runway numbers,
since DCS's runway names don't always follow from the heading. F10's ICAO code and runway length
aren't shown: they're in none of the files the map can read. Frequencies come from your own DCS install, read when
`start.bat` runs; they're the map's fixed ones, so a mission's own extras (a tanker's TACAN, say)
aren't among them. An airfield wins over anything parked on it; only something flying over it is
picked instead.

**Measure** is for the questions the contact readout can't answer — how far your ingress leg is,
how wide you have to go round a SAM, whether a divert field is reachable. Tap two points, and you
get the bearing, the distance, and how long it takes at your current speed. Tap two more points to
measure something else, or switch the tool off to clear it.

**Coordinates** shows, wherever you tap, the coordinates of that spot and the bearing and range to
it from your aircraft and from the bullseye — for reading a position off the map, or passing one
on over the radio.

The range buttons follow the scaling of the Hornet's and Viper's HSI/HSD displays, so a press
gives you a known distance rather than just some zoom level. "20 NM" covers the same real distance
on a phone as on a monitor. Pinch and wheel are there for fine adjustment, and they never fight
the range buttons or snap the view away from where you're looking.

## Settings

Open with `☰ MENU`; they sit below the tools. Settings are stored in the browser, per device —
and so are the map's orientation (`HDG / N`) and range, so it opens the way you left it. Only
`CTR / FREE` always starts at `CTR`, on your aircraft, and no tool is active after a reload.
Your tablet and your second monitor can be set up differently.

| Setting | Options | What it does |
|---|---|---|
| **Display** → Mode | Aero chart / Night | Light aeronautical chart, or dimmed for night flying |
| Elevation tint | on / off | Terrain coloured by height |
| Terrain shading | on / off | Hill shading |
| Relief strength | slider | Stronger shows more terrain but washes out the tints |
| Place names | on / off | Town and feature labels, airfield and zone names |
| **Overlays** → Range rings | on / off | Distance rings around your aircraft |
| Threat rings | hostile only / all / off | Air defence engagement ranges |
| Lat/Lon grid | on / off | Latitude/longitude grid with labels |
| Bullseye | on / off | The reference point and its readout |
| Mission zones | on / off | The mission's objective zones, see [What's on the map](#whats-on-the-map) |
| Flight plan | on / off | Your own fixed waypoints, see [What's on the map](#whats-on-the-map) |
| **Tactical** → Contacts | all / air only / none | Which contacts are drawn at all |
| Contact labels | on / off | Name and altitude beside every contact — quickly too much in a busy mission |
| Bearings | magnetic / true | Magnetic is what you call on the radio; true is for map work |
| **Theater** → Map | per fetched theater | Which map you're looking at; follows your aircraft by itself |
| **Symbols** → Symbol set | NATO APP-6 / DCS style | Which symbol set contacts are drawn with, and the legend |

## When something looks wrong

### My aircraft shows, but no other contacts

There are two possible causes, each with its own banner at the top of the map. If it reads
`CONTACTS WITHHELD BY MISSION`, the mission is withholding them. This is normal and not a fault of the display: DCS lets a mission
restrict what the map may show, and two of those settings suppress every other unit.

You'll see a banner reading `CONTACTS WITHHELD BY MISSION`, and the bottom of the menu shows which
setting the mission reported.

The setting belongs to the mission, not to this tool:

- **Single player** — the mission's own difficulty options, or your gameplay settings where the
  mission doesn't force them.
- **Multiplayer** — the server decides, and you can't change it.

Filtering happens on the server here by design: doing it in the browser would make this a cheat
tool, since anyone could switch it off with the developer tools.

**A banner reading `SERVER BLOCKS OTHER UNITS (object export disabled)`** means something else:
the *server* doesn't hand DCS's list of objects to outside programs at all. Many busy multiplayer
servers do this on purpose, so that no tool can show where the enemy is. Then no other unit
arrives — friend or foe, whatever the mission's view — and the airfields, which come through the
same list, are missing too. Your own aircraft, the mission clock and the mission's zones still
work, because DCS gives those out separately. F10 inside the game isn't affected, since it's part
of the game itself.

It's the server's `allow_object_export` setting, switched off in *that server's* configuration,
so only whoever runs the server can change it. If you run it yourself, set it to `true`. On
someone else's server there's nothing to do on your side — try a server that allows it.

### The map is blank, but my aircraft moves

The tiles for this theater haven't been downloaded, or a theater picked by hand in the menu doesn't
match where you fly. See [Choosing your theater](#choosing-your-theater).

### Nothing appears at all

Check, in order:

1. Is the hook installed? `dcs/Scripts/Hooks/dcs-map-server.lua` has to be in
   `Saved Games\DCS\Scripts\Hooks\`, and DCS has to have been restarted since you put it there.
2. Is the server running, and does the page load at all? Its own console window shows a colored
   line for this: green `Hook connected` once DCS is sending data, yellow `Hook not connected`
   while it's waiting. A yellow `No data from DCS for 10 s` during a flight is usually harmless:
   pausing, loading, changing slot or respawning all stop the data for a moment. The map shows
   the same in a grey box at the top: `CONNECTING TO MAP SERVER …` when it can't reach the
   server, `WAITING FOR DCS …` when the server has nothing from DCS yet or for the last 10 s.
3. Are you in a flight? The map comes alive when a mission starts.

The hook writes its status to `Saved Games/DCS/Logs/dcs.log` every ten seconds, which tells you
whether it's running and how many objects it's seeing:

```
[map-server] optionsView=optview_all  objects=245  sent=244
```

If that line never appears, the hook isn't loaded. If it appears with `objects=0`, DCS isn't
handing out any — see the first question above.

### The clock reads `--:--:--`, or airfields and zones are missing

First give it a few minutes: zones can take up to five, airfields up to one, if the map server
was started after you got into your aircraft (see [What's on the map](#whats-on-the-map)).

If they still don't come, your hook is older than the map. Run `start.bat` again: it replaces an
older version of this hook by itself (keeping the old one as `dcs-map-server.lua.bak`) and says
`hook updated`. Then restart DCS — it only loads hooks when it starts. If `start.bat` reports
`a different file is already at … -- left untouched`, the file there isn't this project's hook;
it's left alone on purpose, and you'd have to sort that out by hand.

### The tablet can't reach the address

Both devices have to be on the same network, and the PC's firewall has to allow the connection.
If you can't see the terminal window with the address any more, run `ipconfig` on the DCS PC and
look for "IPv4 Address".

Anything beyond this is in the [technical guide](DEVELOPERS.md).
