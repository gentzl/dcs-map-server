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
captures written by `MM_CAPTURE`); `tools/replay-ws.ts` is the one that reads
this shape, and feeds it back through a server as a relay source.

Both files are also read directly by the tests (`test/fixtures.ts`): the
fog-of-war matrix is checked against them, and every distinct unit name in
them forms the classification baseline.

Checked for anything identifying before this was committed: unit names are
vehicle/ship types (BMP-1, Mi-24P, CVN-75 Harry S. Truman, ...) or
auto-generated Mission Editor group labels (`Convoi Mobil Hard#001-03`, ...).
The only player identity present is the recording session's own callsign.
Two MiG-21Bis in player slots (`Kobuleti_MiG-21Bis_139`/`_141`) carried what
look like other pilots' callsigns as `unitName`; replaced with `Player-3` /
`Player-4` afterwards (2026-11-26), continuing the numbering of the
multiplayer fixture below.

## real-session-2026-11-23-multiplayer.jsonl

Second capture, 30 seconds / 254 messages, 301 objects at the opening
snapshot -- same mechanism as above, but from a multiplayer mission rather
than single-player. Notably different composition: mostly `air` and
`carrier`/`naval`, air defence and ground present but less dominant than in
the first fixture, plus a couple of `static` and `unknown` entries. Useful
precisely because it looks different from the first one.

**Anonymised before committing.** Two other pilots' real callsigns appeared
as `unitName` on their aircraft (an F-15EX and an F/A-18C); replaced with
`Player-1` / `Player-2` throughout. Group names (mission slot identifiers
like `Nalchik_F-15EX_36`) were left as-is -- those are mission-editor slot
labels, not personal. Carrier/ship class names (`Essex`, `Kuznetsov`,
`Tarawa`) and TACAN beacon names (`Tacan Mozdok`, ...) are not personal
either and were left untouched.
