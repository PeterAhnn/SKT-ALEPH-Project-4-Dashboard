import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE, AppError, kstDate, previousKstDate, validatePayload, fetchReading,
  emptyState, applyReading, validateState, compareDays, FAILURE_CASES, replayFailure,
} from '../public/core.mjs';

const FETCHED = '2026-09-22T01:05:00.000Z';
function payload(value = 24.3, time = '2026-09-22T10:00') {
  return { timezone: 'Asia/Seoul', utc_offset_seconds: 32400, current_units: { temperature_2m: '°C' }, current: { time, temperature_2m: value } };
}
function reading(value = 24.3, fetchedAt = FETCHED, time = '2026-09-22T10:00') {
  return validatePayload(payload(value, time), fetchedAt);
}
function populated() { return applyReading(emptyState(), reading()); }
function assertCode(fn, code) { assert.throws(fn, (error) => error instanceof AppError && error.code === code); }

test('KST dates roll over at UTC 15:00 and previous date respects leap years', () => {
  assert.equal(kstDate('2026-09-21T14:59:59.999Z'), '2026-09-21');
  assert.equal(kstDate('2026-09-21T15:00:00.000Z'), '2026-09-22');
  assert.equal(previousKstDate('2024-03-01'), '2024-02-29');
  assert.equal(previousKstDate('2026-01-01'), '2025-12-31');
  assertCode(() => previousKstDate('2026-02-30'), 'invalid');
});

test('normal payload becomes a traceable real reading, using fetched KST date', () => {
  const result = reading();
  assert.deepEqual(result, { value: 24.3, observedAt: '2026-09-22T10:00:00+09:00', fetchedAt: FETCHED, kstDate: '2026-09-22', sourceId: SOURCE.id, unit: '°C', kind: 'real' });
  assert.equal(reading(24, '2026-09-21T15:00:00.000Z', '2026-09-21T23:59').kstDate, '2026-09-22');
});

test('reject malformed, missing, non-finite, wrong-unit and wrong-timezone payloads', () => {
  const cases = [null, [], {}, payload('24'), payload(null), payload(NaN), payload(Infinity), payload(-80.1), payload(60.1), payload(0, '2026-02-30T10:00'), payload(0, '2026-09-22T24:00')];
  cases.push({ ...payload(), timezone: 'UTC' }, { ...payload(), utc_offset_seconds: 0 }, { ...payload(), current_units: { temperature_2m: '°F' } });
  for (const candidate of cases) assertCode(() => validatePayload(candidate, FETCHED), 'invalid');
  assertCode(() => validatePayload(payload(), '2026-09-22 01:05'), 'invalid');
});

test('stale and future observations cannot replace a normal reading', () => {
  assertCode(() => reading(24, FETCHED, '2026-09-22T08:04'), 'stale');
  assertCode(() => reading(24, FETCHED, '2026-09-22T10:11'), 'invalid');
  assert.equal(reading(24, FETCHED, '2026-09-22T08:05').value, 24);
  assert.equal(reading(24, FETCHED, '2026-09-22T10:10').value, 24);
});

test('fetch uses the declared source and classifies the full response flow', async () => {
  let requested;
  const result = await fetchReading({ fetchImpl: async (url, options) => { requested = { url, options }; return { ok: true, json: async () => payload() }; }, now: () => FETCHED });
  assert.equal(requested.url, SOURCE.url);
  assert.equal(requested.options.cache, 'no-store');
  assert.equal(requested.options.signal.aborted, false);
  assert.deepEqual(result, reading());
  await assert.rejects(fetchReading({ fetchImpl: async () => { throw new TypeError('offline'); } }), { code: 'network' });
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: false, status: 503 }) }), { code: 'http' });
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('broken JSON'); } }) }), { code: 'invalid' });
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: true, json: async () => { throw new TypeError('connection interrupted'); } }) }), { code: 'network' });
});

test('deadline covers a stalled request and a stalled response body', async () => {
  let signal;
  await assert.rejects(fetchReading({ fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); }, timeoutMs: 10 }), { code: 'timeout' });
  assert.equal(signal.aborted, true);
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: true, json: async () => new Promise(() => {}) }), timeoutMs: 10 }), { code: 'timeout' });
});

test('first daily reading stays fixed while lastGood advances, without mutating callers', () => {
  const initial = populated();
  const before = structuredClone(initial);
  const later = reading(25.8, '2026-09-22T03:05:00.000Z', '2026-09-22T12:00');
  const next = applyReading(initial, later);
  assert.deepEqual(initial, before);
  assert.equal(next.days.length, 1);
  assert.equal(next.days[0].value, 24.3);
  assert.equal(next.lastGood.value, 25.8);
  assert.deepEqual(applyReading(next, reading()), next);
  assertCode(() => applyReading(next, { ...later, value: 20 }), 'invalid');
});

test('older day import preserves latest normal value and produces sorted days', () => {
  const next = applyReading(populated(), reading(22.1, '2026-09-21T01:05:00.000Z', '2026-09-21T10:00'));
  assert.deepEqual(next.days.map((item) => item.kstDate), ['2026-09-21', '2026-09-22']);
  assert.equal(next.lastGood.value, 24.3);
  assert.equal(compareDays(next.days, '2026-09-22').delta, 2.2);
});

test('state validation rejects corrupt shape, fabricated kinds, dates and inconsistent lastGood', () => {
  const state = populated();
  const corruptions = [
    null, [], {}, { ...state, version: 2 }, { ...state, extra: true }, { ...state, days: {} },
    { ...state, lastGood: null }, { ...state, days: [] }, { ...state, days: [state.days[0], state.days[0]] },
    { ...state, lastGood: { ...state.lastGood, value: 9 } },
  ];
  for (const change of [{ kind: 'synthetic' }, { kstDate: '2026-09-21' }, { sourceId: 'unknown' }, { value: NaN }, { unit: '°F' }, { fetchedAt: '2026-09-22T01:05:00Z' }, { observedAt: '2026-02-30T10:00:00+09:00' }, { extra: true }]) {
    corruptions.push({ ...state, days: [{ ...state.days[0], ...change }] });
    assertCode(() => applyReading(state, { ...reading(), ...change }), 'invalid');
  }
  for (const candidate of corruptions) assertCode(() => validateState(candidate), 'invalid');
  const clean = validateState(state);
  clean.days[0].value = 0;
  assert.equal(state.days[0].value, 24.3);
});

test('comparison requires the exact preceding KST date and never fills missing days', () => {
  const older = reading(20, '2026-09-20T01:05:00.000Z', '2026-09-20T10:00');
  const state = applyReading(populated(), older);
  const missingYesterday = compareDays(state.days, '2026-09-22');
  assert.equal(missingYesterday.available, false);
  assert.equal(missingYesterday.previous, null);
  assert.equal(missingYesterday.delta, null);
  assert.match(missingYesterday.reason, /어제/);
  assert.match(compareDays(state.days, '2026-09-23').reason, /오늘/);
  assert.equal(state.days.length, 2);
});

test('all five synthetic failures exercise fetch validation while preserving real and empty state', async () => {
  assert.equal(FAILURE_CASES.length, 5);
  for (const state of [emptyState(), populated()]) {
    const before = structuredClone(state);
    for (const failure of FAILURE_CASES) {
      const result = await replayFailure(failure.id, state);
      assert.equal(result.code, failure.id);
      assert.equal(result.preserved, true);
      assert.deepEqual(result.state, before);
      assert.deepEqual(state, before);
      assert.ok(result.message.length > 0);
    }
  }
  await assert.rejects(replayFailure('unknown', emptyState()), { code: 'invalid' });
});
