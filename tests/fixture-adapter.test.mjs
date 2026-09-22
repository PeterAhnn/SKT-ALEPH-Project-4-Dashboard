import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import {
  ASSET_BASE, PACKAGE_ID, SYNTHETIC_STORAGE_KEY, FIXTURE_CASES, applySuccessfulReading,
  createFixtureAdapter, kstDate, loadOfficialFixtures, resetEvaluationState, runFixture,
  validateNormalizedReading, validateStatus,
} from '../public/fixture-adapter.mjs';

const assetDir = new URL('../public/assets/t04-real-information-board-public-v1/', import.meta.url);
const json = async (file) => JSON.parse(await fs.readFile(new URL(file, assetDir), 'utf8'));
const manifest = await json('asset-manifest.json');
const fixtureManifest = await json('fixture-manifest.json');
const fixtures = Object.fromEntries(await Promise.all(fixtureManifest.fixtures.map(async (item) => [item.fixture_id, await json(`fixtures/${item.file}`)])));
const fixture = (id) => fixtures[id];
const copy = (value) => JSON.parse(JSON.stringify(value));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => JSON.stringify(value === null || typeof value !== 'object' ? value
  : Array.isArray(value) ? value.map((item) => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(canonical(value[key]))])));

const referenceModule = { exports: {} };
vm.runInNewContext(await fs.readFile(new URL('adapter-reset.example.js', assetDir), 'utf8'), { module: referenceModule, URL, Intl });
const reference = referenceModule.exports;
const baseline = () => runFixture(runFixture(resetEvaluationState(), fixture('T04-NORMAL-D1-A')), fixture('T04-NORMAL-D1-B'));
const fileFetch = async (url) => {
  assert.ok(url.startsWith(`${ASSET_BASE}/`), 'Replay must fetch only packaged synthetic assets.');
  const filename = url.slice(ASSET_BASE.length + 1);
  assert.ok(manifest.files.some((item) => item.path === filename) || filename === 'asset-manifest.json');
  return new Response(await fs.readFile(new URL(filename, assetDir)), { status: 200 });
};

function assertExpected(state, input) {
  assert.deepEqual(state.status, { freshness: input.expected.freshness, error_code: input.expected.error_code });
  assert.equal(state.daily_readings.length, input.expected.row_count);
  assert.equal(state.current_reading?.normalized_value ?? null, input.expected.stored_value);
  assert.equal(state.last_delta, input.expected.delta);
  assert.equal(validateStatus(state.status), true);
}

test('official package: every file byte count and SHA-256 matches the manifest', async () => {
  assert.equal(manifest.package_id, PACKAGE_ID);
  assert.equal(manifest.files.length, 17);
  for (const entry of manifest.files) {
    const bytes = await fs.readFile(new URL(entry.path, assetDir));
    assert.equal(bytes.byteLength, entry.bytes, entry.path);
    assert.equal(sha(bytes), entry.sha256, entry.path);
  }
});

test('all nine canonical fixture hashes match their official registry', () => {
  assert.equal(fixtureManifest.fixtures.length, 9);
  for (const entry of fixtureManifest.fixtures) assert.equal(`sha256-${sha(canonical(fixture(entry.fixture_id)))}`, entry.canonical_sha256, entry.fixture_id);
});

test('D1-A → D1-B → third same-day success atomically updates one row and retains its ID', () => {
  const initial = resetEvaluationState();
  const first = runFixture(initial, fixture('T04-NORMAL-D1-A'));
  const second = runFixture(first, fixture('T04-NORMAL-D1-B'));
  const third = runFixture(second, fixture('T04-NORMAL-D1-B'));
  assertExpected(first, fixture('T04-NORMAL-D1-A'));
  assertExpected(second, fixture('T04-NORMAL-D1-B'));
  assert.equal(third.daily_readings.length, 1);
  assert.equal(third.daily_readings[0].normalized_value, 105);
  assert.equal(third.daily_readings[0].record_id, first.daily_readings[0].record_id);
  assert.equal(third.daily_readings[0].first_fetched_at, first.current_reading.fetched_at);
  assert.equal(third.daily_readings[0].last_fetched_at, second.current_reading.fetched_at);
  assert.deepEqual(initial, resetEvaluationState(), 'Previous state is never mutated.');
});

test('next KST date adds one row and recomputes 120 − 105 = 15', () => {
  const next = runFixture(baseline(), fixture('T04-NORMAL-D2'));
  assertExpected(next, fixture('T04-NORMAL-D2'));
  assert.deepEqual(next.daily_readings.map((row) => [row.record_date, row.normalized_value]), [['2026-08-24', 105], ['2026-08-25', 120]]);
  assert.deepEqual(next.last_comparison, { state: 'comparable', direction: 'increase', magnitude: 15, unit: 'pt' });
});

for (const item of FIXTURE_CASES) {
  test(`${item.id}: preserves 105 and original rows, marks stale/${item.errorCode}, then recovers`, () => {
    const before = baseline();
    const failed = runFixture(before, fixture(item.id));
    assertExpected(failed, fixture(item.id));
    assert.deepEqual(failed.current_reading, before.current_reading);
    assert.deepEqual(failed.daily_readings, before.daily_readings);
    const recovered = runFixture(failed, fixture('T04-RECOVER-D2'));
    assertExpected(recovered, fixture('T04-RECOVER-D2'));
    assert.equal(recovered.daily_readings.filter((row) => row.record_date === '2026-08-25').length, 1);
    const repeated = runFixture(recovered, fixture('T04-RECOVER-D2'));
    assert.equal(repeated.daily_readings.length, 2, 'Retry must not duplicate the second day.');
  });
}

test('adapter matches the unmodified reference state for all official sequences', () => {
  const sequences = [
    ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-NORMAL-D2'],
    ...FIXTURE_CASES.map(({ id }) => ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', id, 'T04-RECOVER-D2']),
  ];
  for (const sequence of sequences) {
    let actual = resetEvaluationState();
    let expected = reference.resetEvaluationState();
    for (const id of sequence) {
      actual = runFixture(actual, fixture(id));
      expected = reference.runFixture(expected, fixture(id));
      assert.deepEqual(actual, copy(expected), id);
    }
  }
});

test('401 and 403 classify as auth and rate limit preserves retry-after', () => {
  const forbidden = copy(fixture('T04-AUTH-401'));
  forbidden.transport.status = 403;
  assert.equal(runFixture(baseline(), forbidden).status.error_code, 'auth');
  const limited = runFixture(baseline(), fixture('T04-RATE-429'));
  assert.equal(limited.last_run.retry_after_seconds, Number(fixture('T04-RATE-429').transport.headers['retry-after']));
});

test('normalization rejects string values, invalid timezone, extra fields and missing fields', () => {
  const good = fixture('T04-NORMAL-D1-A').payload;
  assert.equal(validateNormalizedReading(good), true);
  for (const bad of [{ ...good, normalized_value: '100' }, { ...good, record_timezone: 'UTC' }, { ...good, extra: true }, { ...good, source_time: undefined }]) {
    assert.throws(() => validateNormalizedReading(bad));
  }
  assert.throws(() => validateNormalizedReading({ ...good, record_date: '2026-08-23' }));
  assert.throws(() => validateNormalizedReading({ ...good, source_url: 'http://example.com' }));
  assert.equal(validateStatus({ freshness: 'stale', error_code: 'none' }), false);
  assert.equal(validateStatus({ freshness: 'fresh', error_code: 'offline' }), false);
});

test('KST midnight controls the daily key and unlike units never produce a misleading delta', () => {
  assert.equal(kstDate('2026-08-24T14:59:59.000Z'), '2026-08-24');
  assert.equal(kstDate('2026-08-24T15:00:00.000Z'), '2026-08-25');
  const next = { ...fixture('T04-NORMAL-D2').payload, unit: 'different' };
  const state = applySuccessfulReading(baseline(), next);
  assert.deepEqual(state.last_comparison, { state: 'unit_mismatch', direction: null, magnitude: null, unit: null });
});

test('browser loader reads only official assets and rejects altered fixture bytes', async () => {
  const loaded = await loadOfficialFixtures({ fetchImpl: fileFetch });
  assert.deepEqual(loaded, fixtures);
  const corruptFetch = async (url) => url.endsWith('/fixtures/normal-d1-a.json')
    ? new Response(JSON.stringify({ ...fixture('T04-NORMAL-D1-A'), description_ko: 'changed' }))
    : fileFetch(url);
  await assert.rejects(loadOfficialFixtures({ fetchImpl: corruptFetch }), /SHA-256/);
});

test('browser API keeps reset/replay in a dedicated synthetic namespace', async () => {
  const storageValues = new Map([['aleph-weather-real', 'real record untouched'], ['other', 'unrelated']]);
  const writes = [];
  const storage = { setItem: (key, value) => { writes.push(key); storageValues.set(key, value); } };
  const adapter = createFixtureAdapter({ fetchImpl: fileFetch, storage });
  await adapter.ready;
  await adapter.runFailure('T04-TIMEOUT');
  assert.equal(adapter.getState().current_reading.normalized_value, 105);
  await adapter.recover();
  assert.equal(adapter.getState().daily_readings.length, 2);
  const detached = adapter.getState();
  detached.current_reading.normalized_value = 0;
  assert.equal(adapter.getState().current_reading.normalized_value, 120);
  assert.deepEqual(adapter.reset(), resetEvaluationState());
  assert.ok(writes.length > 0 && writes.every((key) => key === SYNTHETIC_STORAGE_KEY));
  assert.equal(storageValues.get('aleph-weather-real'), 'real record untouched');
  assert.equal(storageValues.get('other'), 'unrelated');
  await assert.rejects(adapter.runFixture('T04-UNKNOWN'), /Unknown official fixture/);
  assert.deepEqual(adapter.getState(), resetEvaluationState());
});

test('reset cancels earlier queued replays so an in-flight load cannot restore stale synthetic state', async () => {
  const adapter = createFixtureAdapter({ fetchImpl: fileFetch });
  const pending = adapter.runFixture('T04-NORMAL-D1-A');
  adapter.reset();
  await pending;
  assert.deepEqual(adapter.getState(), resetEvaluationState());
});
