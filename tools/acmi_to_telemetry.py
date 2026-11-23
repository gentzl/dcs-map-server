#!/usr/bin/env python3
"""Tacview-ACMI-Aufzeichnung in Telemetrie-Datagramme umsetzen.

Macht aus einem echten DCS-Flug Testdaten: DCS/Tacview schreibt nach jedem Flug
eine .acmi, die bereits alles Noetige enthaelt (Lat/Lon/Alt/Yaw je Objekt,
Zeitframes, Loeschereignisse). Damit braucht die Entwicklung kein laufendes DCS.

    python3 acmi_to_telemetry.py flug.zip.acmi --send
    python3 acmi_to_telemetry.py flug.acmi --dump fixture.jsonl
    python3 acmi_to_telemetry.py flug.acmi --list       # Objekte zeigen

Format laut https://www.tacview.net/documentation/acmi/ :
  Kopf       FileType / FileVersion, Objekt 0 traegt ReferenceLongitude/-Latitude
  Frame      "#<sekunden>"
  Objekt     "<hexid>,T=lon|lat|alt|roll|pitch|yaw,Name=..,Coalition=..,Type=.."
  Entfernen  "-<hexid>"

Zwei Fallstricke, die hier behandelt werden:
  1. Leere Felder in T= bedeuten "unveraendert", nicht null.
  2. T-Koordinaten sind Offsets auf ReferenceLongitude/-Latitude.

Abtastung: Ownship wird auf 10 Hz interpoliert, Fremdobjekte werden gehalten
bis zum naechsten Frame. Das bildet das echte Verhalten nach -- das eigene
Flugzeug kommt dicht getaktet, entfernte Objekte selten und ungleichmaessig.
"""

import argparse
import json
import math
import re
import socket
import sys
import time
import zipfile

SPLIT_UNESCAPED = re.compile(r'(?<!\\),')


def open_acmi(path):
    """Tacview liefert ueblicherweise .zip.acmi -- ein Zip mit einer Textdatei."""
    if zipfile.is_zipfile(path):
        zf = zipfile.ZipFile(path)
        name = zf.namelist()[0]
        return (line.decode("utf-8-sig", "replace").rstrip("\r\n")
                for line in zf.open(name))

    # Abgebrochene Aufzeichnungen behalten das PK-Magic, sind aber nicht entpackbar.
    # Ohne diese Pruefung wuerde der Parser Binaermuell als Objekte durchwinken.
    with open(path, "rb") as fh:
        if fh.read(2) == b"PK":
            raise SystemExit(
                "%s ist ein unvollstaendiges Zip (PK-Magic, kein lesbares Archiv).\n"
                "Tacview hat die Aufzeichnung vermutlich nicht sauber geschlossen."
                % path)

    return (line.rstrip("\r\n") for line in open(path, encoding="utf-8-sig", errors="replace"))


HEX_ID = re.compile(r'^[0-9a-fA-F]+$')


def csv_safe(value):
    """Das kommagetrennte Zielformat maskiert nichts, ein Komma im Namen wuerde
    die Zeile zerlegen. Namen werden deshalb entschaerft."""
    return str(value).replace(",", " ").replace("\t", " ").strip()


def parse_props(line):
    """Erstes Feld ist die ID, Rest sind Key=Value mit maskierten Kommata.
    Gibt (None, {}) fuer Kopfzeilen zurueck, deren erstes Feld keine Hex-ID ist."""
    parts = SPLIT_UNESCAPED.split(line)
    obj_id = parts[0]
    if not HEX_ID.match(obj_id):
        return None, {}
    props = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            props[k.strip()] = v.replace("\\,", ",").replace("\\\\", "\\")
    return obj_id, props


def merge_transform(prev, raw):
    """T= mit leeren Feldern heisst 'unveraendert' -- der haeufigste Parserfehler."""
    f = raw.split("|")
    out = dict(prev)
    for key, idx in (("lon", 0), ("lat", 1), ("alt", 2), ("roll", 3), ("pitch", 4), ("yaw", 5)):
        if idx < len(f) and f[idx] != "":
            try:
                out[key] = float(f[idx])
            except ValueError:
                pass
    return out


class Acmi:
    def __init__(self, path):
        self.ref_lon = 0.0
        self.ref_lat = 0.0
        self.objects = {}        # id -> {name, type, coalition, color, pilot}
        self.frames = []         # (t, {id: {lon,lat,alt,yaw}}, [entfernte ids])
        self._load(path)

    def _load(self, path):
        state = {}
        t = 0.0
        changed = {}
        removed = []
        started = False

        for line in open_acmi(path):
            if not line or line.startswith("//"):
                continue

            if line.startswith("#"):
                if started:
                    self.frames.append((t, changed, removed))
                try:
                    t = float(line[1:])
                except ValueError:
                    continue
                changed, removed, started = {}, [], True
                continue

            if line.startswith("-"):
                oid = line[1:].strip()
                removed.append(oid)
                state.pop(oid, None)
                continue

            oid, props = parse_props(line)
            if oid is None:
                continue

            if oid == "0":
                self.ref_lon = float(props.get("ReferenceLongitude", self.ref_lon))
                self.ref_lat = float(props.get("ReferenceLatitude", self.ref_lat))
                continue

            meta = self.objects.setdefault(oid, {})
            for k in ("Name", "Type", "Coalition", "Color", "Pilot", "Group"):
                if k in props:
                    meta[k] = props[k]

            if "T" in props:
                state[oid] = merge_transform(state.get(oid, {}), props["T"])
                changed[oid] = dict(state[oid])

        if started:
            self.frames.append((t, changed, removed))

    def absolute(self, tr):
        return (tr.get("lat", 0.0) + self.ref_lat, tr.get("lon", 0.0) + self.ref_lon)

    def pick_ownship(self):
        """Luftfahrzeug mit den meisten Positionsupdates.

        Ein Pilot-Feld taugt nicht als Kriterium: Tacview vergibt es auch an
        Bodeneinheiten und Schiffe ("Ground-4-7"). Die hoechste Abtastrate hat
        dagegen zuverlaessig das vom Spieler geflogene Objekt.
        """
        counts = {}
        for _, ch, _ in self.frames:
            for oid in ch:
                counts[oid] = counts.get(oid, 0) + 1
        if not counts:
            return None

        air = [o for o in counts
               if any(k in self.objects.get(o, {}).get("Type", "")
                      for k in ("FixedWing", "Rotorcraft"))]
        return max(air or counts, key=counts.get)


def coalition_id(meta):
    """DCS: 1 = rot, 2 = blau. ACMI fuehrt Color zuverlaessiger als Coalition."""
    c = (meta.get("Color") or meta.get("Coalition") or "").lower()
    if c.startswith("red") or "enem" in c:
        return 1
    return 2


def is_weapon(meta):
    t = (meta.get("Type") or "") + (meta.get("Name") or "")
    return any(k in t for k in ("Missile", "Weapon", "Bomb", "Shell", "Rocket", "Projectile"))


def lerp_angle(a, b, f):
    d = (b - a + 180.0) % 360.0 - 180.0
    return (a + d * f) % 360.0


def build_packets(acmi, own_id, rate, emit_delete, options_view):
    """Erzeugt (t, paket) in Sendereihenfolge, auf feste Rate abgetastet."""
    dt = 1.0 / rate
    own_samples = []
    for t, ch, _ in acmi.frames:
        if own_id in ch:
            lat, lon = acmi.absolute(ch[own_id])
            own_samples.append((t, lat, lon, ch[own_id].get("alt", 0.0),
                                ch[own_id].get("yaw", 0.0)))

    if not own_samples:
        raise SystemExit("Kein Ownship-Track gefunden -- mit --own <id> festlegen (--list zeigt IDs)")

    own_meta = acmi.objects.get(own_id, {})
    fi = 0
    si = 0
    t_end = acmi.frames[-1][0] if acmi.frames else 0.0
    live = {}
    last_tas = 0.0
    t = own_samples[0][0]

    while t <= t_end:
        # Frames bis t einarbeiten; deren Objektzustaende gelten ab jetzt
        while fi < len(acmi.frames) and acmi.frames[fi][0] <= t:
            ft, ch, rm = acmi.frames[fi]
            for oid, tr in ch.items():
                live[oid] = tr
            for oid in rm:
                if live.pop(oid, None) is not None and emit_delete:
                    yield (t, "D,%d" % (int(oid, 16) & 0x7FFFFFFF))
            fi += 1

        while si + 1 < len(own_samples) and own_samples[si + 1][0] <= t:
            si += 1
        a = own_samples[si]
        b = own_samples[min(si + 1, len(own_samples) - 1)]
        f = 0.0 if b[0] == a[0] else max(0.0, min(1.0, (t - a[0]) / (b[0] - a[0])))
        lat = a[1] + (b[1] - a[1]) * f
        lon = a[2] + (b[2] - a[2]) * f
        alt = a[3] + (b[3] - a[3]) * f
        yaw = lerp_angle(a[4], b[4], f)
        if b[0] > a[0]:
            tas = math.hypot((b[1] - a[1]) * 111320.0,
                             (b[2] - a[2]) * 111320.0 * math.cos(math.radians(lat))) / (b[0] - a[0])
            last_tas = tas
        else:
            tas = last_tas

        yield (t, "O,%d,%s,%d,%f,%f,%f,%f,%s,%s,%d,%f,%f,%f,%d,%d,%.3f,%f,%s,%.3f,%f,%.3f,%.2f" % (
            int(own_id, 16) & 0x7FFFFFFF, csv_safe(own_meta.get("Name", "UNKNOWN")), 1,
            lat, lon, alt, math.radians(yaw),
            csv_safe(own_meta.get("Pilot", "Player")), csv_safe(own_meta.get("Group", "Flight")),
            coalition_id(own_meta), 0.0, 0.0, 0.0, 0, 0, t, tas, options_view,
            max(0.0, alt), 0 if alt > 25 else 1, 1.0, 0.0))

        for oid, tr in live.items():
            if oid == own_id:
                continue
            meta = acmi.objects.get(oid, {})
            olat, olon = acmi.absolute(tr)
            nid = int(oid, 16) & 0x7FFFFFFF
            if is_weapon(meta):
                yield (t, "W,%d,%s,%.6f,%.6f,%f,%f,%d" % (
                    nid, csv_safe(meta.get("Name", "WEAPON")), olat, olon,
                    tr.get("alt", 0.0), math.radians(tr.get("yaw", 0.0)), coalition_id(meta)))
            else:
                yield (t, "A,%d,%s,%d,%.6f,%.6f,%f,%f,%s,%s,%d" % (
                    nid, csv_safe(meta.get("Name", "UNKNOWN")), 1, olat, olon,
                    tr.get("alt", 0.0), math.radians(tr.get("yaw", 0.0)),
                    csv_safe(meta.get("Pilot", "Unit-%s" % oid)), csv_safe(meta.get("Group", "Group-%s" % oid)),
                    coalition_id(meta)))
        t += dt


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("acmi")
    ap.add_argument("--list", action="store_true", help="Objekte auflisten und beenden")
    ap.add_argument("--own", help="Objekt-ID des eigenen Flugzeugs (hex, wie in der Datei)")
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--dump", metavar="DATEI")
    ap.add_argument("--stdout", action="store_true")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=50000)
    ap.add_argument("--rate", type=float, default=10.0)
    ap.add_argument("--emit-delete", action="store_true",
                    help="D-Pakete fuer entfernte Objekte")
    ap.add_argument("--options-view", default="optview_all")
    args = ap.parse_args()

    acmi = Acmi(args.acmi)
    print("Frames: %d   Objekte: %d   Referenz: %.4f / %.4f   Dauer: %.1f s"
          % (len(acmi.frames), len(acmi.objects), acmi.ref_lat, acmi.ref_lon,
             acmi.frames[-1][0] if acmi.frames else 0.0), file=sys.stderr)

    if args.list:
        for oid, m in sorted(acmi.objects.items()):
            print("%-10s %-28s %-22s %s%s" % (oid, m.get("Name", "?"), m.get("Type", "?"),
                                              m.get("Color", m.get("Coalition", "?")),
                                              "  <- Pilot: " + m["Pilot"] if m.get("Pilot") else ""))
        return

    own = args.own or acmi.pick_ownship()
    print("Ownship: %s (%s)" % (own, acmi.objects.get(own, {}).get("Name", "?")), file=sys.stderr)

    packets = build_packets(acmi, own, args.rate, args.emit_delete, args.options_view)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM) if args.send else None
    sink = open(args.dump, "w") if args.dump else None
    t0 = None
    wall = time.monotonic()
    n = 0

    try:
        for t, pkt in packets:
            if t0 is None:
                t0 = t
            if sock:
                lag = (t - t0) - (time.monotonic() - wall)
                if lag > 0:
                    time.sleep(lag)
                sock.sendto(pkt.encode("utf-8"), (args.host, args.port))
            if sink:
                sink.write(json.dumps({"t": round(t - t0, 3), "p": pkt}) + "\n")
            if args.stdout:
                print(pkt)
            n += 1
    except KeyboardInterrupt:
        pass
    finally:
        if sink:
            sink.close()
        if sock:
            sock.sendto(b"close_socket", (args.host, args.port))
    print("Pakete: %d" % n, file=sys.stderr)


if __name__ == "__main__":
    main()
