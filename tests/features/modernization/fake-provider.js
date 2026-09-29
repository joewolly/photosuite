/** Explicit delivery hooks; no clocks, sleeps or production test switches. */
export function fakeProvider({ stoppable = true } = {}) {
  const calls = [], disposed = [];
  const provider = {
    validateInput: (input) => input.bytes.length,
    copyResult: (result) => ({ bytes: result.bytes.slice() }),
    disposeResult: (result) => disposed.push(result),
    start(input, callbacks, identity) {
      const call = { input, ...identity, ...callbacks, cancellations: 0 };
      calls.push(call);
      return () => { call.cancellations++; return stoppable; };
    },
  };
  return { provider, calls, disposed };
}
export async function flushJobs() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
