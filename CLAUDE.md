# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm run dev        server + console on :8080 (Vite middleware mode, hot reload)
npm run check      lint, typecheck, tests - exactly what CI runs
npm run lint       oxlint
npm run typecheck  tsc --noEmit
npm test           every test/*.test.mjs, each in its own process
npm run build      tsc --noEmit && vite build
npm start          prebuilt dist/ + API on :8080
```

Run one test file directly: `node test/frames.test.mjs`. The runner discovers
files by glob, so nothing needs registering.

`npm run test:protocol` opens the browser loopback test on :5174 — it wires two
`RTCPeerConnection`s together and runs the real client against a stand-in robot.
Needs a browser; it is not part of `npm test`.

`WEBUI_PASSWORD=x npm start` turns on the password gate.

## Architecture

The browser holds the WebRTC peer connection with the robot directly — video,
audio and the data channel are all point to point. The Node server exists for
one reason: the robot serves no CORS headers and newer firmware encrypts the
handshake, so the browser cannot do signalling itself. The server relays the SDP
offer/answer and then handles no robot traffic at all.

```
browser ──POST /api/connect──▶ node server ──HTTP──▶ robot :9991 or :8081
   │                                                       │
   └───────────── WebRTC: video, audio, data ──────────────┘
```

**Two entry points, one API.** `server/app.mjs` holds the routes; `server/index.mjs`
runs it locally with static files or Vite, `api/index.mjs` exports it as a Vercel
function. `SERVERLESS` (`process.env.VERCEL === '1'`) gates everything needing a
LAN — discovery and the IP/Serial/AP methods refuse there, leaving Cloud as the
only method a deployment can offer. On a deployment the password gate is
mandatory: no password means the API refuses to serve rather than failing open.

**Frontend layering**, roughly outermost to innermost:

- `src/panels/` — what the operator sees. A panel should not know the protocol;
  where one does, that is a seam waiting to be made.
- `src/state/RobotContext.tsx` — composes the hooks into the `RobotApi` interface
  panels consume, grouped as `link` / `motion` / `media` / `sensing` /
  `diagnostics`. **Telemetry is a deliberately separate context** because it
  arrives ~20×/s and would otherwise re-render every consumer.
- `src/hooks/` — stateful pieces that genuinely need React.
- `src/lib/` — rules and protocol. Mostly import-free, mostly tested.

`src/lib/go2.ts` is the link itself: peer setup, validation handshake,
heartbeat, pub/sub, api requests, binary frames. Signalling (`signalling.ts`),
file transfer (`fileTransfer.ts`), frame parsing (`frames.ts`), reconnect policy
(`reconnect.ts`) and voxel decoding (`voxel.ts`) were each lifted out of it and
should stay out.

## Protocol invariants

`src/lib/constants.ts` values are wire-exact — changing one silently breaks the
command it belongs to. Everything there is transcribed from
legion1581/unitree_webrtc_connect and unitree_ui, not derived.

- Requests are `{"type":"req","topic":T,"data":{"header":{"identity":{"id":N,"api_id":A}},"parameter":S}}`
  where `parameter` is always a **string**, JSON-encoded if it holds an object.
- Replies are matched on `data.header.identity.id`, **not** on topic. Id
  uniqueness is the whole job of `correlation.ts`; a collision resolves the
  wrong promise and leaves the other request hanging forever.
- Validation answer is `base64(md5_bytes("UnitreeGo2_" + key))`.
- Heartbeat every 2s or the robot drops the link.
- Binary frames carry a JSON header plus payload. Lidar frames are marked by a
  `(2, 0)` uint16 pair and use a 32-bit length; everything else uses 16-bit.
- Signalling is **one-shot** — no renegotiation. A dropped link is reopened from
  scratch, which is why recovery and connecting are separate concepts.
- The same action has different api ids per motion service (`normal` / `ai` /
  `advanced` / `mcf`). The console never refuses an action it lacks an id for on
  the running service — it sends what it has and lets the robot answer, because
  the id tables are transcriptions, not the robot's manifest.

## Testing constraints

Tests are plain node scripts. No framework, no build step: `test/harness.mjs`
gives `check(name, got, want)` and a tally, `test/run.mjs` finds and runs every
`*.test.mjs`.

A module is testable directly only if it has no runtime imports — node strips
type annotations on import and loads the `.ts` straight from source. That is why
`reconnect`, `frames`, `driveInput`, `messageRate`, `signalling`, `actionKinds`,
`cloudSession`, `robotFaults`, `wireJson` and `address` import little or nothing.
**Keep it that way** when adding rules worth testing. Two consequences:

- Imports inside a test-loaded module need the file extension (`'./sleep.ts'`).
  `allowImportingTsExtensions` in tsconfig lets TypeScript accept it.
- Node's type stripping is not a compiler. Constructor parameter properties
  (`constructor(private x: T) {}`) and enums fail at import. Write the field out.

`harness.mjs` sets `process.exitCode` rather than calling `process.exit()` — on
Windows, tearing down a pipe mid-write trips a libuv assertion and the suite
fails at random. Do not "simplify" that back.

React hooks and components have no test setup. Where something genuinely cannot
be tested (`MediaRecorder` orchestration, WebGL), say so in the commit rather
than leaving it looking covered.

## Lint

`.oxlintrc.json` rules are chosen, not inherited — each one beyond the
correctness set has a defect behind it.

- `react-hooks/exhaustive-deps` is an **error**. Stale closures are this
  codebase's most frequent bug.
- `no-unused-vars` is an **error**. After a refactor it means something was left
  half-moved.
- `react/set-state-in-effect` and `react/refs` are **off on purpose**. Telemetry
  arriving is the external event the first rule exempts, and the latest-value ref
  is deliberate — a 20Hz loop must read the current speed limit without being
  rebuilt. Where `react/refs` pointed at something real (`useRef(new Thing())`
  constructing every render), the fix was `useOnce`, not silencing the rule.

## Conventions worth knowing

- **`CONTEXT.md` is the glossary** and is gitignored — local reference only.
  It fixes the vocabulary the code and interface both use (link vs connection,
  recovery vs retry, action vs command, operator vs user). If a term in the code
  is not in it and matters, add it.
- **`unitree_ui/` is a vendored reference project**, gitignored and excluded from
  lint. Read it for protocol detail; never import from it. This project shares no
  application code with its references — the protocol is reimplemented in
  TypeScript, including a pure-TS LZ4/voxel decoder in place of their WASM one.
- **CSS import order in `src/styles.css` is the cascade order and is
  load-bearing.** The five parts are not alphabetical and must not be sorted.
- **The server only ever fetches a robot address.** `isRobotAddress()` in
  `server/address.mjs` allows a dotted-quad IPv4 literal and nothing else,
  because the value arrives in a request body and is interpolated into a URL the
  server then fetches. Every path that reaches `signalRobot` goes through it.
- **Nothing under `/api` may be cached** — it is all live state and credentials.
- `.gitattributes` pins the working copy to LF. Tooling that matches on exact
  source text silently stops matching under CRLF.
- Commit subjects here read as sentences describing intent ("Give binary frame
  parsing a home and a test"), not Conventional Commits.
- CI (`.github/workflows/deploy.yml`) runs lint → build → test on push to `main`,
  then deploys to Vercel. Lint runs first because it is fastest and catches the
  class of bug this codebase actually has.
