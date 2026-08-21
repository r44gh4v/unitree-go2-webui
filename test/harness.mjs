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

  /** Print the tally and exit non-zero when anything failed. */
  const finish = () => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  }

  return { check, finish }
}
