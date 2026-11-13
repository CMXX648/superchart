// Runs the browser's bridge.js + trading.js + rules in node and drives them
// with bridge messages. Run: node tests/js/bridge_rules.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = (f) => fs.readFileSync(path.join(__dirname, '../../app/static/js', f), 'utf8');
const day = (d) => Date.UTC(2024, 2, d) / 1000;

const ctx = vm.createContext({
    console: { log() {}, warn() {} },
    document: { getElementById: () => null, dispatchEvent() {} },
    CustomEvent: class {},
    ReplayEngine: {
        bars: [], replayIndex: 0, openOnly: false, _subMode: false,
        _getAgg() { return this.bars; },
        getCurrentPrice() { const c = this.bars[this.replayIndex]; return c ? c.close : 0; },
        loadData() {}, play() {},
    },
    ChartManager: { _lastCandles: [] },
    setTimeout() {},
});
const code = ['i18n.js', 'rules/ashare.js', 'rules/crypto.js', 'trading.js', 'bridge.js'].map(js).join('\n');
vm.runInContext(code + '\n;Object.assign(globalThis, { I18n, TradingEngine, BridgeClient });', ctx);
const { I18n, TradingEngine, BridgeClient, ReplayEngine } = ctx;
TradingEngine.updateUI = () => {};

const replies = [];
BridgeClient._send = (m) => replies.push(m);
let rid = 0;
const send = (msg) => {
    BridgeClient._handleMessage({ ...msg, request_id: String(++rid) });
    const r = replies.pop();
    assert.equal(r.request_id, String(rid), `no reply for ${msg.type}`);
    return r.data;
};
const at = (bars, i) => { ReplayEngine.bars = bars; ReplayEngine.replayIndex = i; };

// ── A-share ──
const bars = [
    { time: day(1), open: 10, high: 10, low: 10, close: 10 },
    { time: day(4), open: 11, high: 11, low: 11, close: 11 },
];
TradingEngine.activateMarket('ashare');
at(bars, 0);

let r = send({ type: 'place_trade', side: 'buy', lots: 0.5 });
assert.deepEqual({ ...r }, { error: I18n.t('ashare.lot'), market: 'ashare' }, 'odd lot rejected');

r = send({ type: 'place_trade', side: 'sell', lots: 1 });
assert.equal(r.error, I18n.t('ashare.noShort'), 'no short without shares');

r = send({ type: 'place_trade', side: 'buy', lots: 2000 });
assert.equal(r.error, I18n.t('ashare.noCash'), 'whole order rejected when cash short');
assert.equal(TradingEngine.balance, 100000);

r = send({ type: 'place_trade', side: 'buy', lots: 1, leverage: 10 });
assert.equal(r.market, 'ashare');
assert.equal(r.leverage, 1, 'A-share leverage forced to 1');
assert.equal(r.lots, 1);
assert.equal(TradingEngine.balance, 100000 - 1000 - 5, 'buy pays min commission 5');
const posId = r.position_id;

r = send({ type: 'place_trade', side: 'sell', lots: 1 });
assert.equal(r.error, I18n.t('ashare.noShort'), 'same-day sell blocked by T+1');
r = send({ type: 'close_trade', position_id: posId });
assert.equal(r.error, I18n.t('err.t1sell'), 'same-day close blocked by T+1');
r = send({ type: 'close_all' });
assert.equal(r.error, I18n.t('err.t1partial'));
assert.equal(r.open, 1);
assert.equal(TradingEngine.positions.length, 1);

r = send({ type: 'load_data', candles: bars, asset_type: 'forex', timeframe: 1440 });
assert.equal(r.asset_type, 'ashare', 'load_data cannot leave A-share rules');
assert.equal(TradingEngine.assetType, 'ashare');

// load_data resets the account; buy again on day 1, sell on day 2.
at(bars, 0);
send({ type: 'place_trade', side: 'buy', lots: 1 });
at(bars, 1);
r = send({ type: 'place_trade', side: 'sell', lots: 2 });
assert.equal(r.error, I18n.t('ashare.sellLimit', { have: 1, want: 2 }));
r = send({ type: 'place_trade', side: 'sell', lots: 1 });
assert.equal(r.closed, true);
assert.equal(r.exit_price, 11);
const last = TradingEngine.history.at(-1);
assert.ok(Math.abs(last.fee - (5 + 1.1)) < 1e-9, 'sell pays commission + stamp tax');
assert.ok(Math.abs(last.pnl - (1100 - 6.1 - 1005)) < 1e-9, 'lot-cost PnL');
assert.ok(Math.abs(TradingEngine.balance - (100000 - 1005 + 1100 - 6.1)) < 1e-9);

// ── Crypto: unchanged formula price diff × lots × leverage ──
TradingEngine.activateMarket('crypto');
const cbars = [
    { time: day(1), open: 100, high: 100, low: 100, close: 100 },
    { time: day(2), open: 110, high: 110, low: 110, close: 110 },
];
at(cbars, 0);
r = send({ type: 'place_trade', side: 'sell', lots: 0.1, leverage: 10 });
assert.equal(r.market, 'crypto');
assert.equal(r.leverage, 10, 'crypto keeps leverage');
at(cbars, 1);
r = send({ type: 'close_trade', position_id: r.position_id });
assert.deepEqual({ ...r }, { ok: true });
assert.ok(Math.abs(TradingEngine.history.at(-1).pnl - -10) < 1e-9, 'short: (100-110)×0.1×10');
assert.equal(TradingEngine.balance, 10000 - 10);

console.log('bridge rules: ok');
