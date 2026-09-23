import { kstDate } from './core.mjs';
import { KINDS, TITLES, CACHE_KEY, validPart, isPartOld, combineWeather, fetchPart } from './portal-client.mjs';

const parts = {}, errors = {};
const THEME_KEY = 'daegu-theme';
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
  if (code === 1 || code === 2) return [day ? 'partly' : 'partly-night', '구름 많음'];
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
    svg.append(svgNode('path', { d: 'M33 46V20a7 7 0 0 1 14 0v26a14 14 0 1 1-14 0Z', stroke: 'currentColor', 'stroke-width': 2.5 }));
    svg.append(svgNode('circle',{cx:40,cy:58,r:7,class:'sun-disc'}),svgNode('path',{d:'M40 29V57',class:'sun-ray','stroke-width':4,'stroke-linecap':'round'}));
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

function isOld() { return Boolean(parts.current && (errors.current || isPartOld(parts.current))); }
function renderStatus() {
  $('service-refresh').disabled = busy;
  $('service-refresh').textContent = busy ? '확인 중…' : failure ? '다시 시도' : '새로고침';
  $('service-refresh').setAttribute('aria-busy', String(busy));
  $('service-badge').dataset.state = failure || isOld() ? 'stale' : parts.current ? 'fresh' : 'pending';
  $('service-badge').textContent = parts.current ? isOld() ? '이전 수신값' : busy ? '업데이트 중' : '최신 수신값' : busy ? '확인 중' : failure ? '수신 실패' : '수신 대기';
  $('service-status').dataset.state = failure || isOld() ? 'warning' : 'normal';
  if (failure) {
    $('service-status').textContent = `${failure.message}${parts.current ? ' 마지막 정상 수신값을 표시합니다.' : ' 표시할 저장값이 아직 없습니다.'}`;
  } else if (isOld()) {
    $('service-status').textContent = '새 자료를 기다리고 있습니다. 아래 날씨는 2시간 넘게 지난 이전 수신값입니다.';
  } else if (!parts.current) {
    $('service-status').textContent = '대구의 현재 날씨와 예보를 확인하고 있습니다.';
  } else if (cacheUnavailable) {
    $('service-status').textContent = '현재 날씨는 확인했습니다. 브라우저 저장 공간을 사용할 수 없어 다음 방문 때 다시 조회합니다.';
  } else {
    $('service-status').textContent = '';
  }
  $('service-status').hidden = !$('service-status').textContent;
  if (parts.current) $('service-updated').textContent = `${isOld() ? '이전 수신값 · ' : ''}원천 ${fullTime(weather.reading.observedAt)} · 조회 ${time(weather.fetchedAt)} KST`;
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
  $('service-condition').textContent = current ? (current.rainType === 0 ? '강수 없음' : weatherType(current.weatherCode)[1]) : failure ? '날씨를 받지 못했어요' : '날씨를 확인하고 있어요';
  $('service-feels').textContent = Number.isFinite(current?.apparentTemperature) ? `체감 ${numeric(current.apparentTemperature)}°C` : '기상청 초단기실황 · 중구 격자';
  $('service-symbol').replaceChildren(weatherIcon(current?.weatherCode, current?.isDay !== 0));
  const metrics = [
    ['습도', Number.isFinite(current?.relativeHumidity) ? `${current.relativeHumidity}%` : '—'],
    ['바람', Number.isFinite(current?.windSpeed) ? `${numeric(current.windSpeed)} m/s` : '—'],
    ['1시간 강수량', Number.isFinite(current?.precipitation) ? `${numeric(current.precipitation)} mm` : current?.precipitationText || '—'],
  ];
  $('service-metrics').replaceChildren(...metrics.map(([label, value]) => {
    const item = text('div', '', 'current-metric');
    item.append(text('span', label), text('strong', value));
    return item;
  }));
  const day = currentDay();
  const hours = futureHours().slice(0, 6);
  const stalePrefix = errors.forecast || isPartOld(parts.forecast) ? '이전 수신 예보 기준 · ' : '';
  if (hours.length) {
    const probabilities = hours.map(hour => hour.precipitationProbability).filter(Number.isFinite);
    const maximum = probabilities.length ? Math.max(...probabilities) : '—';
    $('service-summary').textContent = `${stalePrefix}앞으로 ${hours.length}시간 강수확률은 최대 ${maximum}%예요.`;
  } else $('service-summary').textContent = day ? `${stalePrefix}오늘은 ${weatherType(day.weatherCode)[1]}으로 예보됐어요.` : failure ? '오늘 예보를 받지 못했습니다. 다시 시도해 주세요.' : '오늘 예보를 받으면 이곳에 알려드릴게요.';
  $('service-day-range').replaceChildren();
  if (day) {
    for (const [label, value] of [['최저 기온', day.temperatureMin], ['최고 기온', day.temperatureMax]]) {
      const item = text('div');
      item.append(text('span', label), text('strong', `${numeric(value)}°`));
      $('service-day-range').append(item);
    }
    $('service-sun').replaceChildren(text('p', '기상청 단기예보 기준'));
  } else {
    $('service-day-range').append(text('p', '오늘의 최저·최고 기온 정보 없음', 'empty-weather'));
    $('service-sun').replaceChildren(text('p', '최저·최고는 해당 발표에 포함된 값만 표시합니다.'));
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
    const daytime = +hour.time.slice(11,13) >= 6 && +hour.time.slice(11,13) < 18;
    const label = weatherType(hour.weatherCode, daytime)[1];
    const hourLabel = new Date(hour.time).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false });
    card.append(text('span', hourLabel, 'hour-label'), weatherIcon(hour.weatherCode, daytime), text('strong', `${numeric(hour.temperature)}°`, 'hour-temperature'), text('span', `강수 ${hour.precipitationProbability ?? '—'}%`, 'hour-rain'), text('span', `${hour.time.slice(5, 10).replace('-', '.')} · ${label}`, 'hour-condition'));
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
    list.append(text('p', errors.forecast ? '단기예보를 받지 못했습니다. 다시 시도해 주세요.' : '단기예보를 확인하고 있습니다.', 'empty-weather'));
    return;
  }
  const low = Math.min(...days.map(day => day.temperatureMin).filter(Number.isFinite));
  const high = Math.max(...days.map(day => day.temperatureMax).filter(Number.isFinite));
  for (const day of days) {
    const row = text('article', '', 'daily-row');
    const date = text('div', '', 'daily-date');
    const weekday = new Date(`${day.date}T12:00:00+09:00`).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' });
    date.append(text('strong', day.date === today ? '오늘' : `${weekday}요일`), text('span', day.date.slice(5).replace('-', '.')));
    const condition = text('div', '', 'daily-condition');
    condition.append(weatherIcon(day.weatherCode), text('span', weatherType(day.weatherCode)[1]));
    const rain = text('span', `${day.precipitationProbabilityMax ?? '—'}%`, 'daily-rain');
    rain.setAttribute('aria-label', `최대 강수확률 ${day.precipitationProbabilityMax}%`);
    rain.title = '하루 최대 강수확률';
    const range = text('div', '', 'daily-temperature');
    const min = text('span', `${numeric(day.temperatureMin)}°`, 'daily-min');
    const max = text('strong', `${numeric(day.temperatureMax)}°`, 'daily-max');
    min.setAttribute('aria-label', `최저 ${numeric(day.temperatureMin)}도`);
    max.setAttribute('aria-label', `최고 ${numeric(day.temperatureMax)}도`);
    range.append(min);
    if(Number.isFinite(day.temperatureMin)&&Number.isFinite(day.temperatureMax)) range.append(temperatureRange(day.temperatureMin,day.temperatureMax,low,high));
    range.append(max);
    row.append(date, condition, rain, range);
    list.append(row);
  }
}

function partNote(kind) {
  const p=parts[kind], old=errors[kind] || isPartOld(p);
  return [old&&p?'이전 수신값':'',errors[kind]||'',p?'원천 '+fullTime(p.data.observedAt||p.data.issuedAt)+' · 조회 '+fullTime(p.fetchedAt)+' KST':''].filter(Boolean).join(' · ');
}
function renderExtras() {
  $('forecast-status').textContent=partNote('forecast');
  $('mid-status').textContent=partNote('mid');
  $('air-status').textContent=partNote('air');
  $('warnings-status').textContent=partNote('warnings');
  const air=parts.air?.data;
  $('air-values').replaceChildren();
  if(air) {
    for(const [label,value] of [['미세먼지 PM10',air.pm10],['초미세먼지 PM2.5',air.pm25]]) {
      const item=text('div','','air-metric');item.append(text('span',label),text('strong',value===null?'측정값 없음':value+' µg/m³'));$('air-values').append(item);
    }
    $('air-station').textContent=air.station+' 측정소 · 에어코리아 · 실시간 미확정 자료';
  } else $('air-station').textContent='대기질 자료를 기다립니다.';
  const warnings=parts.warnings?.data;
  $('warnings-content').textContent=warnings ? '특보 현황\n'+(warnings.current||'원천 내용 없음')+'\n\n예비특보\n'+(warnings.preliminary||'원천 내용 없음') : '특보를 확인하지 못했습니다. 특보 없음으로 판단하지 마세요.';
  $('warnings-summary').textContent=(errors.warnings||isPartOld(parts.warnings)?'확인 필요 · ':'')+(warnings ? /대구/.test(warnings.current+' '+warnings.preliminary)?'대구 관련 내용이 있는 전국 기상특보':'전국 기상특보 확인' : errors.warnings?'기상특보 수신 실패':'기상특보 확인 중');
  const mid=$('service-mid');mid.replaceChildren();
  for(const day of parts.mid?.data.days||[]) {
    const row=text('article','','mid-row');row.append(text('strong',day.date.slice(5).replace('-','.')),text('span',day.condition||'날씨 정보 없음'),text('span',day.precipitationProbabilityMax===null?'강수확률 없음':'강수 '+day.precipitationProbabilityMax+'%'),text('strong',numeric(day.temperatureMin)+'° / '+numeric(day.temperatureMax)+'°'));mid.append(row);
  }
}
function render() {
  weather=combineWeather(parts);
  failure=errors.current?{message:errors.current}:null;
  renderStatus();renderCurrent();renderHourly();renderDaily();renderExtras();
  $('service-source-time').textContent=parts.current?fullTime(parts.current.data.observedAt)+' KST':'아직 수신하지 못했습니다.';
  $('service-fetch-time').textContent=parts.current?fullTime(parts.current.fetchedAt)+' KST':'아직 수신하지 못했습니다.';
  $('service-forecast-note').textContent='예보는 발표 시각에 따라 달라질 수 있습니다. — 표시는 해당 발표에 값이 없는 항목입니다. 중기예보의 날씨는 대구·경북 권역, 기온은 대구 도시 기준입니다.';
}
async function refresh() {
  if(busy)return;busy=true;lastRefresh=Date.now();renderStatus();
  await Promise.allSettled(KINDS.map(async kind=>{
    try {
      const next=await fetchPart(kind);
      if(!parts[kind]||Date.parse(next.fetchedAt)>=Date.parse(parts[kind].fetchedAt))parts[kind]=next;
      delete errors[kind];
      try{localStorage.setItem(CACHE_KEY,JSON.stringify(parts));cacheUnavailable=false;}catch{cacheUnavailable=true;}
    }catch(error){errors[kind]=error.message;}
    render();
  }));
  busy=false;render();
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
$('service-source-link').href = 'https://www.data.go.kr/data/15084084/openapi.do';
$('service-source-link').target = '_blank';
$('service-source-link').rel = 'noopener noreferrer';
$('service-refresh').addEventListener('click', refresh);
renderDate();
try {
  const saved = localStorage.getItem(CACHE_KEY);
  if(saved){const cached=JSON.parse(saved);for(const kind of KINDS)if(validPart(cached[kind],kind))parts[kind]=cached[kind];}
} catch { /* Invalid caches are ignored; only a validated live success can replace them. */ }
render();

await refresh();
setInterval(() => {
  renderDate();
  renderStatus();
  render();
}, 60000);
setInterval(() => { if (!document.hidden && !busy) refresh(); }, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastRefresh >= 10 * 60 * 1000) refresh(); });
window.addEventListener('online', refresh);
window.addEventListener('offline', () => { for(const kind of KINDS)errors[kind]='오프라인입니다. 연결을 복구한 뒤 다시 시도해 주세요.';render(); });
