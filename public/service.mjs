import { SOURCE, AppError, fetchWeather, normalizeWeatherPayload, kstDate } from './core.mjs';

// The service caches full, validated source responses independently of the
// review page's daily records. An unsuccessful request never replaces them.
const CACHE_KEY = 'daegu-weather-service-cache-v1';
const THEME_KEY = 'daegu-theme';
const MAX_AGE = 2 * 60 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const text = (tag, content, className = '') => Object.assign(document.createElement(tag), { textContent: content, className });
const numeric = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const time = (value, options = {}) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false, ...options }).format(new Date(value));
const fullTime = (value) => time(value, { month: 'numeric', day: 'numeric' });
const SVG_NS = 'http://www.w3.org/2000/svg';
let weather = null;
let busy = false;
let failure = null;
let cacheUnavailable = false;
let lastRefresh = 0;

function svgNode(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

function weatherType(code, day = true) {
  if (code === 0) return [day ? 'sun' : 'moon', day ? '맑음' : '맑은 밤'];
  if (code === 1 || code === 2) return [day ? 'partly' : 'partly-night', '구름 조금'];
  if (code === 3) return ['cloud', '흐림'];
  if (code === 45 || code === 48) return ['fog', '안개'];
  if ([51, 53, 55, 56, 57].includes(code)) return ['rain', '이슬비'];
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['rain', '비'];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['snow', '눈'];
  if ([95, 96, 99].includes(code)) return ['storm', '뇌우'];
  return ['unknown', '날씨 정보 없음'];
}

function weatherIcon(code, day = true) {
  const [type] = weatherType(code, day);
  const svg = svgNode('svg', { viewBox: '0 0 80 80', 'aria-hidden': 'true', class: `weather-icon icon-${type}`, fill: 'none' });
  if (type === 'unknown') {
    svg.append(svgNode('path', { d: 'M27 40H53', stroke: 'currentColor', 'stroke-width': 4, 'stroke-linecap': 'round' }));
    return svg;
  }
  if (type === 'sun' || type === 'partly') {
    const group = svgNode('g', type === 'partly' ? { transform: 'translate(-5 -8) scale(.85)' } : {});
    group.append(svgNode('circle', { cx: 40, cy: 40, r: 15, class: 'sun-disc' }));
    for (let angle = 0; angle < 360; angle += 45) group.append(svgNode('path', { d: 'M40 11V18', transform: `rotate(${angle} 40 40)`, class: 'sun-ray', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    svg.append(group);
  }
  if (type === 'moon' || type === 'partly-night') {
    const moon = svgNode('path', { d: 'M55 53A24 24 0 0 1 28 17a24 24 0 1 0 27 36Z', class: 'moon-disc' });
    if (type === 'partly-night') moon.setAttribute('transform', 'translate(0 -4) scale(.8)');
    svg.append(moon);
  }
  if (!['sun', 'moon'].includes(type)) {
    svg.append(svgNode('path', { d: 'M21 55a12 12 0 0 1-1-24 18 18 0 0 1 34-1 13 13 0 0 1 5 25Z', class: 'cloud-shape' }));
    if (type === 'rain') for (const x of [26, 41, 56]) svg.append(svgNode('path', { d: `M${x} 62l-3 7`, class: 'rain-line', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    if (type === 'snow') for (const x of [26, 42, 58]) svg.append(svgNode('path', { d: `M${x - 3} 65h6m-3-3v6`, class: 'rain-line', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    if (type === 'storm') svg.append(svgNode('path', { d: 'M42 52l-8 13h8l-4 11 16-18H43l4-6Z', class: 'sun-disc' }));
    if (type === 'fog') for (const y of [62, 69]) svg.append(svgNode('path', { d: `M19 ${y}H61`, class: 'fog-line', 'stroke-width': 3, 'stroke-linecap': 'round' }));
  }
  return svg;
}

function normalizedSnapshot(snapshot) {
  if (!snapshot || !Number.isFinite(Date.parse(snapshot.fetchedAt)) || Date.parse(snapshot.fetchedAt) > Date.now() + 300000) throw new Error('확인할 수 없는 저장 시각');
  return normalizeWeatherPayload(snapshot.payload, snapshot.fetchedAt);
}

function useSnapshot(snapshot) {
  const value = normalizedSnapshot(snapshot);
  if (!weather || Date.parse(value.fetchedAt) > Date.parse(weather.fetchedAt)) {
    weather = value;
    render();
  }
}

function isOld() {
  return Boolean(weather && (failure || Date.now() - Date.parse(weather.reading.observedAt) > MAX_AGE));
}

function renderStatus() {
  $('service-refresh').disabled = busy;
  $('service-refresh').textContent = busy ? '확인 중…' : failure ? '다시 시도' : '새로고침';
  $('service-refresh').setAttribute('aria-busy', String(busy));
  $('service-badge').dataset.state = failure || isOld() ? 'stale' : weather ? 'fresh' : 'pending';
  $('service-badge').textContent = weather ? isOld() ? '이전 수신값' : busy ? '업데이트 중' : '최신 수신값' : busy ? '확인 중' : failure ? '수신 실패' : '수신 대기';
  $('service-status').dataset.state = failure || isOld() ? 'warning' : 'normal';
  if (failure) {
    $('service-status').textContent = `${failure.message}${weather ? ' 마지막 정상 수신값을 표시합니다.' : ' 표시할 저장값이 아직 없습니다.'}`;
  } else if (isOld()) {
    $('service-status').textContent = '새 자료를 기다리고 있습니다. 아래 날씨는 2시간 넘게 지난 이전 수신값입니다.';
  } else if (!weather) {
    $('service-status').textContent = '대구의 현재 날씨와 예보를 확인하고 있습니다.';
  } else if (cacheUnavailable) {
    $('service-status').textContent = '현재 날씨는 확인했습니다. 브라우저 저장 공간을 사용할 수 없어 다음 방문 때 다시 조회합니다.';
  } else {
    $('service-status').textContent = '';
  }
  $('service-status').hidden = !$('service-status').textContent;
  if (weather) $('service-updated').textContent = `${isOld() ? '이전 수신값 · ' : ''}원천 ${fullTime(weather.reading.observedAt)} · 조회 ${time(weather.fetchedAt)} KST`;
}

function currentDay() {
  return weather?.daily.find((day) => day.date === kstDate(new Date().toISOString()));
}

function futureHours() {
  const hour = Math.ceil(Date.now() / 3600000) * 3600000;
  return weather?.hourly.filter((item) => Date.parse(item.time) >= hour).slice(0, 24) || [];
}

function renderCurrent() {
  const current = weather?.current;
  $('service-temperature').textContent = current ? numeric(current.temperature) : '—';
  $('service-condition').textContent = current ? weatherType(current.weatherCode, current.isDay !== 0)[1] : failure ? '날씨를 받지 못했어요' : '날씨를 확인하고 있어요';
  $('service-feels').textContent = Number.isFinite(current?.apparentTemperature) ? `체감 ${numeric(current.apparentTemperature)}°C` : '체감 기온 정보 없음';
  $('service-symbol').replaceChildren(weatherIcon(current?.weatherCode, current?.isDay !== 0));
  const metrics = [
    ['습도', Number.isFinite(current?.relativeHumidity) ? `${current.relativeHumidity}%` : '—'],
    ['바람', Number.isFinite(current?.windSpeed) ? `${numeric(current.windSpeed)} km/h` : '—'],
    ['현재 강수량', Number.isFinite(current?.precipitation) ? `${numeric(current.precipitation)} mm` : '—'],
  ];
  $('service-metrics').replaceChildren(...metrics.map(([label, value]) => {
    const item = text('div', '', 'current-metric');
    item.append(text('span', label), text('strong', value));
    return item;
  }));
  const day = currentDay();
  const hours = futureHours().slice(0, 6);
  const stalePrefix = isOld() ? '이전 수신 예보 기준 · ' : '';
  if (hours.length) {
    const maximum = Math.max(...hours.map((hour) => hour.precipitationProbability));
    $('service-summary').textContent = `${stalePrefix}앞으로 ${hours.length}시간 강수확률은 최대 ${maximum}%예요.`;
  } else $('service-summary').textContent = day ? `${stalePrefix}오늘은 ${weatherType(day.weatherCode)[1]}으로 예보됐어요.` : failure ? '오늘 예보를 받지 못했습니다. 다시 시도해 주세요.' : '오늘 예보를 받으면 이곳에 알려드릴게요.';
  $('service-day-range').replaceChildren();
  if (day) {
    for (const [label, value] of [['최저 기온', day.temperatureMin], ['최고 기온', day.temperatureMax]]) {
      const item = text('div');
      item.append(text('span', label), text('strong', `${numeric(value)}°`));
      $('service-day-range').append(item);
    }
    $('service-sun').replaceChildren(text('span', `일출 ${time(day.sunrise)}`), text('span', `일몰 ${time(day.sunset)}`));
  } else {
    $('service-day-range').append(text('p', '오늘의 최저·최고 기온 정보 없음', 'empty-weather'));
    $('service-sun').replaceChildren(text('span', '일출·일몰 정보 없음'));
  }
}

function renderHourly() {
  const track = $('service-hourly');
  const previousScroll = track.scrollLeft;
  const hours = futureHours();
  track.replaceChildren();
  if (!hours.length) track.append(text('p', weather || failure ? '앞으로의 시간별 예보를 받지 못했습니다. 다시 시도해 주세요.' : '시간별 예보를 확인하고 있습니다.', 'empty-weather'));
  for (const hour of hours) {
    const card = text('div', '', 'hour-item');
    const daily = weather.daily.find((day) => day.date === hour.time.slice(0, 10));
    const daytime = daily ? Date.parse(hour.time) >= Date.parse(daily.sunrise) && Date.parse(hour.time) < Date.parse(daily.sunset) : true;
    const label = weatherType(hour.weatherCode, daytime)[1];
    const hourLabel = new Date(hour.time).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false });
    card.append(text('span', hourLabel, 'hour-label'), weatherIcon(hour.weatherCode, daytime), text('strong', `${numeric(hour.temperature)}°`, 'hour-temperature'), text('span', `강수 ${hour.precipitationProbability}%`, 'hour-rain'), text('span', `${hour.time.slice(5, 10).replace('-', '.')} · ${label}`, 'hour-condition'));
    track.append(card);
  }
  track.scrollLeft = previousScroll;
}

function temperatureRange(low, high, totalLow, totalHigh) {
  const svg = svgNode('svg', { viewBox: '0 0 120 12', class: 'temperature-range', 'aria-hidden': 'true' });
  const extent = totalHigh - totalLow || 1;
  const start = 6 + (low - totalLow) / extent * 108;
  const end = 6 + (high - totalLow) / extent * 108;
  svg.append(svgNode('path', { d: 'M6 6H114', class: 'range-track', 'stroke-width': 6, 'stroke-linecap': 'round' }), svgNode('path', { d: `M${start} 6H${Math.max(start + 1, end)}`, class: 'range-value', 'stroke-width': 6, 'stroke-linecap': 'round' }));
  return svg;
}

function renderDaily() {
  const list = $('service-daily');
  list.replaceChildren();
  const today = kstDate(new Date().toISOString());
  const days = weather?.daily.filter((day) => day.date >= today).slice(0, 7) || [];
  if (!days.length) {
    list.append(text('p', weather ? '7일 예보를 받지 못했습니다. 현재 날씨는 계속 확인할 수 있습니다.' : failure ? '7일 예보를 받지 못했습니다. 다시 시도해 주세요.' : '7일 예보를 확인하고 있습니다.', 'empty-weather'));
    return;
  }
  const low = Math.min(...days.map((day) => day.temperatureMin));
  const high = Math.max(...days.map((day) => day.temperatureMax));
  for (const day of days) {
    const row = text('article', '', 'daily-row');
    const date = text('div', '', 'daily-date');
    const weekday = new Date(`${day.date}T12:00:00+09:00`).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' });
    date.append(text('strong', day.date === today ? '오늘' : `${weekday}요일`), text('span', day.date.slice(5).replace('-', '.')));
    const condition = text('div', '', 'daily-condition');
    condition.append(weatherIcon(day.weatherCode), text('span', weatherType(day.weatherCode)[1]));
    const rain = text('span', `${day.precipitationProbabilityMax}%`, 'daily-rain');
    rain.setAttribute('aria-label', `최대 강수확률 ${day.precipitationProbabilityMax}%`);
    rain.title = '하루 최대 강수확률';
    const range = text('div', '', 'daily-temperature');
    const min = text('span', `${numeric(day.temperatureMin)}°`, 'daily-min');
    const max = text('strong', `${numeric(day.temperatureMax)}°`, 'daily-max');
    min.setAttribute('aria-label', `최저 ${numeric(day.temperatureMin)}도`);
    max.setAttribute('aria-label', `최고 ${numeric(day.temperatureMax)}도`);
    range.append(min, temperatureRange(day.temperatureMin, day.temperatureMax, low, high), max);
    row.append(date, condition, rain, range);
    list.append(row);
  }
}

function render() {
  renderStatus();
  renderCurrent();
  renderHourly();
  renderDaily();
  $('service-source-time').textContent = weather ? `${fullTime(weather.reading.observedAt)} KST` : '아직 수신하지 못했습니다.';
  $('service-fetch-time').textContent = weather ? `${fullTime(weather.fetchedAt)} KST` : '아직 수신하지 못했습니다.';
  const messages = [isOld() ? '이전 수신 예보를 표시하고 있습니다.' : '', weather?.forecast.message || '', weather?.current.error || '', '예보는 기상 모델의 예상이며 바뀔 수 있습니다.'];
  $('service-forecast-note').textContent = messages.filter(Boolean).join(' ');
}

async function refresh() {
  if (busy) return;
  busy = true;
  lastRefresh = Date.now();
  renderStatus();
  let rawResponse;
  try {
    const next = await fetchWeather({ fetchImpl: async (...args) => {
      const response = await fetch(...args);
      if (response.ok) rawResponse = response.clone();
      return response;
    } });
    weather = next;
    failure = null;
    try {
      const snapshot = { fetchedAt: next.fetchedAt, payload: await rawResponse.json() };
      normalizedSnapshot(snapshot);
      localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
      cacheUnavailable = false;
    } catch { cacheUnavailable = true; }
  } catch (error) {
    failure = error instanceof AppError ? error : new AppError('network');
  } finally {
    busy = false;
    render();
  }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('service-theme').textContent = theme === 'dark' ? '☀' : '☾';
  $('service-theme').setAttribute('aria-label', theme === 'dark' ? '밝은 화면으로 변경' : '어두운 화면으로 변경');
  $('service-theme').title = theme === 'dark' ? '밝은 화면' : '어두운 화면';
}

function renderDate() {
  $('service-date').textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
}

try {
  const savedTheme = localStorage.getItem(THEME_KEY);
  setTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch { setTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
$('service-theme').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* Theme still works for this visit. */ }
});
$('service-source-link').href = SOURCE.url;
$('service-source-link').target = '_blank';
$('service-source-link').rel = 'noopener noreferrer';
$('service-refresh').addEventListener('click', refresh);
renderDate();
try {
  const saved = localStorage.getItem(CACHE_KEY);
  if (saved) useSnapshot(JSON.parse(saved));
} catch { /* Invalid caches are ignored; only a validated live success can replace them. */ }
render();

const archive = async () => {
  try {
    const response = await fetch('./data/weather.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.ok) useSnapshot(await response.json());
  } catch { /* A bundled snapshot is optional; the live request has its own status. */ }
};
await Promise.allSettled([archive(), refresh()]);
setInterval(() => {
  renderDate();
  renderStatus();
  if (weather && isOld()) $('service-forecast-note').textContent = `이전 수신 예보를 표시하고 있습니다. ${weather.forecast.message || '예보는 기상 모델의 예상이며 바뀔 수 있습니다.'}`;
}, 60000);
setInterval(() => { if (!document.hidden && !busy) refresh(); }, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastRefresh >= 10 * 60 * 1000) refresh(); });
window.addEventListener('online', () => { if (failure) refresh(); });
window.addEventListener('offline', () => { failure = new AppError('offline'); render(); });
