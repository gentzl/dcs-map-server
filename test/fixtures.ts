import { readFileSync } from 'node:fs';
import type { ServerMessage, Snapshot, Unit } from '../src/shared/types.js';

/**
 * Real recordings of the server's own WebSocket feed -- see
 * dcs/test/fixtures/README.md. Messier than anything synthetic generation
 * produces, which is the point: unit names from mission editors and asset
 * packs are the input the name-based heuristics actually have to survive.
 */
export const FIXTURES = ['real-session-2026-11-23', 'real-session-2026-11-23-multiplayer'] as const;

export function loadFixture(name: (typeof FIXTURES)[number]): ServerMessage[] {
  const path = new URL(`../../dcs/test/fixtures/${name}.jsonl`, import.meta.url);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => (JSON.parse(l) as { msg: ServerMessage }).msg);
}

export function firstSnapshot(name: (typeof FIXTURES)[number]): Snapshot {
  const snap = loadFixture(name).find((m): m is Snapshot => m.type === 'snapshot');
  if (!snap) throw new Error(`${name}: no snapshot in fixture`);
  return snap;
}

/** Every unit seen anywhere in a recording, de-duplicated by id. */
export function allUnits(name: (typeof FIXTURES)[number]): Unit[] {
  const byId = new Map<number, Unit>();
  for (const msg of loadFixture(name)) {
    for (const u of msg.units ?? []) byId.set(u.id, u);
  }
  return [...byId.values()];
}
