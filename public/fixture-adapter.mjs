// This adapter only replays the public synthetic package. It never fetches weather.
export const PACKAGE_ID = 'aleph-t04-real-information-board-public-contract-v2';
export const ASSET_BASE = '/assets/t04-real-information-board-public-v1';
export const SYNTHETIC_STORAGE_KEY = 'aleph-t04-synthetic-evaluation-v1';
export const NORMALIZED_KEYS = Object.freeze([
  'signal_id', 'normalized_value', 'unit', 'source_name', 'source_url',
  'source_time', 'fetched_at', 'record_timezone', 'record_date',
]);
export const ERROR_CODES = Object.freeze(['timeout', 'auth', 'rate_limit', 'offline', 'schema_error']);
export const FIXTURE_CASES = Object.freeze([
  { id: 'T04-TIMEOUT', title: '응답 지연', errorCode: 'timeout', description: '외부 응답이 제한 시간을 넘었습니다.', action: '잠시 기다린 뒤 다시 시도해 주세요.' },
  { id: 'T04-AUTH-401', title: '외부 원천 접근 거절', errorCode: 'auth', description: '외부 데이터 원천이 요청을 거절했습니다 (401/403).', action: '출처 서비스의 접근 정책과 공개 상태를 확인한 뒤 다시 시도해 주세요.' },
  { id: 'T04-RATE-429', title: '호출 제한', errorCode: 'rate_limit', description: '외부 원천의 조회 횟수 제한에 도달했습니다 (429).', action: '원천이 안내한 대기 시간이 지난 뒤 다시 시도해 주세요.' },
  { id: 'T04-OFFLINE', title: '오프라인', errorCode: 'offline', description: '네트워크 연결이 끊어졌습니다.', action: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.' },
  { id: 'T04-SCHEMA-BREAK', title: '응답 형식 변경', errorCode: 'schema_error', description: '외부 응답의 값 또는 필수 항목 형식이 바뀌었습니다.', action: '출처 응답 형식을 확인하고 변환 규칙을 수정한 뒤 다시 시도해 주세요.' },
].map(Object.freeze));

const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new TypeError('A valid ISO-8601 date-time with timezone is required.');
  return Date.parse(value);
}

export function kstDate(value) {
  return new Date(instant(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function validateNormalizedReading(reading) {
  if (!exactKeys(reading, NORMALIZED_KEYS)) throw new TypeError('Normalized reading fields do not match the public schema.');
  if (typeof reading.signal_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(reading.signal_id) || reading.signal_id.length > 100) throw new TypeError('Invalid signal_id.');
  if (typeof reading.normalized_value !== 'number' || !Number.isFinite(reading.normalized_value)) throw new TypeError('normalized_value must be finite.');
  for (const [field, max] of [['unit', 24], ['source_name', 120]]) {
    if (typeof reading[field] !== 'string' || !reading[field].trim() || reading[field].length > max) throw new TypeError(`Invalid ${field}.`);
  }
  if (typeof reading.source_url !== 'string' || !reading.source_url.startsWith('https://') || new URL(reading.source_url).protocol !== 'https:') throw new TypeError('source_url must use HTTPS.');
  if (reading.source_time !== null) instant(reading.source_time);
  if (reading.record_timezone !== 'Asia/Seoul' || reading.record_date !== kstDate(reading.fetched_at)) throw new TypeError('record_date must be the KST fetch date.');
  return true;
}

export function validateStatus(status) {
  return exactKeys(status, ['freshness', 'error_code']) && (
    (status.freshness === 'fresh' && status.error_code === 'none')
    || (status.freshness === 'stale' && ERROR_CODES.includes(status.error_code))
  );
}

export function resetEvaluationState() {
  return {
    schema_version: 'aleph-t04-evaluation-state-v1', daily_readings: [], current_reading: null,
    status: null, last_delta: null,
    last_comparison: { state: 'insufficient', direction: null, magnitude: null, unit: null },
    last_run: null, sequence: 0,
  };
}

function comparisonFor(rows, current) {
  const previous = rows.filter((row) => row.signal_id === current.signal_id && row.record_date < current.record_date)
    .sort((left, right) => right.record_date.localeCompare(left.record_date))[0];
  if (!previous) return { state: 'insufficient', direction: null, magnitude: null, unit: null };
  if (previous.unit !== current.unit) return { state: 'unit_mismatch', direction: null, magnitude: null, unit: null };
  const signed = current.normalized_value - previous.normalized_value;
  return { state: 'comparable', direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged', magnitude: Math.abs(signed), unit: current.unit };
}

export function applySuccessfulReading(inputState, reading, runMeta = {}) {
  validateNormalizedReading(reading);
  const state = clone(inputState);
  const index = state.daily_readings.findIndex((row) => row.signal_id === reading.signal_id && row.record_date === reading.record_date);
  const existing = index >= 0 ? state.daily_readings[index] : null;
  const row = {
    record_id: existing ? existing.record_id : `demo-${reading.signal_id}-${reading.record_date}`,
    signal_id: reading.signal_id, record_date: reading.record_date, normalized_value: reading.normalized_value,
    unit: reading.unit, first_fetched_at: existing ? existing.first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at, reading: clone(reading),
  };
  if (index >= 0) state.daily_readings[index] = row;
  else state.daily_readings.push(row);
  state.daily_readings.sort((left, right) => left.record_date.localeCompare(right.record_date));
  state.current_reading = clone(reading);
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.last_comparison = comparisonFor(state.daily_readings, row);
  state.last_delta = state.last_comparison.magnitude;
  state.sequence += 1;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null, virtual_now: runMeta.virtual_now || reading.fetched_at,
    outcome: 'success', error_code: 'none', retry_after_seconds: null,
  };
  return state;
}

export function applyError(inputState, errorCode, runMeta = {}) {
  if (!ERROR_CODES.includes(errorCode)) throw new TypeError(`Unsupported error code: ${errorCode}`);
  const state = clone(inputState);
  state.status = { freshness: 'stale', error_code: errorCode };
  state.sequence += 1;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null, virtual_now: runMeta.virtual_now || null,
    outcome: 'error', error_code: errorCode, retry_after_seconds: runMeta.retry_after_seconds ?? null,
  };
  return state;
}

export function runFixture(inputState, fixture) {
  const transport = fixture.transport;
  const meta = {
    fixture_id: fixture.fixture_id, virtual_now: fixture.virtual_now,
    retry_after_seconds: transport.headers['retry-after'] ? Number(transport.headers['retry-after']) : null,
  };
  if (transport.mode === 'timeout') return applyError(inputState, 'timeout', meta);
  if (transport.mode === 'offline') return applyError(inputState, 'offline', meta);
  if (transport.status === 401 || transport.status === 403) return applyError(inputState, 'auth', meta);
  if (transport.status === 429) return applyError(inputState, 'rate_limit', meta);
  if (transport.status >= 200 && transport.status < 300) {
    try { return applySuccessfulReading(inputState, fixture.payload, meta); }
    catch { return applyError(inputState, 'schema_error', meta); }
  }
  return applyError(inputState, 'schema_error', meta);
}

// Verify downloaded bytes before parsing; expected fixture outcomes are never used
// to calculate adapter state. The state comes only from transport and payload.
export async function loadOfficialFixtures({ fetchImpl = globalThis.fetch, assetBase = ASSET_BASE } = {}) {
  const manifestResponse = await fetchImpl(`${assetBase}/asset-manifest.json`, { cache: 'no-cache' });
  if (!manifestResponse.ok) throw new Error('공식 자산 목록을 불러오지 못했습니다.');
  const manifest = await manifestResponse.json();
  if (manifest.package_id !== PACKAGE_ID || manifest.hash_algorithm !== 'sha256' || !Array.isArray(manifest.files)) throw new Error('공식 자산 목록이 올바르지 않습니다.');
  const files = manifest.files.filter((entry) => /^fixtures\/[a-z0-9-]+\.json$/.test(entry.path));
  if (files.length !== 9 || new Set(files.map((entry) => entry.path)).size !== 9) throw new Error('공식 fixture 9종이 필요합니다.');
  const results = await Promise.all(files.map(async (entry) => {
    const response = await fetchImpl(`${assetBase}/${entry.path}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`공식 fixture를 불러오지 못했습니다: ${entry.path}`);
    const bytes = await response.arrayBuffer();
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== entry.bytes || hash !== entry.sha256) throw new Error(`공식 fixture SHA-256 불일치: ${entry.path}`);
    const fixture = JSON.parse(new TextDecoder().decode(bytes));
    if (fixture.contract_version !== '1.1.0' || !/^T04-[A-Z0-9-]+$/.test(fixture.fixture_id)) throw new Error('fixture 계약 버전 또는 식별자가 올바르지 않습니다.');
    return [fixture.fixture_id, fixture];
  }));
  if (new Set(results.map(([id]) => id)).size !== 9) throw new Error('fixture 식별자가 중복되었습니다.');
  return Object.fromEntries(results);
}

export function createFixtureAdapter({ fetchImpl = globalThis.fetch, assetBase = ASSET_BASE, storage = null, onChange = () => {} } = {}) {
  // Optional persistence writes only this dedicated synthetic key. A new adapter
  // starts empty so untrusted browser storage cannot masquerade as fixture output.
  let state = resetEvaluationState();
  let generation = 0;
  let fixtures;
  let queue = Promise.resolve();
  const ready = loadOfficialFixtures({ fetchImpl, assetBase }).then((loaded) => { fixtures = loaded; });
  const getState = () => clone(state);
  const publish = () => {
    const snapshot = getState();
    if (storage) storage.setItem(SYNTHETIC_STORAGE_KEY, JSON.stringify(snapshot));
    onChange(clone(snapshot));
    return snapshot;
  };
  const reset = () => { generation += 1; state = resetEvaluationState(); return publish(); };
  const replay = (id) => {
    const replayGeneration = generation;
    const result = queue.then(async () => {
      await ready;
      if (replayGeneration !== generation) return getState();
      if (!Object.hasOwn(fixtures, id)) throw new TypeError(`Unknown official fixture: ${id}`);
      state = runFixture(state, fixtures[id]);
      return publish();
    });
    queue = result.catch(() => {});
    return result;
  };
  const baseline = async () => {
    await queue;
    reset();
    await replay('T04-NORMAL-D1-A');
    return replay('T04-NORMAL-D1-B');
  };
  return Object.freeze({
    packageId: PACKAGE_ID, ready, reset, resetEvaluationState: reset, getState, snapshot: getState,
    runFixture: replay, replay, run: replay, baseline,
    recover: () => replay('T04-RECOVER-D2'),
    runFailure: async (id) => {
      if (!FIXTURE_CASES.some((item) => item.id === id)) throw new TypeError('A failure fixture ID is required.');
      await baseline();
      return replay(id);
    },
  });
}
