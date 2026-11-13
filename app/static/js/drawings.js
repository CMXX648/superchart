/* ═══════════════ User drawings: horizontal lines and rays ═══════════════
 * Live only for the current load. Not saved, not sent to AI, separate from
 * position lines (ChartManager._positionLines) and bridge drawings (BridgeClient.drawings).
 */

/** Where the ray from (x1,y1) through (x2,y2) leaves a w×h pane. Null if it never enters forward. */
function rayEnd(x1, y1, x2, y2, w, h) {
    const dx = x2 - x1, dy = y2 - y1;
    if (!dx && !dy) return null;
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (w - x1) / dx);
    if (dx < 0) t = Math.min(t, -x1 / dx);
    if (dy > 0) t = Math.min(t, (h - y1) / dy);
    if (dy < 0) t = Math.min(t, -y1 / dy);
    return t > 0 && t < Infinity ? { x: x1 + dx * t, y: y1 + dy * t } : null;
}

function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const HIT_PX = 5;
const LINE_COLOR = '#d1d4dc', SELECTED_COLOR = '#2962ff';

const Drawings = {
    mode: null,      // null | 'hline' | 'ray'
    items: [],       // { type: 'hline', price, line } | { type: 'ray', time, price, dl, dp }
    selected: null,
    _first: null,    // first ray click: { time, price, logical }
    _lastTime: null, // last visible candle; rays anchored later are hidden
    _pane: { w: 0, h: 0 },
    _requestUpdate: null,

    init() {
        const chartEl = document.getElementById('chart-main');
        ChartManager.candleSeries.attachPrimitive(this._primitive());
        chartEl.addEventListener('click', (e) => this._onClick(e, chartEl));
        document.querySelectorAll('[data-draw-tool]').forEach((btn) => {
            btn.addEventListener('click', () => this.setMode(this.mode === btn.dataset.drawTool ? null : btn.dataset.drawTool));
        });
        document.getElementById('btn-draw-clear').addEventListener('click', () => this.clear());
        document.addEventListener('keydown', (e) => this._onKey(e));
    },

    setMode(mode) {
        if (mode) ChartManager.exitPickMode();
        this.mode = mode || null;
        this._first = null;
        document.querySelectorAll('[data-draw-tool]').forEach((btn) => {
            const on = btn.dataset.drawTool === this.mode;
            btn.classList.toggle('ctrl-active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
        document.getElementById('chart-main').classList.toggle('draw-active', !!this.mode);
    },

    setLastTime(time) {
        this._lastTime = time;
        this._update();
    },

    clear() {
        for (const item of this.items) this._detach(item);
        this.items = [];
        this.selected = null;
        this._first = null;
        this._update();
    },

    undo() {
        if (this.items.length) this.remove(this.items[this.items.length - 1]);
    },

    remove(item) {
        const i = this.items.indexOf(item);
        if (i < 0) return;
        this._detach(item);
        this.items.splice(i, 1);
        if (this.selected === item) this.selected = null;
        this._update();
    },

    _detach(item) {
        if (item.line) { try { ChartManager.candleSeries.removePriceLine(item.line); } catch (e) { } }
    },

    _update() {
        if (this._requestUpdate) this._requestUpdate();
    },

    _onClick(e, chartEl) {
        if (ChartManager._pickMode) return; // TP/SL pick owns this click
        const rect = chartEl.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const timeScale = ChartManager.mainChart.timeScale();
        if (x > timeScale.width()) return; // price axis
        if (!this.mode) { this._select(this._hit(x, y)); return; }
        const series = ChartManager.candleSeries;
        const price = series.coordinateToPrice(y);
        if (price === null) return;

        if (this.mode === 'hline') {
            const line = series.createPriceLine({ price, color: LINE_COLOR, lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '' });
            this._add({ type: 'hline', price, line });
            return;
        }
        const logical = timeScale.coordinateToLogical(x);
        const candles = ChartManager._lastCandles || [];
        if (logical === null || !candles.length) return;
        if (!this._first) {
            const idx = Math.max(0, Math.min(candles.length - 1, Math.round(logical)));
            this._first = { time: candles[idx].time, price, logical: idx };
            return;
        }
        const dl = logical - this._first.logical, dp = price - this._first.price;
        if (!dl && !dp) return;
        this._add({ type: 'ray', time: this._first.time, price: this._first.price, dl, dp });
    },

    _add(item) {
        this.items.push(item);
        this.setMode(null);
        this._update();
    },

    _onKey(e) {
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
            e.preventDefault();
            this.remove(this.selected);
        } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && this.items.length) {
            e.preventDefault();
            this.undo();
        } else if (e.code === 'Escape') {
            this.setMode(null);
            this._select(null);
        }
    },

    _select(item) {
        const prev = this.selected;
        this.selected = item;
        for (const it of [prev, item]) {
            if (it && it.line) it.line.applyOptions({ color: it === item ? SELECTED_COLOR : LINE_COLOR, lineWidth: it === item ? 2 : 1 });
        }
        this._update();
    },

    // Only user items are tested, so position lines and bridge lines are never picked.
    _hit(x, y) {
        for (let i = this.items.length - 1; i >= 0; i--) {
            const it = this.items[i];
            if (it.type === 'hline') {
                const py = ChartManager.candleSeries.priceToCoordinate(it.price);
                if (py !== null && Math.abs(py - y) <= HIT_PX) return it;
            } else {
                const s = this._segment(it);
                if (s && distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= HIT_PX) return it;
            }
        }
        return null;
    },

    /** Ray in pixels: anchor bar + clicked price, through the second point, clipped to the pane. */
    _segment(ray) {
        if (this._lastTime !== null && ray.time > this._lastTime) return null;
        const timeScale = ChartManager.mainChart.timeScale();
        const series = ChartManager.candleSeries;
        const x1 = timeScale.timeToCoordinate(ray.time);
        if (x1 === null) return null;
        const l1 = timeScale.coordinateToLogical(x1);
        const x2 = l1 === null ? null : timeScale.logicalToCoordinate(l1 + ray.dl);
        const y1 = series.priceToCoordinate(ray.price);
        const y2 = series.priceToCoordinate(ray.price + ray.dp);
        if (x2 === null || y1 === null || y2 === null) return null;
        const end = rayEnd(x1, y1, x2, y2, this._pane.w, this._pane.h);
        return end && { x1, y1, x2: end.x, y2: end.y };
    },

    _primitive() {
        const self = this;
        const renderer = {
            draw(target) {
                target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
                    self._pane = { w: mediaSize.width, h: mediaSize.height };
                    for (const it of self.items) {
                        if (it.type !== 'ray') continue;
                        const s = self._segment(it);
                        if (!s) continue;
                        ctx.strokeStyle = it === self.selected ? SELECTED_COLOR : LINE_COLOR;
                        ctx.lineWidth = it === self.selected ? 2 : 1;
                        ctx.beginPath();
                        ctx.moveTo(s.x1, s.y1);
                        ctx.lineTo(s.x2, s.y2);
                        ctx.stroke();
                    }
                });
            },
        };
        const view = { renderer: () => renderer };
        return {
            attached({ requestUpdate }) { self._requestUpdate = requestUpdate; },
            detached() { self._requestUpdate = null; },
            updateAllViews() { },
            paneViews: () => [view],
        };
    },
};
