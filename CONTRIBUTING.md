# Working on this

`npm run check` runs everything CI runs: lint, typecheck, tests. If that passes,
a push will deploy.

```
npm run dev        server + console on :8080
npm run check      lint, typecheck, tests - what CI runs
npm run lint       oxlint on its own
npm test           every test/*.test.mjs
```

## Tests

Tests are plain node scripts under `test/`. There is no test framework and no
build step: `test/harness.mjs` provides `check(name, got, want)` and a tally,
and `test/run.mjs` finds and runs every `*.test.mjs` file it can see.

**A test file runs because it exists.** Nothing needs registering. The previous
arrangement named each file in the `test` script, and a file that was not added
there sat in the repo looking like coverage while never executing once.

**A module with no runtime imports can be tested directly.** Node strips type
annotations on import, so a dependency-free `.ts` file loads straight from
source:

```js
const modPath = path.join(here, '..', 'src', 'lib', 'reconnect.ts')
const { ReconnectPolicy } = await import('file://' + modPath.replace(/\\/g, '/'))
```

That is why the modules holding rules worth testing - `reconnect`, `frames`,
`driveInput`, `messageRate`, `signalling`, `actionKinds`, `cloudSession`,
`robotFaults`, `wireJson`, `address` - import little or nothing. It is a
constraint worth keeping: a module that needs a bundler to be exercised tends to
be a module nobody exercises.

Two rules follow from it:

- **Imports inside a test-loaded module need the file extension** (`'./sleep.ts'`),
  because node's resolver does not guess. `allowImportingTsExtensions` in
  tsconfig lets TypeScript accept it. Vite is happy either way.
- **Node's type stripping is not a compiler.** It removes annotations; it cannot
  transform. Constructor parameter properties (`constructor(private x: T) {}`)
  and enums fail at import. Write the field out.

React hooks and components have no test setup here. Where something genuinely
cannot be tested - `MediaRecorder` orchestration, WebGL - say so in the commit
rather than leaving it looking covered.

## Lint

`oxlint`, configured in `.oxlintrc.json`. The rules are chosen, not inherited:
every one enabled beyond the default correctness set has a defect behind it.

- **`react-hooks/exhaustive-deps` is an error.** An effect reading a value it has
  not declared captures whatever that value was when the effect was created and
  goes on using it. That is a stale closure, and it is the bug this codebase has
  had most often.
- **`no-unused-vars` is an error.** After a refactor it usually means something
  was left half-moved. It found five such leftovers the first time it ran.

Two rules are off on purpose:

- **`react/set-state-in-effect`.** The rule is right that an effect setting state
  is often avoidable. Here it is the job: this console synchronises with a robot
  over a data channel, and telemetry arriving is exactly the external event the
  rule exempts. It fired on every correct subscription in the codebase.
- **`react/refs`.** Reading `ref.current` during render is flagged, but the
  latest-value ref is deliberate - a 20Hz loop must read the current speed limit
  without being rebuilt each time one changes. Where the warning pointed at
  something real, `useRef(new Thing())` constructing on every render, that was
  fixed with `useOnce` instead of by silencing the rule.

## Shape of the code

- `src/lib/` - rules and protocol. Mostly import-free, mostly tested.
- `src/hooks/` - the same, where React is genuinely needed.
- `src/state/RobotContext.tsx` - composes the hooks and publishes the interface
  panels use. Telemetry is a separate context because it changes ~20 times a
  second and would otherwise re-render every consumer.
- `src/panels/` - what the operator sees. A panel should not know the protocol;
  where one does, that is a seam waiting to be made.
- `server/` - signalling proxy, discovery, cloud, auth. Runs locally and on
  Vercel; the serverless build has no LAN and refuses the methods that need one.

`CONTEXT.md` is the vocabulary. It is a glossary, not documentation - if a term
in the code is not in it and matters, add it.
