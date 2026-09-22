return await (async () => {
  // Run in an isolated gstack browser. These are automated checks, not human observations.
  const $ = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const results = [];
  const storageKey = 'daegu-daily-real-v2';
  const originalFetch = window.fetch;
  const nativeFetch = (...args) => Reflect.apply(originalFetch, window, args);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (condition, description = 'UI completion') => {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > 12000) throw new Error(`${description}: timed out after 12 seconds`);
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
  const report = () => JSON.stringify({
    at: new Date().toISOString(), url: location.href, automated: true,
    results, passed: results.filter((result) => result.pass).length,
  });
  const ready = await run('dashboard-and-official-fixtures-ready', async () => {
    await wait(() => window.t04Adapter && $('#refresh') && !$('#refresh').disabled, 'Dashboard initialization');
    await wait(() => !$('#run-all').disabled, 'Verified fixture controls');
    await window.t04Adapter.ready;
    await wait(() => all('#evidence-rows .evidence-row').length > 0 || $('#review-count').textContent === '확인 필요', 'Real evidence validation');
    assert($('#package-status').textContent.includes('SHA-256 확인'), 'The official fixture hashes were not verified');
  });
  if (!ready) return report();

  const adapter = window.t04Adapter;
  $('#public-tab').click();
  const originalRealStorage = localStorage.getItem(storageKey);
  const initialTemperature = $('#temperature').textContent;
  const initialPublicRows = $('#history-body').textContent;
  const originalThemeStorage = localStorage.getItem('daegu-theme');
  const initialTheme = document.documentElement.dataset.theme;
  const sourceUrl = $('#source-link').href;
  const realUnchanged = () => {
    assert(localStorage.getItem(storageKey) === originalRealStorage, 'Synthetic activity changed the real browser storage');
    assert($('#temperature').textContent === initialTemperature, 'Synthetic activity changed the displayed real temperature');
    assert($('#history-body').textContent === initialPublicRows, 'Synthetic activity changed the public daily table');
  };
  const clickSettled = async (selector) => {
    const button = $(selector);
    assert(button && !button.disabled, `Control unavailable: ${selector}`);
    button.click();
    await wait(() => !$('#refresh').disabled && !$('#run-all').disabled, selector);
  };

  try {
    await run('actual-source-success-and-context', async () => {
      assert($('#status-title').textContent.includes('정상적으로'), 'The real source did not succeed');
      const stored = JSON.parse(originalRealStorage);
      const last = stored?.lastGood;
      const url = new URL(sourceUrl);
      assert(stored.version === 2 && last?.kind === 'real', 'A version 2 real reading was not stored');
      assert(last.sourceId === 'open-meteo-daegu' && last.sourceUrl === sourceUrl, 'Stored source is not the exact Daegu URL');
      assert(url.searchParams.get('latitude') === '35.8714' && url.searchParams.get('longitude') === '128.6014', 'Source coordinates are not Daegu');
      assert(last.unit === '°C' && Number(last.value).toFixed(1) === $('#temperature').textContent, 'Stored and displayed temperature differ');
      assert($('#observed-at').textContent !== '아직 없음' && $('#fetched-at').textContent !== '아직 없음', 'Both source and fetch times must be visible');
      assert(document.body.textContent.includes('Asia/Seoul'), 'The reference timezone is missing');
      assert(!all('input[type=password]').length, 'The public screen unexpectedly requests a password');
      return { sourceId: last.sourceId, sourceUrl: last.sourceUrl, observedAt: last.observedAt, fetchedAt: last.fetchedAt, value: last.value, unit: last.unit };
    });

    await run('real-hourly-and-seven-day-forecast', async () => {
      assert(all('.hour-card').length === 24, 'Expected 24 actual hourly forecast cards');
      assert(all('.day-card').length === 7, 'Expected 7 actual daily forecast cards');
      assert($('#forecast-time').textContent.includes('KST'), 'Forecast retrieval timezone is missing');
      assert($('#forecast-notice').textContent.includes('예상'), 'Forecast must be described as an estimate');
      return { hourlyCards: all('.hour-card').length, dailyCards: all('.day-card').length };
    });

    await run('real-evidence-raw-stored-displayed-match', async () => {
      const rows = all('#evidence-rows .evidence-row');
      assert(rows.length >= 1 && rows.length <= 2, 'Expected one or two real date records; synthetic dates must not fill the gap');
      assert(rows.every((row) => row.dataset.matched === 'true'), 'Raw, stored and displayed evidence do not match');
      assert(new Set(rows.map((row) => row.dataset.date)).size === rows.length, 'Real evidence dates must be unique');
      for (const row of rows) {
        const values = [...row.querySelectorAll('.evidence-values strong')].map((value) => value.textContent);
        assert(values.length === 3 && new Set(values).size === 1, 'The three displayed evidence values differ');
        assert(row.querySelector('a').href === sourceUrl, 'Evidence links to a different source');
      }
      if (rows.length === 1) assert($('#evidence-delta').textContent.includes('계산하지 않습니다'), 'One real date must not produce a fabricated change');
      return { realDates: rows.map((row) => row.dataset.date), matched: true };
    });

    await run('official-normal-daily-upsert-and-next-day', async () => {
      adapter.reset();
      assert(adapter.getState().daily_readings.length === 0, 'Synthetic reset did not clear the synthetic rows');
      const first = await adapter.runFixture('T04-NORMAL-D1-A');
      const id = first.daily_readings[0].record_id;
      const firstFetch = first.daily_readings[0].first_fetched_at;
      assert(first.current_reading.normalized_value === 100 && first.daily_readings.length === 1, 'D1-A must store one row with 100');
      const second = await adapter.runFixture('T04-NORMAL-D1-B');
      const third = await adapter.runFixture('T04-NORMAL-D1-B');
      for (const state of [second, third]) {
        assert(state.current_reading.normalized_value === 105 && state.daily_readings.length === 1, 'Repeated D1 success must update the same row to 105');
        assert(state.daily_readings[0].record_id === id && state.daily_readings[0].first_fetched_at === firstFetch, 'Same-day upsert changed the record identity or first fetch time');
      }
      const next = await adapter.runFixture('T04-NORMAL-D2');
      assert(next.daily_readings.length === 2 && next.current_reading.normalized_value === 120, 'D2 must add exactly one row with 120');
      assert(next.last_delta === 15 && next.last_comparison.direction === 'increase', 'Expected 120 - 105 = +15');
      realUnchanged();
      return { d1First: 100, d1Latest: 105, d1RowsAfterThreeRuns: 1, sameRecordId: true, d2Rows: 2, delta: 15 };
    }, true);

    const failures = [
      ['T04-TIMEOUT', 'timeout', '잠시 기다린 뒤'],
      ['T04-AUTH-401', 'auth', '접근 정책과 공개 상태'],
      ['T04-RATE-429', 'rate_limit', '대기 시간이 지난 뒤'],
      ['T04-OFFLINE', 'offline', '인터넷 연결을 확인'],
      ['T04-SCHEMA-BREAK', 'schema_error', '응답 형식을 확인'],
    ];
    const actionTexts = [];
    for (const [id, errorCode, action] of failures) {
      await run(`official-failure-${id}`, async () => {
        await clickSettled(`[data-failure="${id}"]`);
        const state = adapter.getState();
        assert(state.status.freshness === 'stale' && state.status.error_code === errorCode, 'The official failure state is incorrect');
        assert(state.current_reading.normalized_value === 105 && state.daily_readings.length === 1, 'Failure erased or changed the last normal synthetic value');
        const text = $('#lab-result').textContent;
        assert(text.includes('stale') && text.includes(action), 'The specific stale explanation or next action is missing');
        assert($('#lab-reading').textContent.includes('105') && $('#lab-reading').textContent.includes('오래된 값'), 'The last normal synthetic value is not visibly marked stale');
        assert(!$('#recover-lab').disabled && $('#recover-lab').textContent.includes('다시 시도'), 'Retry action is unavailable');
        actionTexts.push($('#lab-result p').textContent);
        realUnchanged();
        return { freshness: state.status.freshness, errorCode, preservedValue: 105, rows: 1, nextAction: $('#lab-result p').textContent };
      }, true);
      await run(`official-recovery-after-${id}`, async () => {
        await clickSettled('#recover-lab');
        const recovered = adapter.getState();
        assert(recovered.status.freshness === 'fresh' && recovered.status.error_code === 'none', 'Recovery did not return fresh / none');
        assert(recovered.current_reading.normalized_value === 120 && recovered.daily_readings.length === 2 && recovered.last_delta === 15, 'Recovery must store 120, exactly two rows and delta 15');
        await clickSettled('#recover-lab');
        const repeated = adapter.getState();
        assert(repeated.daily_readings.length === 2 && repeated.last_delta === 15, 'Repeated recovery duplicated the next-day row');
        assert($('#lab-result').textContent.includes('fresh / none'), 'The recovered state is not visible');
        realUnchanged();
        return { freshness: 'fresh', errorCode: 'none', value: 120, rowsAfterRepeatedRecovery: 2, delta: 15 };
      }, true);
    }
    await run('official-failure-actions-are-distinct', async () => {
      assert(actionTexts.length === 5 && new Set(actionTexts).size === 5, 'All five failure explanations and actions must differ');
    }, true);
    await run('official-one-click-suite-and-real-storage-isolation', async () => {
      await clickSettled('#run-all');
      assert($('#lab-result .suite-result')?.textContent.includes('통과'), 'The official one-click suite did not pass');
      realUnchanged();
    }, true);

    const injectedFailures = [
      { name: 'source-401', code: 'auth', response: async () => new Response('{}', { status: 401 }) },
      { name: 'source-403', code: 'auth', response: async () => new Response('{}', { status: 403 }) },
      { name: 'source-429', code: 'rate', response: async () => new Response('{}', { status: 429 }) },
      { name: 'transport-offline', code: 'network', response: async () => { throw new TypeError('Synthetic QA transport failure'); } },
      { name: 'invalid-json', code: 'invalid', response: async () => new Response('{synthetic-invalid-json', { status: 200 }) },
      { name: 'missing-required-fields', code: 'invalid', response: async () => new Response('{}', { status: 200 }) },
      { name: 'request-timeout', code: 'timeout', response: async () => new Promise(() => {}) },
    ];
    for (const fixture of injectedFailures) {
      await run(`main-ui-synthetic-${fixture.name}`, async () => {
        let intercepted = 0;
        window.fetch = (input, options) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (new URL(url, location.href).href === sourceUrl) { intercepted += 1; return fixture.response(input, options); }
          return nativeFetch(input, options);
        };
        const started = Date.now();
        await clickSettled('#refresh');
        assert(intercepted === 1, 'The intended synthetic source response was not intercepted exactly once');
        assert($('#status-title').textContent.includes(`· ${fixture.code}`), 'The main UI classified the failure incorrectly');
        assert($('#status-pill').textContent.includes('stale'), 'The retained last value must be visibly stale');
        assert($('#status-detail').textContent.includes('재시도'), 'The main UI retry action is missing');
        realUnchanged();
        return { expectedError: fixture.code, actualStatus: $('#status-title').textContent, retainedRealValue: initialTemperature, realStorageUnchanged: true, elapsedMs: Date.now() - started };
      }, true);
    }

    await run('native-source-recovery-after-synthetic-errors', async () => {
      window.fetch = originalFetch;
      if (originalRealStorage === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, originalRealStorage);
      await clickSettled('#refresh');
      assert($('#status-title').textContent.includes('정상적으로') && $('#status-pill').textContent.includes('fresh'), 'Native source recovery did not succeed');
      const stored = JSON.parse(localStorage.getItem(storageKey));
      assert(stored.lastGood.sourceUrl === sourceUrl && stored.lastGood.kind === 'real', 'Native recovery lost real source provenance');
      assert($('#temperature').textContent === Number(stored.lastGood.value).toFixed(1), 'Recovered display and actual stored value differ');
      assert($('#history-body').textContent === initialPublicRows, 'Browser recovery changed the published daily archive');
      return { fetchedAt: stored.lastGood.fetchedAt, value: stored.lastGood.value, unit: stored.lastGood.unit };
    });

    await run('public-json-export', async () => {
      const originalClick = HTMLAnchorElement.prototype.click;
      const originalCreateObjectURL = URL.createObjectURL;
      const exportedBlobs = new Map();
      let download = null;
      try {
        URL.createObjectURL = function (object) {
          const url = Reflect.apply(originalCreateObjectURL, URL, [object]);
          if (object instanceof Blob) exportedBlobs.set(url, object);
          return url;
        };
        HTMLAnchorElement.prototype.click = function () {
          if (this.download.startsWith('daegu-') && this.href.startsWith('blob:')) { download = { href: this.href, filename: this.download }; return; }
          return Reflect.apply(originalClick, this, []);
        };
        $('#public-tab').click();
        $('#export').click();
        assert(download && download.filename.startsWith('daegu-public-'), 'The public JSON download was not generated');
        const exportedBlob = exportedBlobs.get(download.href);
        assert(exportedBlob instanceof Blob, 'The download did not use the captured JSON Blob');
        const exported = JSON.parse(await exportedBlob.text());
        assert(exported.scope === 'published-real-observations' && exported.source.url === sourceUrl, 'Export provenance is incorrect');
        assert(exported.version === 2 && exported.days.every((day) => day.kind === 'real' && day.sourceId === 'open-meteo-daegu' && day.sourceUrl === sourceUrl), 'Export contains incorrect or synthetic records');
        return { filename: download.filename, realRows: exported.days.length };
      } finally {
        HTMLAnchorElement.prototype.click = originalClick;
        URL.createObjectURL = originalCreateObjectURL;
      }
    });

    await run('scope-theme-and-layout', async () => {
      $('#device-tab').click();
      assert($('#device-tab').getAttribute('aria-pressed') === 'true' && $('#history-note').textContent.includes('분리'), 'Browser records are not clearly separated');
      $('#public-tab').click();
      assert($('#history-body').textContent === initialPublicRows, 'Returning to public scope changed the archive table');
      $('#theme').click();
      assert(document.documentElement.dataset.theme !== initialTheme, 'Theme did not change');
      $('#theme').click();
      assert(document.documentElement.dataset.theme === initialTheme, 'Theme did not return to its original value');
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'The page overflows horizontally');
      return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, restoredTheme: initialTheme };
    });
  } finally {
    window.fetch = originalFetch;
    if (document.documentElement.dataset.theme !== initialTheme) $('#theme').click();
    if (originalThemeStorage === null) localStorage.removeItem('daegu-theme');
    else localStorage.setItem('daegu-theme', originalThemeStorage);
    adapter.reset();
    $('#public-tab').click();
    window.scrollTo(0, 0);
  }
  return report();
})();
