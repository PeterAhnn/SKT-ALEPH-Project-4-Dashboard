return await (async () => {
  // Automated, read-only evidence validation. Injected responses never enter real storage.
  const $ = (selector) => document.querySelector(selector);
  const rows = () => [...document.querySelectorAll('#evidence-rows .evidence-row')];
  const results = [];
  const originalFetch = window.fetch;
  const nativeFetch = (...args) => Reflect.apply(originalFetch, window, args);
  const storageKey = 'daegu-daily-real-v2';
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const report = () => JSON.stringify({
    at: new Date().toISOString(), url: location.href, automated: true,
    results, passed: results.filter((result) => result.pass).length,
  });
  const run = async (name, action, synthetic = false) => {
    try {
      const detail = await action();
      results.push({ name, pass: true, synthetic, detail });
      return true;
    } catch (error) {
      results.push({ name, pass: false, synthetic, detail: String(error?.message ?? error) });
      return false;
    }
  };
  const wait = async (condition) => {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > 12000) throw new Error('Dashboard initialization timed out after 12 seconds');
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };

  let loadReviewEvidence;
  let originalStorage;
  let originalTemperature;
  let originalHistory;
  let originalDates;
  const preserved = () => {
    assert(localStorage.getItem(storageKey) === originalStorage, 'Evidence validation altered the real browser storage');
    assert($('#temperature').textContent === originalTemperature, 'Evidence validation altered the real temperature');
    assert($('#history-body').textContent === originalHistory, 'Evidence validation altered the daily archive display');
  };
  const rejected = (returned) => {
    assert(returned.length === 0, 'A rejected response must not return accepted evidence records');
    assert(rows().length === 0, 'A rejected response must clear all previously verified rows');
    assert($('#review-count').textContent === '확인 필요', 'The review count must show verification is required');
    assert($('#evidence-rows').textContent.includes('대조를 완료하지 못했습니다'), 'The evidence failure explanation is missing');
    assert($('#evidence-delta').textContent.includes('계산하지 않습니다') && !$('#evidence-delta').textContent.includes('='), 'Rejected evidence must not retain a computed delta');
    preserved();
  };
  const replaceJson = (value) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  const inputUrl = (input) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);

  try {
    const ready = await run('actual-evidence-hash-and-value-match', async () => {
      await wait(() => $('#refresh') && !$('#refresh').disabled && window.t04Adapter);
      ({ loadReviewEvidence } = await import(new URL('./weather-view.mjs', location.href).href));
      originalStorage = localStorage.getItem(storageKey);
      originalTemperature = $('#temperature').textContent;
      originalHistory = $('#history-body').textContent;
      const actual = await loadReviewEvidence();
      assert(actual.length >= 1 && actual.length <= 2, 'Expected one or two actual evidence dates');
      assert(rows().length === actual.length && rows().every((row) => row.dataset.matched === 'true'), 'Actual evidence failed its hash/value validation');
      originalDates = rows().map((row) => row.dataset.date);
      assert($('#review-count').textContent === `${actual.length} / 2일`, 'Actual evidence count does not match the verified rows');
      preserved();
      return { realDates: originalDates, verifiedRows: actual.length };
    });
    if (!ready) return report();

    await run('synthetic-response-sha256-mismatch-is-rejected', async () => {
      let intercepted = 0;
      window.fetch = async (input, options) => {
        const url = inputUrl(input);
        const response = await nativeFetch(input, options);
        if (url.origin === location.origin && /^\/data\/evidence\/[0-9TZ.\-]+\.json$/.test(url.pathname)) {
          const altered = await response.json();
          altered.responseSha256 = '0'.repeat(64);
          intercepted += 1;
          return replaceJson(altered);
        }
        return response;
      };
      try {
        const returned = await loadReviewEvidence();
        assert(intercepted === 1, 'Expected the first raw evidence response to be intercepted exactly once');
        rejected(returned);
        assert($('#evidence-rows').textContent.includes('SHA-256 불일치'), 'Hash failure was not identified');
        return { interceptedRawResponses: intercepted, visibleRows: rows().length, reviewCount: $('#review-count').textContent, realStorageUnchanged: true };
      } finally { window.fetch = originalFetch; }
    }, true);

    await run('synthetic-index-date-mismatch-is-rejected', async () => {
      let intercepted = 0;
      window.fetch = async (input, options) => {
        const url = inputUrl(input);
        const response = await nativeFetch(input, options);
        if (url.origin === location.origin && url.pathname === '/data/review-evidence.json') {
          const altered = await response.json();
          assert(altered.records?.length > 0, 'No actual index record is available for the rejection test');
          altered.records[0].reading.kstDate = '1900-01-01';
          intercepted += 1;
          return replaceJson(altered);
        }
        return response;
      };
      try {
        const returned = await loadReviewEvidence();
        assert(intercepted === 1, 'Expected the evidence index to be intercepted exactly once');
        rejected(returned);
        return { interceptedIndexes: intercepted, visibleRows: rows().length, reviewCount: $('#review-count').textContent, realStorageUnchanged: true };
      } finally { window.fetch = originalFetch; }
    }, true);

    await run('actual-evidence-recovers-after-synthetic-rejections', async () => {
      window.fetch = originalFetch;
      const actual = await loadReviewEvidence();
      assert(actual.length === originalDates.length, 'Recovery changed the number of actual evidence records');
      assert(rows().every((row) => row.dataset.matched === 'true'), 'Actual evidence did not recover to verified rows');
      assert(JSON.stringify(rows().map((row) => row.dataset.date)) === JSON.stringify(originalDates), 'Recovery changed the actual evidence dates');
      assert($('#review-count').textContent === `${actual.length} / 2일`, 'Recovery retained the error count');
      assert(!$('#evidence-rows').textContent.includes('대조를 완료하지 못했습니다'), 'Recovery retained the error explanation');
      preserved();
      return { realDates: originalDates, verifiedRows: actual.length, realStorageUnchanged: true };
    });
  } finally {
    window.fetch = originalFetch;
    // Always restore the actual evidence view, including after an unexpected test exception.
    if (loadReviewEvidence && $('#review-count').textContent === '확인 필요') await loadReviewEvidence();
  }
  return report();
})();
