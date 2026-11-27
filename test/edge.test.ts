import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { EDGE_CLEARANCE, type EdgeArea, edgePosition } from '../src/client/edge.js';

// A laptop browser window, roughly as in the bug report: HUD bar 37 px,
// a BRA readout down to 200 px, the control bar from 662 px.
const W = 1050;
const H = 720;
const HUD = 37;
const READOUT = 200;
const BAR = 662;

/** True when q lies on the ray from the view centre through p. */
function onRay(p: { x: number; y: number }, q: { x: number; y: number }, w: number, h: number): boolean {
  const ax = p.x - w / 2;
  const ay = p.y - h / 2;
  const bx = q.x - w / 2;
  const by = q.y - h / 2;
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  return Math.abs(cross) < 1e-6 * Math.hypot(ax, ay) * Math.max(1, Math.hypot(bx, by)) && dot >= 0;
}

/** Equal to within floating-point noise. */
const near = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

describe('edge marker position', () => {
  test('stays below an open readout instead of covering it', () => {
    // The reported case: aircraft 25 nm off to the WNW, readout open top-left.
    const p = { x: -900, y: -400 };
    const at = edgePosition(p, W, H, { top: READOUT, bottom: BAR }, HUD);
    assert.ok(at.y >= READOUT + EDGE_CLEARANCE.top - 1e-9, `y ${at.y} runs into the readout`);
    assert.ok(onRay(p, at, W, H), 'marker left the line towards the aircraft');
  });

  test('with only the HUD it sits where the old fixed margin put it', () => {
    const at = edgePosition({ x: W / 2, y: -5000 }, W, H, { top: HUD, bottom: BAR }, HUD);
    // Old code: 58 px from the top. Now HUD bottom + clearance.
    near(at.y, HUD + EDGE_CLEARANCE.top);
    assert.ok(Math.abs(at.y - 58) <= 2);
  });

  test('stays above the control bar, with room for its label', () => {
    const at = edgePosition({ x: W / 2, y: 9000 }, W, H, { top: HUD, bottom: BAR }, HUD);
    near(at.y, BAR - EDGE_CLEARANCE.bottom);
  });

  test('keeps the side margin left and right', () => {
    const right = edgePosition({ x: 5000, y: H / 2 }, W, H, { top: HUD, bottom: BAR }, HUD);
    const left = edgePosition({ x: -5000, y: H / 2 }, W, H, { top: HUD, bottom: BAR }, HUD);
    near(right.x, W - EDGE_CLEARANCE.side);
    near(left.x, EDGE_CLEARANCE.side);
  });

  test('a readout filling most of a phone falls back to the HUD alone', () => {
    // 412 x 915 phone, three-line HUD to 96 px, readout down to 760 px,
    // controls from 790 px: no usable room left between them.
    const at = edgePosition({ x: 206, y: -3000 }, 412, 915, { top: 760, bottom: 790 }, 96);
    near(at.y, 96 + EDGE_CLEARANCE.top);
  });

  test('never leaves the free area and always points at the aircraft', () => {
    const areas: Array<[number, number, EdgeArea, number]> = [
      [W, H, { top: READOUT, bottom: BAR }, HUD],
      [W, H, { top: HUD, bottom: BAR }, HUD],
      [412, 915, { top: 96, bottom: 790 }, 96],
      [412, 915, { top: 330, bottom: 790 }, 96],
      [1366, 1024, { top: 64, bottom: 955 }, 64],
    ];
    for (const [w, h, area, hud] of areas) {
      let top = area.top + EDGE_CLEARANCE.top;
      const bottom = area.bottom - EDGE_CLEARANCE.bottom;
      if (bottom - top < 80) top = hud + EDGE_CLEARANCE.top;
      for (let i = 0; i < 720; i++) {
        // Points on a big circle around the view: every direction, all off screen.
        const a = (i / 720) * 2 * Math.PI;
        const p = { x: w / 2 + Math.cos(a) * 4 * w, y: h / 2 + Math.sin(a) * 4 * h };
        const at = edgePosition(p, w, h, area, hud);
        const msg = `${w}x${h} top ${area.top} angle ${(a * 180) / Math.PI}`;
        assert.ok(at.x >= EDGE_CLEARANCE.side - 1e-6 && at.x <= w - EDGE_CLEARANCE.side + 1e-6, `x out: ${msg}`);
        assert.ok(at.y >= top - 1e-6 && at.y <= bottom + 1e-6, `y out: ${msg}`);
        assert.ok(onRay(p, at, w, h), `off the ray: ${msg}`);
      }
    }
  });
});
