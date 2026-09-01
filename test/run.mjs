// Runs every test file in this directory.
//
// The test script used to name each file in a chain of seventeen &&s, which had
// two problems. A new test only ran if someone remembered to add it there, and
// forgetting is silent - the file sits in the repo looking like coverage while
// never executing. And the chain stops at the first failure, so one broken file
// hides the state of every file after it.
//
// Finding them instead means a file is run because it exists. Each still runs in
// its own process, because they exit with their own status and several bind
// ports; and all of them run even when one fails, because knowing whether a
// change broke one thing or ten is the difference between a quick fix and a
// bisect.

import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()

if (!files.length) {
  console.error('No test files found. That is itself a failure - the runner should never be idle.')
  process.exit(1)
}

/** Run one file to completion, resolving with its exit code. */
function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, file)], { stdio: 'inherit' })
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

const failed = []
for (const file of files) {
  console.log(`\n──── ${file} ────`)
  const code = await run(file)
  if (code !== 0) failed.push(file)
}

console.log(`\n${'─'.repeat(40)}`)
if (failed.length) {
  console.log(`${files.length - failed.length} of ${files.length} files passed`)
  for (const f of failed) console.log(`  FAILED  ${f}`)
  process.exit(1)
}
console.log(`all ${files.length} test files passed`)
