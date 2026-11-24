import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseDatagram } from '../src/server/protocol.js';

/**
 * Analyses a raw ingest recording.
 *
 * Answers the question of why units are missing: do they not arrive at all,
 * do they arrive unreadably, or does the mission setting withhold them?
 * From outside, these three cases look identical.
 *
 *   MM_CAPTURE=/tmp/hook.jsonl npm run dev      # record
 *   npm run capture -- /tmp/hook.jsonl          # analyse
 */

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
const path = positionals[0];
if (!path) {
  console.error('usage: inspect-capture <file.jsonl>');
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

  // Count raw lines before the parser discards anything.
  for (const l of rec.p.trim().split('\n')) {
    const type = l.split('\t')[0] ?? '';
    bump(lineTypes, type);
    const f = l.split('\t');
    if (type === 'A') {
      bump(names, f[2] ?? '(empty)');
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
  if (entries.length === 0) console.log('  (none)');
  for (const [k, n] of entries.slice(0, limit)) console.log(`  ${String(n).padStart(7)}  ${k}`);
  if (entries.length > limit) console.log(`  … and ${entries.length - limit} more`);
};

console.log(`Datagrams: ${datagrams}   Duration: ${seconds.toFixed(1)} s   ` +
            `${(bytes / 1024).toFixed(1)} KiB   ${(datagrams / Math.max(seconds, 1)).toFixed(1)}/s`);
show('Line types (O ownship, A unit, W weapon, D removed)', lineTypes);
show('Reported visibility rule', views);
show('Parse errors', errors);
show('Unit type levels', levels);
show('Unit names', names, 20);

if ((lineTypes.get('A') ?? 0) === 0 && (lineTypes.get('O') ?? 0) > 0) {
  console.log('\nFinding: ownship arrives, units do not.');
  const view = [...views.keys()][0];
  if (view === 'optview_myaircraft' || view === 'optview_onlymap') {
    console.log(`The mission is withholding them (${view}). The hook doesn't even send them.`);
  } else {
    console.log(`The visibility rule (${view}) permits them -- so the export is returning nothing.`);
    console.log('Check the DCS log: "[map-server] ... objects=N".');
  }
}
