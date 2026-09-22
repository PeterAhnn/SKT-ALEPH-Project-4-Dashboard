export const SOURCE = Object.freeze({
  id: 'open-meteo-seoul',
  name: 'Open-Meteo · 서울 현재 기온',
  url: 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m&timezone=Asia%2FSeoul&forecast_days=1',
  attributionUrl: 'https://open-meteo.com/',
  unit: '°C',
  location: '서울 · 중구 기준 (37.5665, 126.9780)',
});

const KST_OFFSET = 9 * 60 * 60 * 1000;
const MAX_AGE = 2 * 60 * 60 * 1000;
const FUTURE_TOLERANCE = 5 * 60 * 1000;
const READING_KEYS = ['value', 'observedAt', 'fetchedAt', 'kstDate', 'sourceId', 'unit', 'kind'];
const ERROR_MESSAGES = Object.freeze({
  network: '원천에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  timeout: '정해진 시간 안에 응답이 오지 않았습니다. 잠시 후 다시 시도해 주세요.',
  http: '원천 서버가 오류 응답을 보냈습니다. 잠시 후 다시 시도해 주세요.',
  invalid: '응답의 값·단위·시간이 올바르지 않아 새 값으로 저장하지 않았습니다.',
  stale: '원천 데이터가 2시간보다 오래되어 새 값으로 저장하지 않았습니다.',
});

export class AppError extends Error {
  constructor(code, message = ERROR_MESSAGES[code], options) {
    super(message || ERROR_MESSAGES.invalid, options);
    this.name = 'AppError';
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'invalid';
  }
}

function invalid(message = ERROR_MESSAGES.invalid) {
  return new AppError('invalid', message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

// Verify the calendar components too: Date.parse alone accepts February 30.
function parseInstant(iso) {
  if (typeof iso !== 'string') throw invalid('올바른 시각 문자열이 필요합니다.');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!match || !validDate(match[1])) throw invalid('날짜 또는 시각 형식이 올바르지 않습니다.');
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59) throw invalid('시각 범위가 올바르지 않습니다.');
  if (match[6] !== 'Z' && (+match[6].slice(1, 3) > 23 || +match[6].slice(4, 6) > 59)) {
    throw invalid('시간대 오프셋이 올바르지 않습니다.');
  }
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) throw invalid('시각을 읽을 수 없습니다.');
  return time;
}

export function kstDate(iso) {
  return new Date(parseInstant(iso) + KST_OFFSET).toISOString().slice(0, 10);
}

export function previousKstDate(date) {
  if (!validDate(date)) throw invalid('비교할 KST 날짜가 올바르지 않습니다.');
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}

function normalizeObservedTime(time) {
  if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(time)) {
    throw invalid('원천의 관측 시각이 올바르지 않습니다.');
  }
  const complete = time.length === 16 ? `${time}:00+09:00` : `${time}+09:00`;
  const parsed = parseInstant(complete);
  return `${new Date(parsed + KST_OFFSET).toISOString().slice(0, 19)}+09:00`;
}

function validateAge(observedAt, fetchedAt) {
  const age = parseInstant(fetchedAt) - parseInstant(observedAt);
  if (age < -FUTURE_TOLERANCE) throw invalid('원천 시각이 수집 시각보다 5분 넘게 미래입니다.');
  if (age > MAX_AGE) throw new AppError('stale');
}

export function validatePayload(payload, fetchedAt) {
  const fetched = new Date(parseInstant(fetchedAt)).toISOString();
  if (!isObject(payload) || !isObject(payload.current) || !isObject(payload.current_units)
    || payload.timezone !== 'Asia/Seoul' || payload.utc_offset_seconds !== 32400
    || payload.current_units.temperature_2m !== SOURCE.unit) {
    throw invalid();
  }
  const value = payload.current.temperature_2m;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -80 || value > 60) throw invalid();
  const observedAt = normalizeObservedTime(payload.current.time);
  validateAge(observedAt, fetched);
  return { value, observedAt, fetchedAt: fetched, kstDate: kstDate(fetched), sourceId: SOURCE.id, unit: SOURCE.unit, kind: 'real' };
}

export async function fetchReading({ fetchImpl = globalThis.fetch, timeoutMs = 8000, now = () => new Date().toISOString() } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function'
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw invalid('조회 설정이 올바르지 않습니다.');
  const controller = new AbortController();
  let timeout;
  let timedOut = false;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new AppError('timeout'));
    }, timeoutMs);
  });
  const request = async () => {
    let response;
    try {
      response = await fetchImpl(SOURCE.url, { signal: controller.signal, cache: 'no-store' });
    } catch (error) {
      throw new AppError(timedOut ? 'timeout' : 'network', undefined, { cause: error });
    }
    if (!response || response.ok !== true) throw new AppError('http');
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError(timedOut ? 'timeout' : error instanceof TypeError ? 'network' : 'invalid', undefined, { cause: error });
    }
    return validatePayload(payload, now());
  };
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

export function emptyState() {
  return { version: 1, lastGood: null, days: [] };
}

function validateReading(reading) {
  if (!hasExactKeys(reading, READING_KEYS) || reading.kind !== 'real'
    || reading.sourceId !== SOURCE.id || reading.unit !== SOURCE.unit
    || typeof reading.value !== 'number' || !Number.isFinite(reading.value)
    || reading.value < -80 || reading.value > 60 || !validDate(reading.kstDate)) {
    throw invalid('기록의 값·원천·단위·종류가 올바르지 않습니다.');
  }
  const fetched = parseInstant(reading.fetchedAt);
  if (new Date(fetched).toISOString() !== reading.fetchedAt
    || typeof reading.observedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(reading.observedAt)
    || reading.kstDate !== kstDate(reading.fetchedAt)) {
    throw invalid('기록의 시각 또는 KST 날짜가 일치하지 않습니다.');
  }
  validateAge(reading.observedAt, reading.fetchedAt);
  return { ...reading };
}

function equalReading(a, b) {
  return READING_KEYS.every((key) => a[key] === b[key]);
}

export function validateState(state) {
  if (!hasExactKeys(state, ['version', 'lastGood', 'days']) || state.version !== 1 || !Array.isArray(state.days)) {
    throw invalid('저장 자료의 구조 또는 버전이 올바르지 않습니다.');
  }
  const days = state.days.map(validateReading);
  for (let index = 1; index < days.length; index += 1) {
    if (days[index - 1].kstDate >= days[index].kstDate) throw invalid('일별 기록은 중복 없이 날짜순이어야 합니다.');
  }
  if (days.length === 0) {
    if (state.lastGood !== null) throw invalid('마지막 정상값에 해당하는 일별 기록이 없습니다.');
    return emptyState();
  }
  const lastGood = validateReading(state.lastGood);
  const latestDay = days.at(-1);
  if (lastGood.kstDate !== latestDay.kstDate || lastGood.fetchedAt < latestDay.fetchedAt
    || (lastGood.fetchedAt === latestDay.fetchedAt && !equalReading(lastGood, latestDay))) {
    throw invalid('마지막 정상값과 일별 기록이 일치하지 않습니다.');
  }
  return { version: 1, lastGood, days };
}

export function applyReading(state, reading) {
  const cleanState = validateState(state);
  const cleanReading = validateReading(reading);
  const existingDay = cleanState.days.find((day) => day.kstDate === cleanReading.kstDate);
  // Existing first-success records are immutable, even if an older record is imported later.
  if (!existingDay) cleanState.days.push({ ...cleanReading });
  cleanState.days.sort((a, b) => a.kstDate.localeCompare(b.kstDate));
  if (!cleanState.lastGood || cleanReading.fetchedAt > cleanState.lastGood.fetchedAt) {
    cleanState.lastGood = { ...cleanReading };
  } else if (cleanReading.fetchedAt === cleanState.lastGood.fetchedAt && !equalReading(cleanReading, cleanState.lastGood)) {
    throw invalid('같은 수집 시각에 서로 다른 값이 있어 기록하지 않았습니다.');
  }
  return validateState(cleanState);
}

export function compareDays(days, date) {
  if (!Array.isArray(days) || !validDate(date)) throw invalid('비교 자료가 올바르지 않습니다.');
  const records = days.map(validateReading);
  if (new Set(records.map((day) => day.kstDate)).size !== records.length) throw invalid('같은 날짜의 비교 기록이 중복되었습니다.');
  const current = records.find((day) => day.kstDate === date) || null;
  const previous = records.find((day) => day.kstDate === previousKstDate(date)) || null;
  if (!current) return { available: false, current, previous, delta: null, reason: '오늘 KST 날짜의 실제 기록이 아직 없습니다.' };
  if (!previous) return { available: false, current, previous, delta: null, reason: '어제 KST 날짜의 실제 기록이 없어 변화값을 계산하지 않습니다.' };
  const delta = Math.round((current.value - previous.value) * 1_000_000) / 1_000_000;
  return { available: true, current, previous, delta, reason: null };
}

export const FAILURE_CASES = Object.freeze([
  { id: 'network', title: '연결 실패', description: '인터넷 연결 또는 원천 연결이 끊어진 경우를 합성 재생합니다.' },
  { id: 'timeout', title: '응답 지연', description: '응답이 제한 시간 안에 도착하지 않는 경우를 합성 재생합니다.' },
  { id: 'http', title: '서버 오류', description: '원천이 HTTP 503 오류로 응답하는 경우를 합성 재생합니다.' },
  { id: 'invalid', title: '잘못된 데이터', description: '기온 자리에 숫자가 아닌 값이 오는 경우를 합성 재생합니다.' },
  { id: 'stale', title: '오래된 데이터', description: '원천 시각이 수집 시각보다 3시간 오래된 경우를 합성 재생합니다.' },
].map(Object.freeze));

export async function replayFailure(id, state) {
  if (!FAILURE_CASES.some((failure) => failure.id === id)) throw invalid('알 수 없는 합성 실패 종류입니다.');
  const snapshot = validateState(state);
  const before = JSON.stringify(snapshot);
  const fetchedAt = new Date().toISOString();
  const observedTime = new Date(Date.parse(fetchedAt) + KST_OFFSET - (id === 'stale' ? 3 * 60 * 60 * 1000 : 0)).toISOString().slice(0, 19);
  const payload = {
    timezone: 'Asia/Seoul', utc_offset_seconds: 32400,
    current_units: { temperature_2m: SOURCE.unit },
    current: { time: observedTime, temperature_2m: id === 'invalid' ? '값 없음' : 20 },
  };
  const fetchImpl = async (_url, { signal }) => {
    if (id === 'network') throw new TypeError('Synthetic network failure');
    if (id === 'timeout') {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Synthetic timeout')), { once: true }));
    }
    return { ok: id !== 'http', status: id === 'http' ? 503 : 200, json: async () => payload };
  };
  try {
    await fetchReading({ fetchImpl, timeoutMs: 30, now: () => fetchedAt });
    throw invalid('실패 재생이 예상과 달리 성공했습니다. 실제 기록에는 저장하지 않았습니다.');
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== id) throw error;
    return { code: error.code, message: error.message, preserved: before === JSON.stringify(snapshot) && before === JSON.stringify(validateState(state)), state: snapshot };
  }
}
