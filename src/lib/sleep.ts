/**
 * Wait, then carry on.
 *
 * Written out in three places, identically in two of them. It is one line, but
 * a one-line helper copied around is still a decision made three times - and
 * the third copy was inline in an upload loop where its purpose was not obvious.
 */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
