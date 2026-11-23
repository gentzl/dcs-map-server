#!/usr/bin/env python3
"""Synthetische DCS-Telemetrie fuer die Entwicklung.

Erzeugt protokollkonforme UDP-Datagramme und sendet sie an den Server, damit
Darstellung und Interpolation ohne laufendes DCS geprueft werden koennen.

    python3 generate_telemetry.py --send            # live an 127.0.0.1:50000
    python3 generate_telemetry.py --dump f.jsonl    # Fixture schreiben
    python3 generate_telemetry.py --replay f.jsonl  # Fixture abspielen
    python3 generate_telemetry.py --stdout -n 30    # kurz reinschauen

Feldsemantik des kommagetrennten Formats (Schema 1):
  O: id,Name,level2,Lat,Lon,Alt,HDG,UnitName,GroupName,Coalition,windX,windY,windZ,
     chaff,flare,modelTime,TAS,optionsView,RALT,WoW,accelY,AoA
  A: id,Name,level2,Lat,Lon,Alt,HDG,UnitName,GroupName,Coalition
  W: id,Name,Lat,Lon,Alt,HDG,Coalition
  WoW: 0 = in der Luft, 1 = Boden, 2 = Traegerdeck (Fahrwerk gedrueckt, RALT > 10)

UNGEPRUEFT, weil ohne echten Mitschnitt nicht verifizierbar: Einheit von HDG
(hier Bogenmass, 0 = Nord), AoA (hier Grad) und accelY (hier g). Beim ersten
echten Mitschnitt gegenpruefen -- siehe --compare im README-Abschnitt unten.
"""

import argparse
import json
import math
import random
import socket
import sys
import time

R_EARTH = 6371000.0
G = 9.80665

# Kaukasus-Karte, Kuestenabschnitt Batumi-Sochi. Koordinaten sind
# Realwelt-Naeherungen, nicht aus DCS gelesen.
WAYPOINTS = [
    (41.610, 41.600, 20),      # Batumi, Startpunkt
    (41.930, 41.860, 2400),    # Kobuleti-Kueste, Steigflug
    (42.240, 42.050, 4600),    # Senaki
    (42.180, 42.480, 5800),    # Kutaisi, Wendepunkt landeinwaerts
    (42.700, 41.700, 6100),    # Nordwest ueber Land
    (42.860, 41.130, 5200),    # Suchumi
    (42.300, 40.900, 3800),    # Wende auf See
    (41.800, 41.200, 2600),    # Anflugrichtung
]

# (Name, level1, Lat, Lon, Coalition, UnitName, GroupName)
# level1: 1 Air, 2 Ground, 3 Navy, 4 Weapon, 5 Static
GROUND_SITES = [
    ("S-300PS 5P85C LN", 2, 42.845, 41.115, 1, "SAM-1-1", "Sukhumi SAM"),
    ("S-300PS 5P85D LN", 2, 42.848, 41.122, 1, "SAM-1-2", "Sukhumi SAM"),
    ("SA-11 BUK LN 9A310M1", 2, 42.512, 41.603, 1, "BUK-1", "Centre BUK"),
    ("OSA 9A33 LN", 2, 42.205, 42.060, 1, "OSA-1", "Senaki AD"),
    ("HAWK LN", 2, 41.615, 41.605, 2, "HAWK-1", "Batumi AD"),
    ("PATRIOT LN", 2, 41.625, 41.590, 2, "PAT-1", "Batumi AD"),
    ("T-72B", 2, 42.300, 41.900, 1, "ARM-1", "Armour-1"),
    ("T-72B", 2, 42.304, 41.906, 1, "ARM-2", "Armour-1"),
    ("Frigate", 3, 42.400, 40.800, 1, "SHIP-1", "Naval-1"),
    ("CVN-71 Theodore Roosevelt", 3, 42.250, 40.700, 2, "CVN-71", "CSG-1"),
    ("TICONDEROGA", 3, 42.270, 40.740, 2, "CG-1", "CSG-1"),
    ("Kilo", 3, 42.180, 40.650, 1, "SSK-1", "Subsurface-1"),
    ("MiG-29A", 1, 42.600, 41.400, 1, "MIG-1", "Bandit-1"),
    ("Ka-50", 1, 42.100, 41.750, 1, "HELO-1", "Rotary-1"),
]


def destination(lat, lon, hdg, dist):
    """Zielpunkt auf dem Grosskreis -- bei Legs dieser Laenge genauer als eine Ebenennaeherung."""
    lat1, lon1, d = math.radians(lat), math.radians(lon), dist / R_EARTH
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(hdg))
    lon2 = lon1 + math.atan2(math.sin(hdg) * math.sin(d) * math.cos(lat1),
                             math.cos(d) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180


def bearing_to(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    return math.atan2(math.sin(dl) * math.cos(p2),
                      math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)) % (2 * math.pi)


def distance_to(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


class Ownship:
    """Kinematik mit begrenzter Dreh- und Steigrate, damit die erzeugte Spur
    interpolierbar ist wie eine echte -- eine Sprungspur wuerde Dead Reckoning
    faelschlich gut aussehen lassen."""

    MAX_TURN = math.radians(3.0)   # Standardkurve
    MAX_CLIMB = 18.0               # m/s

    def __init__(self, unit_id=1000):
        self.id = unit_id
        self.lat, self.lon, self.alt = WAYPOINTS[0][0], WAYPOINTS[0][1], WAYPOINTS[0][2]
        self.wp = 1
        self.hdg = bearing_to(self.lat, self.lon, WAYPOINTS[1][0], WAYPOINTS[1][1])
        self.tas = 60.0
        self.accel_y = 1.0
        self.chaff, self.flare = 60, 60
        self.t = 0.0

    def step(self, dt):
        tgt_lat, tgt_lon, tgt_alt = WAYPOINTS[self.wp]
        if distance_to(self.lat, self.lon, tgt_lat, tgt_lon) < 1500:
            self.wp = (self.wp + 1) % len(WAYPOINTS)

        want = bearing_to(self.lat, self.lon, tgt_lat, tgt_lon)
        diff = (want - self.hdg + math.pi) % (2 * math.pi) - math.pi
        turn = max(-self.MAX_TURN * dt, min(self.MAX_TURN * dt, diff))
        self.hdg = (self.hdg + turn) % (2 * math.pi)

        # Lastvielfaches aus der Kurvenrate -- tan(bank) = omega*v/g
        omega = turn / dt if dt else 0.0
        bank = math.atan2(omega * max(self.tas, 1.0), G)
        self.accel_y = 1.0 / max(math.cos(bank), 0.2)

        self.alt += max(-self.MAX_CLIMB * dt, min(self.MAX_CLIMB * dt, tgt_alt - self.alt))
        target_tas = 90.0 + self.alt / 30.0
        self.tas += max(-4.0 * dt, min(4.0 * dt, target_tas - self.tas))

        self.lat, self.lon = destination(self.lat, self.lon, self.hdg, self.tas * dt)
        self.t += dt
        if self.t % 37 < dt:
            self.chaff = max(0, self.chaff - 1)
            self.flare = max(0, self.flare - 1)

    @property
    def ralt(self):
        return max(0.0, self.alt - 15.0)

    @property
    def wow(self):
        if self.ralt > 10:
            return 0
        return 1

    @property
    def aoa(self):
        return max(1.5, 14.0 - (self.tas - 60.0) / 18.0)

    def packet(self, options_view, schema=3):
        if schema == 1:
            return "O,%d,%s,%d,%f,%f,%f,%f,%s,%s,%d,%f,%f,%f,%d,%d,%.3f,%f,%s,%.3f,%f,%.3f,%.2f" % (
                self.id, "FA-18C_HORNET", 1, self.lat, self.lon, self.alt, self.hdg,
                "Hornet-1-1", "Hornet-1", 2, 3.2, 0.0, -1.8,
                self.chaff, self.flare, self.t, self.tas, options_view,
                self.ralt, self.wow, self.accel_y, self.aoa)
        return "O\t%d\t%s\t%.7f\t%.7f\t%.2f\t%.5f\t%s\t%s\t%d\t%.2f\t%.2f\t%d\t%.3f\t%.3f\t%d\t%d\t%.2f\t%.2f\t%.2f" % (
            self.id, "FA-18C_hornet", self.lat, self.lon, self.alt, self.hdg,
            "Hornet-1-1", "Hornet-1", 2, self.tas, self.ralt, self.wow,
            self.aoa, self.accel_y, self.chaff, self.flare, 3.2, 0.0, -1.8)


class Convoy:
    """Bodenziele, die sich bewegen -- statische Einheiten allein wuerden das
    Stale-Handling nicht auf die Probe stellen."""

    def __init__(self, unit_id, lat, lon, hdg, speed, coalition, name, group):
        self.id, self.lat, self.lon = unit_id, lat, lon
        self.hdg, self.speed = math.radians(hdg), speed
        self.coalition, self.name, self.group = coalition, name, group

    def step(self, dt):
        self.hdg = (self.hdg + math.radians(random.uniform(-1.5, 1.5)) * dt) % (2 * math.pi)
        self.lat, self.lon = destination(self.lat, self.lon, self.hdg, self.speed * dt)

    def packet(self, schema=3):
        if schema == 1:
            return "A,%d,%s,%d,%.6f,%.6f,%f,%f,%s,%s,%d" % (
                self.id, "M6 LINEBACKER", 1, self.lat, self.lon, 120.0, self.hdg,
                self.name, self.group, self.coalition)
        return "A\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%s\t%s\t%d\t%d\t%d" % (
            self.id, "M6 LINEBACKER", self.lat, self.lon, 120.0, self.hdg,
            self.name, self.group, self.coalition, 2, 0)


class Missile:
    def __init__(self, unit_id, lat, lon, alt, hdg, coalition):
        self.id, self.lat, self.lon, self.alt = unit_id, lat, lon, alt
        self.hdg, self.coalition, self.life = hdg, coalition, 14.0

    def step(self, dt):
        self.lat, self.lon = destination(self.lat, self.lon, self.hdg, 700.0 * dt)
        self.alt = max(0.0, self.alt - 40.0 * dt)
        self.life -= dt

    def packet(self, schema=3):
        if schema == 1:
            return "W,%d,%s,%.6f,%.6f,%f,%f,%d" % (
                self.id, "AIM_120", self.lat, self.lon, self.alt, self.hdg, self.coalition)
        return "W\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%d" % (
            self.id, "AIM_120C", self.lat, self.lon, self.alt, self.hdg, self.coalition)


class World:
    """Haelt den Zustand und gibt pro Tick die Pakete heraus -- inklusive der
    Obergrenze an Einheiten je Tick. Sie praegt das Alterungsverhalten, gegen
    das die Interpolation getestet werden muss: Objekte am Ende eines
    Durchlaufs sind aelter als die am Anfang."""

    UNITS_PER_TICK = 30

    def __init__(self, extra_units=0, options_view="optview_allies", seed=1, schema=3):
        random.seed(seed)
        self.schema = schema
        self.options_view = options_view
        self.own = Ownship()
        self.statics = list(GROUND_SITES)
        self.movers = []
        self.missiles = []
        self.next_id = 2000

        for i in range(extra_units):
            self.movers.append(Convoy(
                self.next_id, 41.9 + random.uniform(-0.3, 0.9), 41.6 + random.uniform(-0.4, 0.8),
                random.uniform(0, 360), random.uniform(4, 14),
                random.choice((1, 2)), "Ground-%d" % i, "Convoy-%d" % (i // 4)))
            self.next_id += 1

        self._queue = []

    def step(self, dt):
        self.own.step(dt)
        for m in self.movers:
            m.step(dt)
        for w in list(self.missiles):
            w.step(dt)
            if w.life <= 0:
                self.missiles.remove(w)
        if random.random() < dt * 0.08:
            self.missiles.append(Missile(self.next_id, self.own.lat, self.own.lon,
                                         self.own.alt, self.own.hdg, 2))
            self.next_id += 1

    def _static_packet(self, i, entry):
        n, l1, la, lo, co, un, gn = entry
        if self.schema == 1:
            return "A,%d,%s,%d,%.6f,%.6f,%f,%f,%s,%s,%d" % (
                3000 + i, n, 1, la, lo, 50.0, 0.0, un, gn, co)
        return "A\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%s\t%s\t%d\t%d\t%d" % (
            3000 + i, n, la, lo, 50.0, 0.0, un, gn, co, l1, 0)

    def tick_packets(self):
        """Ownship jeden Tick, Fremdeinheiten rundenweise ueber mehrere Ticks."""
        out = [self.own.packet(self.options_view, self.schema)]
        if self.options_view == "optview_onlymap":
            return out

        if not self._queue:
            self._queue = (
                [self._static_packet(i, e) for i, e in enumerate(self.statics)]
                + [m.packet(self.schema) for m in self.movers]
                + [w.packet(self.schema) for w in self.missiles])
        out.extend(self._queue[:self.UNITS_PER_TICK])
        del self._queue[:self.UNITS_PER_TICK]
        return out


def run(args):
    world = World(args.units, args.options_view, args.seed, args.schema)
    dt = 1.0 / args.rate
    sock = None
    sink = None

    if args.send or args.replay:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    if args.dump:
        sink = open(args.dump, "w")

    if args.replay:
        with open(args.replay) as fh:
            t0 = time.monotonic()
            for line in fh:
                rec = json.loads(line)
                wait = rec["t"] - (time.monotonic() - t0)
                if wait > 0:
                    time.sleep(wait)
                sock.sendto(rec["p"].encode("utf-8"), (args.host, args.port))
        return

    ticks = 0
    t_wall = time.monotonic()
    try:
        while args.ticks == 0 or ticks < args.ticks:
            world.step(dt)
            packets = world.tick_packets()

            if args.schema == 1:
                datagrams = packets
            else:
                # Schema 3 buendelt alles eines Ticks in ein Datagramm mit Kopfzeile.
                header = "MM\t3\t%.3f\t%s" % (ticks * dt, args.options_view)
                datagrams = ["\n".join([header] + packets) + "\n"]

            for p in datagrams:
                if sock:
                    sock.sendto(p.encode("utf-8"), (args.host, args.port))
                if sink:
                    sink.write(json.dumps({"t": round(ticks * dt, 3), "p": p}) + "\n")
                if args.stdout:
                    print(p)
            ticks += 1
            if sock and not args.fast:
                t_wall += dt
                lag = t_wall - time.monotonic()
                if lag > 0:
                    time.sleep(lag)
    except KeyboardInterrupt:
        pass
    finally:
        if sink:
            sink.close()
        if sock:
            sock.sendto(b"close_socket", (args.host, args.port))  # wie onSimulationStop
    print("%d Ticks (%.1f s Simulationszeit)" % (ticks, ticks * dt), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--send", action="store_true", help="per UDP senden")
    ap.add_argument("--stdout", action="store_true", help="Pakete ausgeben")
    ap.add_argument("--dump", metavar="DATEI", help="Fixture schreiben (JSONL)")
    ap.add_argument("--replay", metavar="DATEI", help="Fixture abspielen")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=50000)
    ap.add_argument("--rate", type=float, default=10.0, help="Ticks/s (der Hook sendet mit 10)")
    ap.add_argument("-n", "--ticks", type=int, default=0, help="0 = endlos")
    ap.add_argument("--units", type=int, default=24, help="zusaetzliche Bodeneinheiten")
    ap.add_argument("--options-view", default="optview_allies",
                    choices=["optview_onlymap", "optview_myaircraft", "optview_allies",
                             "optview_onlyallies", "optview_all"])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--schema", type=int, default=3, choices=[1, 3],
                    help="3 = tabgetrennt und gebuendelt, "
                         "1 = kommagetrenntes Format")
    ap.add_argument("--fast", action="store_true", help="ohne Echtzeitbremse")
    args = ap.parse_args()
    if not (args.send or args.stdout or args.dump or args.replay):
        ap.error("mindestens eines von --send/--stdout/--dump/--replay")
    run(args)


if __name__ == "__main__":
    main()
