// Shared pass/fail bookkeeping for the node test files, so each of them holds
// only its cases.

export function makeChecker() {
  let pass = 0
  let fail = 0

  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (ok) {
      pass++
      console.log(`  ok   ${name}`)
    } else {
      fail++
      console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
    }
  }

  /**
   * Print the tally and set the exit status.
   *
   * Deliberately not process.exit(). That ends the process at once, while
   * stdout may still have buffered writes - and on Windows, tearing down a
   * pipe mid-write can trip a libuv assertion and abort with a status that has
   * nothing to do with whether the tests passed. It made this suite fail
   * intermittently under the runner, which is worse than failing outright:
   * a suite that fails at random is a suite nobody trusts.
   *
   * Setting exitCode lets the process end on its own once its output is
   * flushed. A file that then does not exit is holding something open, which
   * is a real defect in that file rather than something to paper over.
   */
  const finish = () => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exitCode = fail ? 1 : 0
  }

  return { check, finish }
}
