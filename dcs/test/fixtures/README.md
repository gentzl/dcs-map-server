# Fixtures

Real telemetry recorded from a running DCS session, for testing against data
that is messier than anything synthetic generation produces.

## real-session-2026-11-23.jsonl

Captured with `tools/capture-ws.ts` against a live server's `/ws` endpoint
(`npm run capture-ws -- wss://<host>:8443/ws --out FILE --seconds 90`),
single-player against a large AI-populated scenario: one aircraft (A-10A),
245 objects at the opening snapshot, air/ground/naval/carrier/air-defence all
represented. 686 messages (1 snapshot + 685 deltas) over 90 seconds.

Each line is `{"t": <ms since capture start>, "msg": <ServerMessage>}` --
the same `Snapshot`/`Delta` shape (`src/shared/types.ts`) a browser client
receives, not the hook's raw UDP wire format. That makes it the wrong input
for `tools/inspect-capture.ts` (which reads `{"t", "p"}` raw-datagram
captures written by `MM_CAPTURE`) -- there is currently no replay tool for
this JSONL shape; one would need to open a WebSocket, send each `msg` in
order spaced by its `t`, to feed it back through a server for a from-scratch
regression test.

Checked for anything identifying before this was committed: unit names are
vehicle/ship types (BMP-1, Mi-24P, CVN-75 Harry S. Truman, ...) or
auto-generated Mission Editor group labels (`Convoi Mobil Hard#001-03`, ...).
The only player identity present is the recording session's own callsign.
