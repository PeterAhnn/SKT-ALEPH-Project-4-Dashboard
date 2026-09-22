export const SOURCE = Object.freeze({
  id: 'open-meteo-daegu',
  name: 'Open-Meteo · 대구 현재 기온과 예보',
  url: 'https://api.open-meteo.com/v1/forecast?latitude=35.8714&longitude=128.6014&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=Asia%2FSeoul&forecast_days=7',
  attributionUrl: 'https://open-meteo.com/',
  unit: '°C',
  location: '대구 · 중구 기준 (35.8714, 128.6014)',
  latitude: 35.8714,
  longitude: 128.6014,
});

const KST_OFFSET = 9 * 60 * 60 * 1000;
const MAX_AGE = 2 * 60 * 60 * 1000;
const FUTURE_TOLERANCE = 5 * 60 * 1000;
const READING_KEYS = ['value', 'observedAt', 'fetchedAt', 'kstDate', 'sourceId', 'sourceUrl', 'unit', 'kind'];
const WEATHER_CODES = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
const ERROR_MESSAGES = Object.freeze({
  network: '원천에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  offline: '현재 브라우저가 오프라인입니다. 인터넷 연결을 복구한 뒤 다시 시도해 주세요.',
  timeout: '정해진 시간 안에 응답이 오지 않았습니다. 잠시 후 다시 시도해 주세요.',
  auth: '외부 원천이 요청을 거절했습니다(401/403). 원천의 공개 접근 상태를 확인한 뒤 다시 시도해 주세요.',
  rate: '외부 원천의 호출 한도에 도달했습니다(429). 연속 조회를 멈추고 잠시 후 다시 시도해 주세요.',
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

function finiteInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
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
  // Open-Meteo returns the model grid centre rather than the requested point.
  if ((Object.hasOwn(payload, 'latitude') || Object.hasOwn(payload, 'longitude'))
    && (!finiteInRange(payload.latitude, SOURCE.latitude - 0.25, SOURCE.latitude + 0.25)
      || !finiteInRange(payload.longitude, SOURCE.longitude - 0.25, SOURCE.longitude + 0.25))) {
    throw invalid('대구 기준 위치와 다른 응답은 저장하지 않습니다.');
  }
  const value = payload.current.temperature_2m;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -80 || value > 60) throw invalid();
  const observedAt = normalizeObservedTime(payload.current.time);
  validateAge(observedAt, fetched);
  return { value, observedAt, fetchedAt: fetched, kstDate: kstDate(fetched), sourceId: SOURCE.id, sourceUrl: SOURCE.url, unit: SOURCE.unit, kind: 'real' };
}

function normalizeCurrent(payload, reading) {
  const details = {
    relativeHumidity: ['relative_humidity_2m', '%', (value) => finiteInRange(value, 0, 100)],
    apparentTemperature: ['apparent_temperature', SOURCE.unit, (value) => finiteInRange(value, -100, 80)],
    isDay: ['is_day', '', (value) => value === 0 || value === 1],
    precipitation: ['precipitation', 'mm', (value) => finiteInRange(value, 0, 2000)],
    weatherCode: ['weather_code', 'wmo code', (value) => WEATHER_CODES.has(value)],
    windSpeed: ['wind_speed_10m', 'km/h', (value) => finiteInRange(value, 0, 500)],
  };
  const result = { temperature: reading.value, observedAt: reading.observedAt, status: 'available', error: null };
  for (const [name, [field, unit, validator]] of Object.entries(details)) {
    const value = payload.current[field];
    if (payload.current_units[field] === unit && validator(value)) result[name] = value;
    else {
      result[name] = null;
      result.status = 'partial';
      result.error = '현재 날씨의 일부 상세 값이 없거나 형식이 달라 표시하지 않습니다.';
    }
  }
  return result;
}

function validateSeries(payload, section, fields, maxLength) {
  const values = payload[section];
  const units = payload[`${section}_units`];
  if (!isObject(values) || !isObject(units) || units.time !== 'iso8601'
    || !Array.isArray(values.time) || values.time.length === 0 || values.time.length > maxLength) throw invalid();
  for (const [field, unit, validator] of fields) {
    if (units[field] !== unit || !Array.isArray(values[field]) || values[field].length !== values.time.length
      || !Array.from(values[field]).every(validator)) throw invalid();
  }
  return values;
}

function normalizeHourly(payload, fetchedAt) {
  const values = validateSeries(payload, 'hourly', [
    ['temperature_2m', SOURCE.unit, (value) => finiteInRange(value, -80, 60)],
    ['precipitation_probability', '%', (value) => finiteInRange(value, 0, 100)],
    ['weather_code', 'wmo code', (value) => WEATHER_CODES.has(value)],
  ], 168);
  const start = Date.parse(`${kstDate(fetchedAt)}T00:00:00+09:00`);
  let previous = null;
  return Array.from(values.time).map((time, index) => {
    const normalized = normalizeObservedTime(time);
    const instant = parseInstant(normalized);
    if (!normalized.endsWith(':00:00+09:00') || instant < start || instant >= start + 7 * 86_400_000
      || (previous !== null && instant - previous !== 3_600_000)) throw invalid();
    previous = instant;
    return { time: normalized, temperature: values.temperature_2m[index], precipitationProbability: values.precipitation_probability[index], weatherCode: values.weather_code[index] };
  });
}

function normalizeDaily(payload, fetchedAt) {
  const values = validateSeries(payload, 'daily', [
    ['temperature_2m_max', SOURCE.unit, (value) => finiteInRange(value, -80, 60)],
    ['temperature_2m_min', SOURCE.unit, (value) => finiteInRange(value, -80, 60)],
    ['precipitation_probability_max', '%', (value) => finiteInRange(value, 0, 100)],
    ['weather_code', 'wmo code', (value) => WEATHER_CODES.has(value)],
    ['sunrise', 'iso8601', (value) => typeof value === 'string'],
    ['sunset', 'iso8601', (value) => typeof value === 'string'],
  ], 7);
  const start = Date.parse(`${kstDate(fetchedAt)}T00:00:00.000Z`);
  return Array.from(values.time).map((date, index) => {
    const expected = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    if (!validDate(date) || date !== expected) throw invalid();
    const sunrise = normalizeObservedTime(values.sunrise[index]);
    const sunset = normalizeObservedTime(values.sunset[index]);
    if (kstDate(sunrise) !== date || kstDate(sunset) !== date || parseInstant(sunrise) >= parseInstant(sunset)
      || values.temperature_2m_min[index] > values.temperature_2m_max[index]) throw invalid();
    return { date, weatherCode: values.weather_code[index], temperatureMax: values.temperature_2m_max[index], temperatureMin: values.temperature_2m_min[index], precipitationProbabilityMax: values.precipitation_probability_max[index], sunrise, sunset };
  });
}

export function validateWeatherPayload(payload, fetchedAt) {
  const reading = validatePayload(payload, fetchedAt);
  const current = normalizeCurrent(payload, reading);
  let hourly = [], daily = [];
  // Auxiliary forecasts must never discard an otherwise valid current reading.
  try { hourly = normalizeHourly(payload, reading.fetchedAt); } catch (error) { if (!(error instanceof AppError)) throw error; }
  try { daily = normalizeDaily(payload, reading.fetchedAt); } catch (error) { if (!(error instanceof AppError)) throw error; }
  const hourlyStatus = hourly.length ? 'available' : 'unavailable';
  const dailyStatus = daily.length ? 'available' : 'unavailable';
  const status = hourly.length && daily.length ? 'available' : hourly.length || daily.length ? 'partial' : 'unavailable';
  return {
    reading, fetchedAt: reading.fetchedAt, current, hourly, daily,
    forecast: {
      status, hourlyStatus, dailyStatus, error: status === 'available' ? null : 'invalid',
      message: status === 'available' ? null : '예보가 없거나 값·단위·시각 형식이 달라 해당 예보를 표시하지 않습니다. 현재 기온 기록은 보존합니다.',
    },
  };
}

export { validateWeatherPayload as normalizeWeatherPayload };

export async function fetchWeather({ fetchImpl = globalThis.fetch, timeoutMs = 8000, now = () => new Date().toISOString(), online = () => globalThis.navigator?.onLine !== false } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function'
    || typeof online !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw invalid('조회 설정이 올바르지 않습니다.');
  if (online() === false) throw new AppError('offline');
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
    if (!response || response.ok !== true) {
      if (response?.status === 401 || response?.status === 403) throw new AppError('auth');
      if (response?.status === 429) throw new AppError('rate');
      throw new AppError('http');
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError(timedOut ? 'timeout' : error instanceof TypeError ? 'network' : 'invalid', undefined, { cause: error });
    }
    return validateWeatherPayload(payload, now());
  };
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchReading(options = {}) {
  return (await fetchWeather(options)).reading;
}

export function emptyState() {
  return { version: 2, lastGood: null, days: [] };
}

function validateReading(reading) {
  if (!hasExactKeys(reading, READING_KEYS) || reading.kind !== 'real'
    || reading.sourceId !== SOURCE.id || reading.sourceUrl !== SOURCE.url || reading.unit !== SOURCE.unit
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

export function validateState(state, { now } = {}) {
  if (!hasExactKeys(state, ['version', 'lastGood', 'days']) || state.version !== 2 || !Array.isArray(state.days)) {
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
  if (now !== undefined && parseInstant(lastGood.fetchedAt) > parseInstant(now) + FUTURE_TOLERANCE) {
    throw invalid('아직 지나지 않은 수집 시각의 기록은 불러오지 않습니다.');
  }
  const latestDay = days.at(-1);
  if (!equalReading(lastGood, latestDay)) {
    throw invalid('마지막 정상값과 일별 기록이 일치하지 않습니다.');
  }
  return { version: 2, lastGood, days };
}

export function applyReading(state, reading) {
  const cleanState = validateState(state);
  const cleanReading = validateReading(reading);
  const dayIndex = cleanState.days.findIndex((day) => day.kstDate === cleanReading.kstDate);
  const existingDay = cleanState.days[dayIndex];
  // Keep one latest successful reading per KST date; older imports cannot rewind it.
  if (!existingDay) cleanState.days.push({ ...cleanReading });
  else if (cleanReading.fetchedAt > existingDay.fetchedAt) cleanState.days[dayIndex] = { ...cleanReading };
  else if (cleanReading.fetchedAt === existingDay.fetchedAt && !equalReading(cleanReading, existingDay)) {
    throw invalid('같은 수집 시각에 서로 다른 값이 있어 기록하지 않았습니다.');
  }
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
