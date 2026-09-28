import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ModernizationJobs, JobError, JOB_LIMITS } from '../../../src/features/modernization/job-service.js';
import { fakeProvider, flushJobs } from './fake-provider.js';

function fixture(options) {
  const fake = fakeProvider(options), service = new ModernizationJobs({ test: fake.provider });
  let stale = false, disposed = 0, previews = 0, commits = 0;
  const adapter = { capture: () => ({ documentId: 'doc-1' }), validate: () => { if (stale) throw new JobError('stale-result', 'Changed'); },
    preview: () => previews++, commit: () => commits++, dispose: () => disposed++ };
  const input = { bytes: new Uint8Array([1, 2, 3]) };
  return { ...fake, service, input, adapter, submit: (extra = {}) => service.submit({ operation: 'test', input, adapter, ...extra }),
    stale: () => { stale = true; }, counts: () => ({ disposed, previews, commits }) };
}
const result = () => ({ bytes: new Uint8Array([40, 80, 120]) });
it('queued -> preparing -> running -> preview -> commit, owned bytes and bounded summaries', async () => {
  const f = fixture(), states = []; f.service.subscribe((job) => states.push(job.state));
  const id = f.submit(); f.input.bytes.fill(0); await flushJobs();
  assert.deepEqual(f.calls[0].input.bytes, new Uint8Array([1, 2, 3]));
  assert.equal(f.counts().commits, 0); f.calls[0].complete(result());
  assert.equal(f.service.get(id).state, 'preview'); assert.equal(f.counts().commits, 0);
  assert.equal(f.service.accept(id), true); assert.equal(f.service.get(id).state, 'committed');
  assert.equal(f.service.get(id).hasInput, false); assert.equal(f.service.get(id).hasResult, false);
  assert.deepEqual(f.counts(), { disposed: 1, previews: 1, commits: 1 });
  for (const state of ['queued', 'preparing', 'running', 'preview', 'committed']) assert.ok(states.includes(state));
  for (let i = 0; i < 50; i++) f.service.cancel(f.submit());
  assert.ok(f.service.list().length <= JOB_LIMITS.summaries);
});
it('one provider at a time, bounded FIFO queue, cancelled queued jobs do not start', async () => {
  const f = fixture(); const a = f.submit(); await flushJobs();
  const b = f.submit(), c = f.submit();
  assert.throws(() => f.submit(), (e) => e.code === 'resource-limit');
  await flushJobs(); assert.equal(f.calls.length, 1);
  f.service.cancel(b); assert.equal(f.service.get(b).state, 'cancelled');
  f.calls[0].fail(new Error('private stack'));
  await flushJobs(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].id, c);
  assert.equal(f.service.get(a).error.code, 'provider-failure'); assert.doesNotMatch(f.service.get(a).error.message, /private/);
});
it('three immediate submissions reserve one active and two queued slots', async () => {
  const f = fixture(); f.submit(); f.submit(); f.submit();
  assert.throws(() => f.submit(), (e) => e.code === 'resource-limit');
  await flushJobs(); assert.equal(f.calls.length, 1);
});
it('preparing can be cancelled synchronously, before provider receives input', async () => {
  const f = fixture(); f.service.subscribe((j) => { if (j.state === 'preparing') f.service.cancel(j.id); });
  const id = f.submit(); await flushJobs(); assert.equal(f.calls.length, 0);
  assert.equal(f.service.get(id).state, 'cancelled'); assert.equal(f.service.get(id).hasInput, false);
});
for (const state of ['queued', 'running', 'preview']) it(`cancel ${state} is immediate, idempotent, releases resources and forbids accept`, async () => {
  const f = fixture(), id = f.submit();
  if (state !== 'queued') await flushJobs();
  if (state === 'preview') f.calls[0].complete(result());
  f.service.cancel(id); f.service.cancel(id);
  assert.equal(f.service.get(id).state, 'cancelled'); assert.equal(f.service.get(id).hasResult, false);
  assert.throws(() => f.service.accept(id), (e) => e.code === 'invalid-transition');
  if (f.calls.length) { f.calls[0].complete(result()); f.calls[0].complete(result()); }
  await flushJobs(); assert.equal(f.counts().commits, 0); assert.equal(f.counts().disposed, 1);
});
it('uncancellable work retains the active slot until settlement, without commit authority', async () => {
  const f = fixture({ stoppable: false }), a = f.submit(); await flushJobs();
  f.service.cancel(a); const b = f.submit(); await flushJobs();
  assert.equal(f.service.get(a).stopping, true); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].complete(result()); await flushJobs();
  assert.equal(f.calls[1].id, b); assert.equal(f.service.get(a).stopping, false); assert.equal(f.counts().previews, 0);
});
it('progress supports indeterminate, stages and genuine numeric work, ignores invalid/late updates', async () => {
  const f = fixture(), id = f.submit(); await flushJobs();
  for (const progress of [{ kind: 'indeterminate' }, { kind: 'stage', stage: 'Refining' }, { kind: 'numeric', completed: 2, total: 3 }]) {
    f.calls[0].progress(progress); assert.equal(f.service.get(id).progress.kind, progress.kind);
  }
  f.calls[0].progress({ kind: 'numeric', completed: NaN, total: 1 }); assert.equal(f.service.get(id).progress.total, 3);
  f.service.cancel(id); f.calls[0].progress({ kind: 'stage', stage: 'Late' }); assert.notEqual(f.service.get(id).progress.stage, 'Late');
});
it('A starts, B supersedes and finishes first, A finishes last and never replaces B', async () => {
  const f = fixture(), session = f.service.createSession();
  const a = f.submit({ session }); await flushJobs(); const b = f.submit({ session }); await flushJobs();
  assert.equal(f.calls.length, 2); assert.equal(f.service.get(b).revision, 2);
  f.calls[1].complete(result()); f.calls[0].complete(result()); f.calls[0].fail(new Error());
  assert.equal(f.service.get(a).state, 'cancelled'); assert.equal(f.service.get(b).state, 'preview');
  assert.equal(f.counts().previews, 1); assert.equal(f.service.accept(b), true);
});
it('duplicate completion cannot replace a preview or commit twice', async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); const first = result();
  f.calls[0].complete(first); f.calls[0].complete(result()); f.calls[0].fail(new Error());
  assert.equal(f.counts().previews, 1); f.service.accept(id); assert.throws(() => f.service.accept(id));
});
it('discard while a callback is queued leaves no retained result and ignores continuation', async () => {
  const f = fixture(), id = f.submit(); await flushJobs(); f.calls[0].complete(result());
  queueMicrotask(() => f.calls[0].complete(result())); f.service.discard(id); await flushJobs();
  assert.equal(f.service.get(id).state, 'discarded'); assert.equal(f.service.get(id).hasResult, false);
  assert.equal(f.counts().commits, 0); assert.throws(() => f.service.discard(id));
});
it('cancel immediately before and during result delivery never retains a result', async () => {
  const f = fixture(), id = f.submit(); await flushJobs();
  f.provider.copyResult = (value) => { f.service.cancel(id); return value; };
  f.calls[0].complete(result()); assert.equal(f.service.get(id).state, 'cancelled');
  assert.equal(f.service.get(id).hasResult, false); assert.equal(f.counts().previews, 0);
});
it('malformed results and thrown starts fail explicitly and unblock the queue', async () => {
  const f = fixture(), id = f.submit(); await flushJobs();
  f.provider.copyResult = () => { throw new JobError('malformed-result', 'Bad result'); };
  f.calls[0].complete(result()); assert.equal(f.service.get(id).error.code, 'malformed-result');
  f.provider.start = () => { throw new Error('crash'); }; const b = f.submit(); await flushJobs();
  assert.equal(f.service.get(b).state, 'failed');
});
for (const phase of ['queued', 'running', 'preview']) it(`stale ${phase} cannot produce history`, async () => {
  const f = fixture(), id = f.submit();
  if (phase !== 'queued') await flushJobs();
  if (phase === 'preview') f.calls[0].complete(result());
  f.stale();
  if (phase === 'queued') await flushJobs(); else if (phase === 'running') f.calls[0].complete(result()); else f.service.accept(id);
  assert.equal(f.service.get(id).state, 'stale'); assert.equal(f.service.get(id).hasResult, false); assert.equal(f.counts().commits, 0);
});
it('closing a document cancels only its jobs including preview and queue', async () => {
  const f = fixture(), a = f.submit(); await flushJobs(); f.calls[0].complete(result());
  const b = f.submit(), c = f.submit({ adapter: { ...f.adapter, capture: () => ({ documentId: 'other' }) } });
  f.service.closeDocument('doc-1'); await flushJobs();
  assert.equal(f.service.get(a).state, 'cancelled'); assert.equal(f.service.get(b).state, 'cancelled'); assert.equal(f.service.get(c).state, 'running');
});
it('invalid operations, sessions, excess bytes and object authority are rejected before capture', () => {
  const f = fixture(); f.adapter.capture = () => { throw new Error('must not capture'); };
  assert.throws(() => f.submit({ operation: 'network' }), (e) => e.code === 'unsupported-operation');
  assert.throws(() => f.submit({ session: {} }), (e) => e.code === 'invalid-request');
  f.provider.validateInput = () => JOB_LIMITS.bytes + 1;
  assert.throws(() => f.submit(), (e) => e.code === 'resource-limit');
  f.provider.validateInput = () => 0;
  assert.throws(() => f.submit({ input: { controller: () => {} } }), (e) => e.code === 'invalid-request');
});
it('copy-owned logical views avoid retaining oversized provider backing stores', async () => {
  const f = fixture(), bytes = new Uint8Array(4096).subarray(1024, 1027);
  bytes.set([7, 8, 9]); f.submit({ input: { bytes } }); await flushJobs();
  assert.equal(f.calls[0].input.bytes.buffer.byteLength, 3);
  f.calls[0].input.bytes.fill(0); assert.deepEqual([...bytes], [7, 8, 9]);
});
it('FIFO remains deterministic across successful completions and previews are bounded', async () => {
  const f = fixture(), ids = [f.submit(), f.submit(), f.submit()]; await flushJobs();
  for (let i = 0; i < ids.length; i++) { assert.equal(f.calls[i].id, ids[i]); f.calls[i].complete(result()); await flushJobs(); }
  assert.throws(() => f.submit(), (e) => e.code === 'resource-limit');
  f.service.discard(ids[0]); const next = f.submit(); await flushJobs(); assert.equal(f.calls[3].id, next);
});
it('stale queued entries release capacity immediately while another workload runs', async () => {
  const f = fixture(); f.submit(); await flushJobs(); const queued = f.submit(); f.submit();
  f.stale(); assert.equal(f.service.revalidate(queued), false);
  assert.doesNotThrow(() => f.submit());
});
it('cleanup exceptions do not retain bytes, revoke commit success, or wedge the execution slot', async () => {
  const f = fixture(), original = console.error;
  console.error = () => {};
  try {
    f.adapter.dispose = () => { throw new Error('dispose'); }; f.provider.disposeResult = () => { throw new Error('provider dispose'); };
    const first = f.submit(); await flushJobs(); const second = f.submit(); f.calls[0].complete(result());
    assert.equal(f.service.accept(first), true); assert.equal(f.service.get(first).hasResult, false);
    await flushJobs(); assert.equal(f.calls[1].id, second); f.service.cancel(second);
    assert.equal(f.service.get(second).hasInput, false);
  } finally { console.error = original; }
});
