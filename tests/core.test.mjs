import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE, AppError, kstDate, previousKstDate, validatePayload, validateWeatherPayload, fetchReading, fetchWeather,
  emptyState, applyReading, validateState, compareDays,
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

function weatherPayload() {
  const source = payload();
  return {
    ...source, latitude: 35.875, longitude: 128.625,
    current_units: { ...source.current_units, relative_humidity_2m: '%', apparent_temperature: '°C', is_day: '', precipitation: 'mm', weather_code: 'wmo code', wind_speed_10m: 'km/h' },
    current: { ...source.current, relative_humidity_2m: 72, apparent_temperature: 25.1, is_day: 1, precipitation: 0.2, weather_code: 3, wind_speed_10m: 8.4 },
    hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation_probability: '%', weather_code: 'wmo code' },
    hourly: { time: ['2026-09-22T10:00', '2026-09-22T11:00'], temperature_2m: [24.3, 25.5], precipitation_probability: [20, 30], weather_code: [3, 61] },
    daily_units: { time: 'iso8601', temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%', weather_code: 'wmo code', sunrise: 'iso8601', sunset: 'iso8601' },
    daily: { time: ['2026-09-22', '2026-09-23'], temperature_2m_max: [27.1, 26.2], temperature_2m_min: [19.2, 18.1], precipitation_probability_max: [30, 75], weather_code: [3, 63], sunrise: ['2026-09-22T06:12', '2026-09-23T06:13'], sunset: ['2026-09-22T18:23', '2026-09-23T18:22'] },
  };
}

test('KST dates roll over at UTC 15:00 and previous date respects leap years', () => {
  assert.equal(kstDate('2026-09-21T14:59:59.999Z'), '2026-09-21');
  assert.equal(kstDate('2026-09-21T15:00:00.000Z'), '2026-09-22');
  assert.equal(previousKstDate('2024-03-01'), '2024-02-29');
  assert.equal(previousKstDate('2026-01-01'), '2025-12-31');
  assertCode(() => previousKstDate('2026-02-30'), 'invalid');
});

test('normal payload becomes a traceable real reading, using fetched KST date', () => {
  const result = reading();
  assert.deepEqual(result, { value: 24.3, observedAt: '2026-09-22T10:00:00+09:00', fetchedAt: FETCHED, kstDate: '2026-09-22', sourceId: SOURCE.id, sourceUrl: SOURCE.url, unit: '°C', kind: 'real' });
  assert.equal(reading(24, '2026-09-21T15:00:00.000Z', '2026-09-21T23:59').kstDate, '2026-09-22');
});

test('Daegu request includes keyless current, hourly and seven-day fields and rejects another city', () => {
  const url = new URL(SOURCE.url);
  assert.equal(url.searchParams.get('latitude'), '35.8714');
  assert.equal(url.searchParams.get('longitude'), '128.6014');
  assert.equal(url.searchParams.get('forecast_days'), '7');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Seoul');
  assert.match(url.searchParams.get('current'), /relative_humidity_2m/);
  assert.match(url.searchParams.get('hourly'), /precipitation_probability/);
  assert.match(url.searchParams.get('daily'), /sunrise,sunset/);
  assert.equal(url.searchParams.has('apikey'), false);
  assertCode(() => validatePayload({ ...payload(), latitude: 37.5665, longitude: 126.9780 }, FETCHED), 'invalid');
  assertCode(() => validatePayload({ ...payload(), latitude: 35.8714 }, FETCHED), 'invalid');
  const state = populated();
  assertCode(() => validateState({ ...state, version: 1 }), 'invalid');
  assertCode(() => applyReading(state, { ...reading(), sourceId: 'open-meteo-seoul' }), 'invalid');
  assertCode(() => applyReading(state, { ...reading(), sourceUrl: 'https://api.open-meteo.com/v1/forecast?latitude=37.5665' }), 'invalid');
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
  for (const status of [401, 403]) await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: false, status }) }), { code: 'auth' });
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: false, status: 429 }) }), { code: 'rate' });
  let called = false;
  await assert.rejects(fetchReading({ online: () => false, fetchImpl: async () => { called = true; } }), { code: 'offline' });
  assert.equal(called, false);
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('broken JSON'); } }) }), { code: 'invalid' });
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: true, json: async () => { throw new TypeError('connection interrupted'); } }) }), { code: 'network' });
});

test('deadline covers a stalled request and a stalled response body', async () => {
  let signal;
  await assert.rejects(fetchReading({ fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); }, timeoutMs: 10 }), { code: 'timeout' });
  assert.equal(signal.aborted, true);
  await assert.rejects(fetchReading({ fetchImpl: async () => ({ ok: true, json: async () => new Promise(() => {}) }), timeoutMs: 10 }), { code: 'timeout' });
});

test('same-day successes update one daily row and lastGood without mutating callers or accepting older data', () => {
  const initial = populated();
  const before = structuredClone(initial);
  const later = reading(25.8, '2026-09-22T03:05:00.000Z', '2026-09-22T12:00');
  const next = applyReading(initial, later);
  assert.deepEqual(initial, before);
  assert.equal(next.days.length, 1);
  assert.equal(next.days[0].value, 25.8);
  assert.equal(next.lastGood.value, 25.8);
  assert.deepEqual(applyReading(next, reading()), next);
  const third = reading(26.1, '2026-09-22T04:05:00.000Z', '2026-09-22T13:00');
  const updated = applyReading(next, third);
  assert.equal(updated.days.length, 1);
  assert.deepEqual(updated.days[0], third);
  assert.deepEqual(updated.lastGood, third);
  const tomorrow = reading(23.7, '2026-09-23T01:05:00.000Z', '2026-09-23T10:00');
  const nextDay = applyReading(updated, tomorrow);
  assert.equal(nextDay.days.length, 2);
  assert.deepEqual(nextDay.days[1], tomorrow);
  assert.equal(compareDays(nextDay.days, '2026-09-23').delta, -2.4);
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
    null, [], {}, { ...state, version: 1 }, { ...state, extra: true }, { ...state, days: {} },
    { ...state, lastGood: null }, { ...state, days: [] }, { ...state, days: [state.days[0], state.days[0]] },
    { ...state, lastGood: { ...state.lastGood, value: 9 } },
    { ...state, lastGood: reading(25.8, '2026-09-22T03:05:00.000Z', '2026-09-22T12:00') },
  ];
  for (const change of [{ kind: 'synthetic' }, { kstDate: '2026-09-21' }, { sourceId: 'unknown' }, { value: NaN }, { unit: '°F' }, { fetchedAt: '2026-09-22T01:05:00Z' }, { observedAt: '2026-02-30T10:00:00+09:00' }, { extra: true }]) {
    corruptions.push({ ...state, days: [{ ...state.days[0], ...change }] });
    assertCode(() => applyReading(state, { ...reading(), ...change }), 'invalid');
  }
  for (const candidate of corruptions) assertCode(() => validateState(candidate), 'invalid');
  const clean = validateState(state);
  clean.days[0].value = 0;
  assert.equal(state.days[0].value, 24.3);
  assertCode(() => validateState(state, { now: '2026-09-22T00:59:59.000Z' }), 'invalid');
  assert.deepEqual(validateState(state, { now: FETCHED }), state);
});

test('weather bundle uses one source response and preserves exact primary reading with normalized forecast context', async () => {
  let calls = 0;
  const result = await fetchWeather({ fetchImpl: async (url) => { calls += 1; assert.equal(url, SOURCE.url); return { ok: true, json: async () => weatherPayload() }; }, now: () => FETCHED });
  assert.equal(calls, 1);
  assert.deepEqual(result.reading, reading());
  assert.equal(result.fetchedAt, FETCHED);
  assert.deepEqual(result.current, { temperature: 24.3, observedAt: '2026-09-22T10:00:00+09:00', status: 'available', error: null, relativeHumidity: 72, apparentTemperature: 25.1, isDay: 1, precipitation: 0.2, weatherCode: 3, windSpeed: 8.4 });
  assert.deepEqual(result.hourly[0], { time: '2026-09-22T10:00:00+09:00', temperature: 24.3, precipitationProbability: 20, weatherCode: 3 });
  assert.deepEqual(result.daily[0], { date: '2026-09-22', temperatureMax: 27.1, temperatureMin: 19.2, precipitationProbabilityMax: 30, weatherCode: 3, sunrise: '2026-09-22T06:12:00+09:00', sunset: '2026-09-22T18:23:00+09:00' });
  assert.deepEqual(result.forecast, { status: 'available', error: null, message: null, hourlyStatus: 'available', dailyStatus: 'available' });
});

test('missing or malformed forecasts preserve valid current temperature and daily storage', () => {
  const absent = validateWeatherPayload(payload(), FETCHED);
  assert.deepEqual(absent.reading, reading());
  assert.equal(absent.current.temperature, 24.3);
  assert.equal(absent.current.relativeHumidity, null);
  assert.equal(absent.current.status, 'partial');
  assert.equal(absent.forecast.status, 'unavailable');
  assert.equal(absent.forecast.error, 'invalid');
  assert.deepEqual(absent.hourly, []);
  assert.deepEqual(absent.daily, []);
  assert.equal(applyReading(emptyState(), absent.reading).days.length, 1);
  const invalidPrimary = weatherPayload();
  invalidPrimary.current.temperature_2m = 'unavailable';
  assertCode(() => validateWeatherPayload(invalidPrimary, FETCHED), 'invalid');
});

test('hourly corruption never leaks invalid fields and does not discard valid daily forecasts', () => {
  const mutations = [
    (p) => { p.hourly.temperature_2m[0] = null; },
    (p) => { p.hourly.temperature_2m[0] = Infinity; },
    (p) => { p.hourly.precipitation_probability[0] = 101; },
    (p) => { p.hourly.weather_code[0] = 100; },
    (p) => { p.hourly.time[1] = p.hourly.time[0]; },
    (p) => { p.hourly.time[0] = '2026-09-22T24:00'; },
    (p) => { p.hourly.time[0] = '2026-09-22T10:30'; },
    (p) => { p.hourly.time[0] = '2026-09-21T10:00'; },
    (p) => { p.hourly.temperature_2m.pop(); },
    (p) => { p.hourly_units.temperature_2m = '°F'; },
    (p) => { delete p.hourly.temperature_2m[0]; },
  ];
  for (const mutate of mutations) {
    const p = weatherPayload();
    mutate(p);
    const result = validateWeatherPayload(p, FETCHED);
    assert.equal(result.forecast.status, 'partial');
    assert.equal(result.forecast.hourlyStatus, 'unavailable');
    assert.deepEqual(result.hourly, []);
    assert.equal(result.daily.length, 2);
    assert.deepEqual(result.reading, reading());
  }
});

test('daily forecasts require coherent dates, units, finite values, min/max and same-day sunrise/sunset', () => {
  const mutations = [
    (p) => { p.daily.temperature_2m_max[0] = NaN; },
    (p) => { p.daily.temperature_2m_min[0] = 50; },
    (p) => { p.daily.precipitation_probability_max[0] = -1; },
    (p) => { p.daily.weather_code[0] = 4; },
    (p) => { p.daily.time[1] = p.daily.time[0]; },
    (p) => { p.daily.time[0] = '2026-02-30'; },
    (p) => { p.daily.sunrise[0] = '2026-09-23T06:00'; },
    (p) => { p.daily.sunset[0] = '2026-09-22T05:00'; },
    (p) => { p.daily_units.precipitation_probability_max = 'mm'; },
  ];
  for (const mutate of mutations) {
    const p = weatherPayload();
    mutate(p);
    const result = validateWeatherPayload(p, FETCHED);
    assert.equal(result.forecast.status, 'partial');
    assert.equal(result.forecast.dailyStatus, 'unavailable');
    assert.deepEqual(result.daily, []);
    assert.equal(result.hourly.length, 2);
    assert.deepEqual(result.reading, reading());
  }
});

test('invalid auxiliary current values become unavailable without affecting the primary record or good fields', () => {
  const p = weatherPayload();
  p.current.relative_humidity_2m = '72';
  p.current_units.wind_speed_10m = 'mph';
  p.current.weather_code = 4;
  const result = validateWeatherPayload(p, FETCHED);
  assert.equal(result.current.relativeHumidity, null);
  assert.equal(result.current.windSpeed, null);
  assert.equal(result.current.weatherCode, null);
  assert.equal(result.current.apparentTemperature, 25.1);
  assert.equal(result.current.status, 'partial');
  assert.equal(result.forecast.status, 'available');
  assert.deepEqual(result.reading, reading());
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
