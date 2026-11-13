// Runs the browser's aggregation.js + replay.js + data.js in node: origin pointer,
// background slicing and the Binance background window / cache. Network and IDB are stubbed.
// Run: node tests/js/lookback.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = (f) => fs.readFileSync(path.join(__dirname, '../../app/static/js', f), 'utf8');
const H = 3600, M5 = 300;
const T = Date.UTC(2024, 2, 10) / 1000; // 2024-03-10 00:00Z

const el = () => ({ value: 0, textContent: '', classList: { toggle() {} }, setAttribute() {}, querySelector: () => null });
let shown = [];
const idb = {};
let binanceCalls = [];
const ctx = vm.createContext({
    console,
    setTimeout: (f) => f(),
    setInterval: () => 1,
    clearInterval() {},
    URL,
    I18n: { t: (k) => k },
    TradingEngine: { positions: [] },
    ChartManager: {
        updateData(c) { shown = c; },
        updatePositionLines() {},
        mainChart: { timeScale: () => ({ fitContent() {} }) },
    },
    loadFromIDB: async (k) => idb[k] || null,
    saveToIDB: async (k, v) => { idb[k] = v; },
    openDB: async () => ({
        transaction: () => ({ objectStore: () => ({
            getAllKeys() { const req = {}; queueMicrotask(() => { req.result = Object.keys(idb); req.onsuccess(); }); return req; },
        }) }),
    }),
});
vm.runInContext(['aggregation.js', 'replay.js', 'data.js'].map(js).join('\n')
    + '\n;Object.assign(globalThis, { ReplayEngine, LOOKBACK_BARS, lookbackSlice, lookbackStartMs, fetchAllBinanceData, cacheKey, randomStartDate, fetchEarliestBinanceMs, MIN_REMAINING_BARS });', ctx);
const R = ctx.ReplayEngine;
R.dom = { playBtn: el(), speedSlider: el(), speedLabel: el(), speedStops: [], progressBar: el(), barCounter: el(), datetime: el() };

const series = (from, to, step) => {
    const out = [];
    for (let t = from; t < to; t += step) out.push({ time: t, open: t, high: t + 1, low: t - 1, close: t, volume: 1 });
    return out;
};

assert.equal(ctx.LOOKBACK_BARS, 30);

// ── 1h display on 5m base: background is 30 x 1h, visible from frame one, T is index 0 for controls ──
let base = series(T - 3 * 24 * H, T + 2 * 24 * H, M5);
R.loadData(base, 60, 5, T);
assert.equal(R.baseData[0].time, T - 30 * H, 'base trimmed to the 30th background candle');
assert.equal(R.originIndex, 30);
assert.equal(shown.length, 31, 'first frame: 30 background + origin');
assert.equal(shown.at(-1).time, T);
assert.equal(R.dom.progressBar.value, 0);
assert.equal(R.dom.barCounter.textContent, '1 / 48', 'counter excludes background');
R.stepForward(); R.stepForward();
assert.equal(shown.length, 33);
R.goToStart();
assert.equal(shown.length, 31, 'to start stops at T');
R.stepBack();
assert.equal(shown.length, 31, 'step back cannot enter background');
R.goToEnd();
assert.equal(R.dom.progressBar.value, 100);
assert.equal(R.dom.barCounter.textContent, '48 / 48');
R.isPlaying = false; R.play(); R.pause();
assert.equal(R.replayIndex, R.originIndex, 'replay from end restarts at T');

// ── T inside a display candle: that candle is the origin, its earlier base bars are not background ──
R.loadData(base, 60, 5, T + 20 * 60);
assert.equal(shown.at(-1).time, T);
assert.equal(shown.length, 31);

// ── Short history: use what exists, no error ──
R.loadData(series(T - 5 * H, T + 10 * H, M5), 60, 5, T);
assert.equal(R.originIndex, 5);
assert.equal(shown.length, 6);

// ── No origin (CSV / Forex / bridge): unchanged, starts at bar 0 ──
R.loadData(series(T, T + 10 * H, M5), 60, 5);
assert.equal(R.originIndex, 0);
assert.equal(shown.length, 1);

// ── Switching to a bigger TF keeps T as origin; background may be shorter ──
R.loadData(base, 60, 5, T);
R.switchTimeframe(240);
assert.equal(shown.at(-1).time, T);
assert.ok(shown.length >= 8 && shown.length <= 9, 'about 30h / 4h background');
R.goToStart();
assert.equal(shown.at(-1).time, T);

// ── Slow sub-candle mode: base pointer never enters the background ──
R.loadData(base, 60, 5, T);
R.setSpeed(1, false); // 0.25x
assert.equal(R._subMode, true);
R.goToStart();
assert.equal(R._baseIdx, R._baseOrigin);
assert.equal(R.baseData[R._baseOrigin].time, T);
for (let i = 0; i < 5; i++) R.stepBack();
assert.equal(R._baseIdx, R._baseOrigin);
assert.equal(shown.length, 31, 'background visible, origin candle building');
R.setSpeed(3, false);

// ── Daily A-share bars: count bars, not days ──
const days = [];
for (let d = 0; days.length < 80; d++) {
    const t = Date.UTC(2024, 0, 2 + d) / 1000;
    const wd = new Date(t * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6) days.push({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 });
}
const dT = days[50].time - 2 * 86400; // calendar date that may be a weekend
const ds = ctx.lookbackSlice(days, 1440, 1440, dT, 30);
assert.equal(ds.origin, 30);
assert.equal(ds.data.length, 30 + (days.length - days.findIndex(b => b.time >= dT)));

// ── Background window on the display timeframe ──
const startMs = T * 1000;
assert.equal(ctx.lookbackStartMs(startMs, 60, 30), startMs - 30 * H * 1000);
assert.equal(ctx.lookbackStartMs(startMs, 5, 30), startMs - 30 * M5 * 1000);
assert.ok(startMs - ctx.lookbackStartMs(startMs, 60, 30) > 30 * M5 * 1000, '1h window longer than 30 x 5m');

// ── Binance fetch + cache (stubbed network) ──
const END = (T + 2 * H) * 1000;
ctx.fetch = async (url) => {
    const u = new URL(url);
    let s = Number(u.searchParams.get('startTime'));
    const e = Math.min(Number(u.searchParams.get('endTime')) || Infinity, END - 1);
    binanceCalls.push([s, e]);
    s = Math.ceil(s / (M5 * 1000)) * M5 * 1000;
    const rows = [];
    for (let t = s; t <= e && rows.length < 1000; t += M5 * 1000) rows.push([t, '1', '2', '0.5', '1.5', '10']);
    return { ok: true, json: async () => rows };
};
const DATE = '2024-03-10';
const KEY = ctx.cacheKey('BTCUSDT', DATE);
const fromSec = T - 30 * H;

(async () => {
    // Old short cache written before this change: starts at T.
    idb[KEY] = series(T, T + H, M5);
    let got = await ctx.fetchAllBinanceData('BTCUSDT', DATE, null, null, 60);
    assert.equal(got[0].time, fromSec, 'missing background prefix fetched');
    assert.equal(idb[KEY][0].time, fromSec, 'merged result written back to the same key');
    assert.equal(new Set(got.map(b => b.time)).size, got.length, 'no duplicate bars');

    binanceCalls = [];
    got = await ctx.fetchAllBinanceData('BTCUSDT', DATE, null, null, 60);
    assert.equal(got[0].time, fromSec, 'repeat fetch of the same day keeps background');
    assert.ok(binanceCalls.every(([s]) => s > T * 1000), 'no prefix refetch once covered');

    // Fresh fetch starts at the window, not at T.
    for (const k of Object.keys(idb)) delete idb[k];
    binanceCalls = [];
    got = await ctx.fetchAllBinanceData('BTCUSDT', DATE, null, null, 60);
    assert.equal(binanceCalls[0][0], fromSec * 1000);
    R.loadData(got, 60, 5, T);
    assert.equal(shown.length, 31);

    // ── Random start (crypto): earliest bar via startTime=0, fallback to 1 ──
    const DAY = 86400000;
    assert.equal(ctx.MIN_REMAINING_BARS, 60);
    const earliest = Date.UTC(2020, 0, 1, 7);
    const now = Date.UTC(2020, 6, 1);
    const first = ctx.randomStartDate(earliest, now, 60, () => 0);
    const last = ctx.randomStartDate(earliest, now, 60, () => 0.999999);
    assert.equal(first, '2020-01-03', 'first whole UTC day with 30 x 1h before it');
    assert.ok(Date.parse(last) <= now - 60 * H * 1000, '60 x 1h left after the last pick');
    assert.ok(Date.parse(first) - earliest >= 30 * H * 1000);
    assert.equal(ctx.randomStartDate(earliest, earliest + 80 * DAY, 1440), null, '1D needs ~90 days');
    assert.ok(ctx.randomStartDate(earliest, earliest + 92 * DAY, 1440));
    assert.match(ctx.randomStartDate(earliest, now, 60), /^\d{4}-\d{2}-\d{2}$/);

    const seen = [];
    ctx.fetch = async (url) => {
        const s = new URL(url).searchParams.get('startTime');
        seen.push(s);
        if (s === '0') return { ok: false, status: 400, statusText: 'Bad Request' };
        return { ok: true, json: async () => [[earliest, '1', '1', '1', '1', '1']] };
    };
    assert.equal(await ctx.fetchEarliestBinanceMs('BTCUSDT'), earliest);
    assert.deepEqual(seen, ['0', '1']);

    console.log('lookback: ok');
})().catch((e) => { console.error(e); process.exit(1); });
