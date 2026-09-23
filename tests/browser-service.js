return await (async () => {
  // Run through gstack eval in an isolated browser. Only failed responses are
  // synthetic; normal source snapshots and recovery come from the actual API.
  const $ = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const results = [];
  const cacheKey = 'daegu-weather-service-cache-v1';
  const recordKey = 'daegu-daily-real-v2';
  const originalFetch = window.fetch;
  const nativeFetch = (...args) => Reflect.apply(originalFetch, window, args);
  const originalOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  const originalRecord = localStorage.getItem(recordKey);
  const originalThemeStorage = localStorage.getItem('daegu-theme');
  const initialTheme = document.documentElement.dataset.theme;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (condition, label) => {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > 12000) throw new Error(`${label}: exceeded 12 seconds`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const run = async (name, action, synthetic = false) => {
    try {
      const detail = await action();
      results.push({ name, pass: true, synthetic, ...(detail === undefined ? {} : { detail }) });
      return true;
    } catch (error) {
      results.push({ name, pass: false, synthetic, detail: String(error?.message ?? error) });
      return false;
    }
  };
  const report = () => JSON.stringify({ at: new Date().toISOString(), url: location.href, automated: true, results, passed: results.filter((result) => result.pass).length });
  const restoreOnline = () => {
    if (originalOnline) Object.defineProperty(navigator, 'onLine', originalOnline);
    else delete navigator.onLine;
  };
  const refresh = async () => {
    assert($('#service-refresh') && !$('#service-refresh').disabled, 'Refresh is unavailable');
    $('#service-refresh').click();
    await wait(() => !$('#service-refresh').disabled, 'Source refresh');
  };

  try {
    const ready = await run('service-real-source-ready', async () => {
      await wait(() => $('#service-refresh') && !$('#service-refresh').disabled, 'Service initialization');
      assert($('#service-badge').dataset.state === 'fresh', 'The actual API did not provide a fresh reading');
      assert(localStorage.getItem(cacheKey), 'No actual source snapshot was cached');
      assert(!all('input[type=password]').length, 'The service unexpectedly requires a password');
    });
    if (!ready) return report();
    const originalCache = localStorage.getItem(cacheKey);
    const snapshot = JSON.parse(originalCache);
    const initialTemperature = $('#service-temperature').textContent;
    const sourceUrl = $('#service-source-link').href;

    await run('real-raw-normalized-cache-and-display-match', async () => {
      const { SOURCE, normalizeWeatherPayload } = await import('./core.mjs');
      const normalized = normalizeWeatherPayload(snapshot.payload, snapshot.fetchedAt);
      const source = new URL(sourceUrl);
      assert(sourceUrl === SOURCE.url && normalized.reading.sourceUrl === sourceUrl, 'Source URL differs from validated source');
      assert(source.searchParams.get('latitude') === '35.8714' && source.searchParams.get('longitude') === '128.6014', 'Coordinates are not the Daegu source');
      assert(snapshot.payload.current.temperature_2m === normalized.reading.value, 'Raw and normalized temperatures differ');
      assert(Number(normalized.reading.value).toFixed(1) === initialTemperature, 'Cached actual temperature differs from the displayed value');
      assert(normalized.reading.unit === '°C' && $('.current-temperature .unit').textContent === '°C', 'Temperature unit is missing or different');
      assert($('#service-updated').textContent.includes('원천') && $('#service-updated').textContent.includes('조회') && $('#service-updated').textContent.includes('KST'), 'Visible source time, fetch time or timezone is missing');
      assert($('#service-source-time').textContent.includes('KST') && $('#service-fetch-time').textContent.includes('KST'), 'Expanded source metadata is missing');
      assert(document.body.textContent.includes('Asia/Seoul') && document.body.textContent.includes('실측 관측소'), 'Model and timezone attribution are missing');
      return { sourceUrl, observedAt: normalized.reading.observedAt, fetchedAt: normalized.fetchedAt, value: normalized.reading.value, unit: normalized.reading.unit, rawStoredDisplayMatch: true };
    });

    await run('24-hour-and-seven-day-real-forecasts', async () => {
      assert(all('#service-hourly .hour-item').length === 24, 'Expected 24 future hourly records');
      assert(all('#service-daily .daily-row').length === 7, 'Expected 7 daily forecast rows');
      assert($('#service-summary').textContent.includes('강수확률'), 'Today summary is missing the real precipitation outlook');
      assert($('#service-forecast-note').textContent.includes('예상'), 'Forecasts are not identified as estimates');
      assert($('#service-sun').textContent.includes('일출') && $('#service-sun').textContent.includes('일몰'), 'Sunrise and sunset are missing');
      return { hours: 24, days: 7 };
    });

    await run('focused-main-and-public-review-route', async () => {
      assert(!$('#failure-buttons') && !$('#lab-result') && !$('#history-body') && !$('#evidence-rows'), 'Coursework controls remain on the service home page');
      assert(!window.t04Adapter, 'The official synthetic adapter should not initialize on the service home page');
      const review = all('.service-footer a').find((link) => new URL(link.href).pathname === '/review.html');
      assert(review && review.textContent.includes('기록'), 'The separate review link is missing');
      const response = await nativeFetch(review.href, { cache: 'no-store' });
      const html = await response.text();
      assert(response.ok && html.includes('id="failure-buttons"') && html.includes('id="evidence-rows"'), 'The public review page no longer contains required evidence and failures');
      return { reviewUrl: review.href, status: response.status };
    });

    await run('theme-and-current-viewport-layout', async () => {
      $('#service-theme').click();
      assert(document.documentElement.dataset.theme !== initialTheme, 'Theme did not switch');
      $('#service-theme').click();
      assert(document.documentElement.dataset.theme === initialTheme, 'Theme did not return to the original state');
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'The service overflows horizontally');
      const scroller = $('#service-hourly');
      assert(scroller.scrollWidth > scroller.clientWidth, 'The 24-hour forecast has no usable horizontal overflow');
      return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, theme: initialTheme };
    });

    const failures = [
      { name: 'timeout', phrase: '정해진 시간 안에', response: (_input, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Synthetic timeout', 'AbortError')), { once: true })) },
      { name: 'external-401', phrase: '요청을 거절', response: async () => new Response('{}', { status: 401 }) },
      { name: 'rate-429', phrase: '호출 한도', response: async () => new Response('{}', { status: 429 }) },
      { name: 'offline', phrase: '오프라인', offline: true },
      { name: 'schema-change', phrase: '값·단위·시간', response: async () => new Response('{"synthetic":true,"changed_schema":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } }) },
    ];
    const messages = [];
    for (const fixture of failures) {
      await run(`service-synthetic-failure-${fixture.name}`, async () => {
        restoreOnline();
        let intercepted = 0;
        if (fixture.offline) Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        window.fetch = (input, options) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (new URL(url, location.href).href === sourceUrl) {
            intercepted += 1;
            return fixture.response ? fixture.response(input, options) : Promise.reject(new Error('Offline must reject before transport'));
          }
          return nativeFetch(input, options);
        };
        const start = Date.now();
        await refresh();
        assert(intercepted === (fixture.offline ? 0 : 1), 'The synthetic failure did not intercept the expected request count');
        assert($('#service-badge').dataset.state === 'stale' && $('#service-badge').textContent === '이전 수신값', 'Retained weather is not clearly marked stale');
        assert($('#service-status').textContent.includes(fixture.phrase), 'The distinct failure explanation is missing');
        assert($('#service-refresh').textContent === '다시 시도' && !$('#service-refresh').disabled, 'Retry action is unavailable');
        assert($('#service-temperature').textContent === initialTemperature, 'Failure erased or changed the last good displayed value');
        assert(localStorage.getItem(cacheKey) === originalCache, 'Failure changed the last good source cache');
        assert(localStorage.getItem(recordKey) === originalRecord, 'Service failure changed the real review records');
        assert($('#service-forecast-note').textContent.includes('이전 수신 예보'), 'Retained forecasts are not marked stale');
        messages.push($('#service-status').textContent);
        return { message: $('#service-status').textContent, retainedValue: initialTemperature, lastGoodCacheUnchanged: true, realReviewStorageUnchanged: true, elapsedMs: Date.now() - start };
      }, true);
    }
    await run('five-distinct-failure-messages', async () => {
      assert(messages.length === 5 && new Set(messages).size === 5, 'Failure reasons were merged into a generic error');
    }, true);

    await run('actual-source-recovery-and-record-isolation', async () => {
      window.fetch = originalFetch;
      restoreOnline();
      await refresh();
      assert($('#service-badge').dataset.state === 'fresh' && $('#service-badge').textContent === '최신 수신값', 'Actual source recovery did not become fresh');
      assert($('#service-status').hidden, 'A stale failure message remains after actual recovery');
      const recovered = JSON.parse(localStorage.getItem(cacheKey));
      assert(new Date(recovered.fetchedAt) >= new Date(snapshot.fetchedAt), 'Recovery moved the cache backward');
      assert(Number(recovered.payload.current.temperature_2m).toFixed(1) === $('#service-temperature').textContent, 'Actual recovered raw value and screen differ');
      assert(localStorage.getItem(recordKey) === originalRecord, 'Service recovery changed review daily records');
      return { fetchedAt: recovered.fetchedAt, value: recovered.payload.current.temperature_2m, realReviewStorageUnchanged: true };
    });
  } finally {
    window.fetch = originalFetch;
    restoreOnline();
    if ($('#service-theme') && document.documentElement.dataset.theme !== initialTheme) $('#service-theme').click();
    if (originalThemeStorage === null) localStorage.removeItem('daegu-theme');
    else localStorage.setItem('daegu-theme', originalThemeStorage);
    window.scrollTo(0, 0);
  }
  return report();
})();
