import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseDatagram } from '../src/server/protocol.js';

/**
 * Wertet eine Rohaufzeichnung des Ingest aus.
 *
 * Beantwortet die Frage, warum Einheiten fehlen: Kommen sie gar nicht an, kommen
 * sie unlesbar an, oder haelt die Missionseinstellung sie zurueck? Von aussen
 * sehen diese drei Faelle gleich aus.
 *
 *   MM_CAPTURE=/tmp/hook.jsonl npm run dev      # aufzeichnen
 *   npm run capture -- /tmp/hook.jsonl          # auswerten
 */

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
const path = positionals[0];
if (!path) {
  console.error('Aufruf: inspect-capture <datei.jsonl>');
  process.exit(2);
}

const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
const lineTypes = new Map<string, number>();
const views = new Map<string, number>();
const errors = new Map<string, number>();
const names = new Map<string, number>();
const levels = new Map<string, number>();
let datagrams = 0;
let bytes = 0;
let firstT = 0;
let lastT = 0;

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

for (const line of lines) {
  const rec = JSON.parse(line) as { t: number; p: string };
  datagrams++;
  bytes += rec.p.length;
  if (!firstT) firstT = rec.t;
  lastT = rec.t;

  // Rohzeilen zaehlen, bevor der Parser etwas verwirft.
  for (const l of rec.p.trim().split('\n')) {
    const type = l.split('\t')[0] ?? '';
    bump(lineTypes, type);
    const f = l.split('\t');
    if (type === 'A') {
      bump(names, f[2] ?? '(leer)');
      bump(levels, `l1=${f[10] ?? '?'} l2=${f[11] ?? '?'}`);
    }
  }

  const { optionsView, items } = parseDatagram(rec.p);
  if (optionsView) bump(views, optionsView);
  for (const item of items) {
    if (item?.kind === 'error') bump(errors, item.reason);
  }
}

const seconds = (lastT - firstT) / 1000;
const show = (title: string, m: Map<string, number>, limit = 12) => {
  console.log(`\n${title}`);
  const entries = [...m].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) console.log('  (keine)');
  for (const [k, n] of entries.slice(0, limit)) console.log(`  ${String(n).padStart(7)}  ${k}`);
  if (entries.length > limit) console.log(`  … und ${entries.length - limit} weitere`);
};

console.log(`Datagramme: ${datagrams}   Dauer: ${seconds.toFixed(1)} s   ` +
            `${(bytes / 1024).toFixed(1)} KiB   ${(datagrams / Math.max(seconds, 1)).toFixed(1)}/s`);
show('Zeilentypen (O Ownship, A Einheit, W Waffe, D entfernt)', lineTypes);
show('Gemeldete Sichtbarkeitsregel', views);
show('Parse-Fehler', errors);
show('Typebenen der Einheiten', levels);
show('Einheitennamen', names, 20);

if ((lineTypes.get('A') ?? 0) === 0 && (lineTypes.get('O') ?? 0) > 0) {
  console.log('\nBefund: Ownship kommt an, Einheiten nicht.');
  const view = [...views.keys()][0];
  if (view === 'optview_myaircraft' || view === 'optview_onlymap') {
    console.log(`Die Mission haelt sie zurueck (${view}). Der Hook sendet sie gar nicht erst.`);
  } else {
    console.log(`Die Sichtbarkeitsregel (${view}) erlaubt sie -- der Export liefert also nichts.`);
    console.log('Im DCS-Log pruefen: "[map-server] ... Objekte=N".');
  }
}
