// A Binance page that never answers must not leave "Fetching page 1…" up forever:
// fetchAllBinanceData has to reject so app.js replaces the spinner with an error.
// Network and IDB are stubbed. Run: node tests/js/binance_fetch.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = (f) => fs.readFileSync(path.join(__dirname, '../../app/static/js', f), 'utf8');
const progress = [];
let calls = 0;
const ctx = vm.createContext({
    console, URL, AbortController,
    setTimeout: (f, ms) => setTimeout(f, (ms || 0) / 100), // 15 s timeout runs in 150 ms
    clearTimeout,
    loadFromIDB: async () => null,
    saveToIDB: async () => {},
    openDB: async () => ({
        transaction: () => ({ objectStore: () => ({
            getAllKeys() { const req = {}; queueMicrotask(() => { req.result = []; req.onsuccess(); }); return req; },
        }) }),
    }),
    // Stalled request: never resolves; only an abort ends it, like the browser's fetch.
    fetch: (url, opts) => {
        calls++;
        return new Promise((resolve, reject) => {
            const signal = opts && opts.signal;
            if (signal) signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
    },
});
vm.runInContext(['aggregation.js', 'replay.js', 'data.js'].map(js).join('\n') + '\n;Object.assign(globalThis, { fetchAllBinanceData });', ctx);

(async () => {
    const run = ctx.fetchAllBinanceData('BTCUSDT', '2019-01-01', (m) => progress.push(m), () => {}, 60)
        .then(() => 'resolved', (e) => e);
    const outcome = await Promise.race([run, new Promise(r => setTimeout(() => r('still pending'), 3000))]);
    assert.notEqual(outcome, 'still pending', 'stalled Binance page hangs the fetch forever');
    assert.equal(typeof outcome.message, 'string', 'stalled page must reject, got ' + outcome);
    assert.match(outcome.message, /timed out/);
    assert.equal(calls, 1);
    assert.match(progress.at(-1), /Fetching page 1/);
    console.log('binance fetch: ok');
})().catch((e) => { console.error(e); process.exit(1); });
