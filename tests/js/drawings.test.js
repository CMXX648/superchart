// Runs the browser's chart.js + drawings.js in node against a stubbed Lightweight Charts
// and DOM: TP/SL pick vs drawing mode, clear/delete/undo, ray hiding and clipping.
// Run: node tests/js/drawings.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = (f) => fs.readFileSync(path.join(__dirname, '../../app/static/js', f), 'utf8');

const lines = new Set();
let updates = 0, primitive = null;
const series = () => ({
    data: [],
    setData(d) { this.data = d; },
    createPriceLine(o) { const l = { options: { ...o }, applyOptions(p) { Object.assign(this.options, p); } }; lines.add(l); return l; },
    removePriceLine(l) { lines.delete(l); },
    priceToCoordinate: (p) => 500 - p,
    coordinateToPrice: (y) => 500 - y,
    attachPrimitive(p) { primitive = p; p.attached({ requestUpdate: () => updates++ }); },
});
let main = null;
const timeScale = {
    width: () => 800,
    timeToCoordinate(t) { const i = main.data.findIndex(c => c.time === t); return i < 0 ? null : i * 10; },
    coordinateToLogical: (x) => x / 10,
    logicalToCoordinate: (l) => l * 10,
    fitContent() {}, subscribeVisibleLogicalRangeChange() {}, setVisibleLogicalRange() {},
};
const chartStub = () => ({
    addSeries() { const s = series(); if (!main) main = s; return s; },
    timeScale: () => timeScale, resize() {}, remove() {},
});

const els = {};
const elem = (id) => els[id] || (els[id] = {
    id, value: '', style: {}, dataset: {}, listeners: {}, clientWidth: 800, clientHeight: 500,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setAttribute() {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
});
const toolBtns = ['hline', 'ray'].map((t) => { const b = elem('btn-draw-' + t); b.dataset.drawTool = t; return b; });
const docListeners = {};
const ctx = vm.createContext({
    console,
    LightweightCharts: { createChart: chartStub, CandlestickSeries: 1, LineSeries: 2, HistogramSeries: 3 },
    document: {
        getElementById: elem,
        querySelectorAll: (sel) => (sel === '[data-draw-tool]' ? toolBtns : []),
        addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    },
    window: { addEventListener() {} },
    requestAnimationFrame: () => 1,
});
vm.runInContext(js('chart.js') + '\n' + js('drawings.js') + '\n;Object.assign(globalThis, { ChartManager, Drawings, rayEnd });', ctx);
const { ChartManager, Drawings, rayEnd } = ctx;
ChartManager.init();
assert.ok(primitive, 'ray layer attached as a series primitive');

const click = (x, y) => elem('chart-main').listeners.click.forEach(fn => fn({ clientX: x, clientY: y }));
const key = (e) => docListeners.keydown.forEach(fn => fn({ target: {}, preventDefault() {}, ...e }));
const candles = Array.from({ length: 10 }, (_, i) => ({ time: 1000 + i * 60, open: 100, high: 101, low: 99, close: 100 }));
const NO_IND = { vol: false, sma: false, ema: false, bb: false, rsi: false, macd: false };
const show = (n) => { ChartManager.updateData(candles.slice(0, n), NO_IND); Drawings.setLastTime(candles[n - 1].time); };
const strokes = () => {
    const out = [];
    const c = { moveTo(x, y) { out.push([x, y]); }, lineTo(x, y) { out.at(-1).push(x, y); }, beginPath() {}, stroke() {} };
    primitive.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (cb) => cb({ context: c, mediaSize: { width: 800, height: 500 } }) });
    return out;
};
show(10);

// ── TP/SL pick: a click sets TP only, no user line ──
ChartManager.enterPickMode('tp');
click(50, 400);
assert.equal(elem('trade-tp').value, '100.00');
assert.equal(Drawings.items.length, 0, 'pick click does not draw');

// ── Drawing mode: a click draws, never touches TP/SL ──
Drawings.setMode('hline');
elem('trade-tp').value = 'keep';
click(50, 380);
assert.equal(elem('trade-tp').value, 'keep');
assert.equal(Drawings.items.length, 1);
assert.equal(Drawings.items[0].price, 120);
assert.equal(Drawings.mode, null, 'tool is one-shot');

// ── The two modes exclude each other ──
Drawings.setMode('ray');
ChartManager.enterPickMode('sl');
assert.equal(Drawings.mode, null);
Drawings.setMode('ray');
assert.equal(ChartManager._pickMode, null);

// ── Ray: anchor on bar 3, through bar 6, extends to the pane edge only forward ──
click(31, 400);
click(60, 380);
const ray = Drawings.items[1];
assert.equal(ray.type, 'ray');
assert.equal(ray.time, candles[3].time);
let s = strokes();
assert.equal(s.length, 1);
assert.deepEqual(s[0], [30, 400, 630, 0]);

// Step back before the anchor: hidden. Forward again: back. H-line keeps its price.
updates = 0;
show(3);
assert.ok(updates > 0, 'frame asks the primitive to redraw');
assert.equal(strokes().length, 0, 'ray hidden while anchor is in the future');
show(4);
assert.equal(strokes().length, 1);
show(10);
assert.ok(lines.has(Drawings.items[0].line));
assert.equal(Drawings.items[0].line.options.price, 120);

// ── Clear leaves position lines and bridge drawings ──
ChartManager.updatePositionLines([{ id: 1, side: 'buy', entryPrice: 100, lots: 1, tp: 110 }], 100);
const bridgeLine = ChartManager.candleSeries.createPriceLine({ price: 90, title: 'bridge' });
const before = lines.size;

// Selection only hits user lines: clicking the entry line selects nothing.
click(50, 400);
assert.equal(Drawings.selected, null);
click(700, 382);
assert.equal(Drawings.selected, Drawings.items[0]);
assert.equal(Drawings.items[0].line.options.color, '#2962ff');
key({ key: 'Delete', code: 'Delete' });
assert.equal(Drawings.items.length, 1);
assert.equal(lines.size, before - 1);
Drawings.setMode('hline'); click(10, 300);
Drawings.setMode('hline'); click(10, 250);
key({ code: 'KeyZ', key: 'z', ctrlKey: true });
assert.equal(Drawings.items.length, 2, 'undo removes the last one');
Drawings.clear();
assert.equal(Drawings.items.length, 0);
assert.ok(lines.has(bridgeLine), 'bridge line stays');
assert.equal(ChartManager._positionLines.length, 1);
assert.ok(lines.has(ChartManager._positionLines[0].entryLine), 'position line stays');

// clearAll (market switch) clears user drawings too.
Drawings.setMode('hline'); click(10, 300);
ChartManager.clearAll();
assert.equal(Drawings.items.length, 0);

// ── Clipping ──
assert.deepEqual({ ...rayEnd(100, 100, 50, 100, 800, 500) }, { x: 0, y: 100 }, 'leftward ray');
assert.deepEqual({ ...rayEnd(100, 100, 100, 150, 800, 500) }, { x: 100, y: 500 });
assert.equal(rayEnd(-10, 100, -20, 100, 800, 500), null, 'off-pane anchor pointing away');
assert.equal(rayEnd(1, 1, 1, 1, 800, 500), null);

console.log('drawings: ok');
