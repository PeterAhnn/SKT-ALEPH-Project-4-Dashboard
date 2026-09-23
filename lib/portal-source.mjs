const ROOT = 'https://apis.data.go.kr/';
export const MESSAGES = {
  configuration: '서비스 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.',
  auth: '제공기관이 요청을 거절했습니다. 운영자가 이용승인과 인증 설정을 확인해야 합니다.',
  rate: '제공기관의 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  timeout: '제공기관의 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.',
  network: '제공기관에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  invalid: '제공기관의 응답 형식이나 값을 확인할 수 없어 새 값으로 저장하지 않았습니다.',
  no_data: '제공기관에 해당 시각의 자료가 아직 없습니다. 잠시 후 다시 시도해 주세요.',
};
export class SourceError extends Error { constructor(code) { super(MESSAGES[code] || MESSAGES.invalid); this.code = code; } }
export const fail = (code = 'invalid') => { throw new SourceError(code); };
export const num = (v, min = -100, max = 10000) => {
  if (v === null || v === undefined || String(v).trim() === '' || v === '-') return null;
  const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
export const str = (v, max = 8000) => typeof v === 'string' ? v.slice(0, max) : '';
export const kstParts = (date) => new Date(+date + 9 * 3600000).toISOString().replace(/[-:]/g, '');
export function instant(date, time) {
  const d = String(date), t = String(time).padStart(4, '0');
  if (!/^\d{8}$/.test(d) || !/^\d{4}$/.test(t) || +t.slice(0, 2) > 23 || +t.slice(2) > 59) return fail();
  const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2)}:00+09:00`;
  if (!Number.isFinite(Date.parse(iso)) || kstParts(new Date(iso)).slice(0,8) !== d) return fail();
  return iso;
}
export function publication(now, kind) {
  const shifted = kstParts(new Date(+now - (kind === 'current' ? 45 : 20) * 60000));
  if (kind === 'current') return { base_date: shifted.slice(0,8), base_time: shifted.slice(9,11) + '00' };
  const hours = kind === 'mid' ? [6,18] : [2,5,8,11,14,17,20,23];
  let date = shifted.slice(0,8), hour = [...hours].reverse().find(h => h <= +shifted.slice(9,11));
  if (hour === undefined) { date = kstParts(new Date(+now - 24 * 3600000)).slice(0,8); hour = hours.at(-1); }
  const time = String(hour).padStart(2,'0') + '00';
  return kind === 'mid' ? { tmFc: date + time } : { base_date: date, base_time: time };
}
function resultError(code) {
  if (['03','3'].includes(code)) return 'no_data';
  if (['20','21','30','31','32','33'].includes(code)) return 'auth';
  if (['22','429'].includes(code)) return 'rate';
  if (['05','5'].includes(code)) return 'timeout';
  return 'invalid';
}
export async function requestItems(path, params, { key, fetchImpl = fetch } = {}) {
  if (!key?.trim()) return fail('configuration');
  const url = new URL(path, ROOT);
  for (const [k,v] of Object.entries({ serviceKey: key.trim(), pageNo: 1, numOfRows: 1000, dataType: 'JSON', ...params })) url.searchParams.set(k, String(v));
  let response, raw;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(path.startsWith('B552584/')?20000:12000), redirect: 'error' });
    if (response.status === 401 || response.status === 403) return fail('auth');
    if (response.status === 429) return fail('rate');
    if (!response.ok) return fail('network');
    raw = await response.text();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    return fail(['TimeoutError','AbortError'].includes(error.name) ? 'timeout' : 'network');
  }
  let payload;
  try { payload = JSON.parse(raw); } catch {
    // Portal gateways sometimes return XML even when JSON was requested.
    const code = raw.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/)?.[1];
    return fail(code ? resultError(code) : 'invalid');
  }
  const envelope=payload?.response||payload;
  const header = envelope?.header;
  if (!header || !['00','0','0000'].includes(String(header.resultCode))) return fail(resultError(String(header?.resultCode)));
  const body = envelope.body;
  if (!body || +body.totalCount === 0) return fail('no_data');
  let items = Array.isArray(body.items) ? body.items : body.items?.item;
  if(items&&typeof items==='object'&&!Array.isArray(items))items=[items];
  if (!Array.isArray(items) || !items.length) return fail('invalid');
  return items;
}
