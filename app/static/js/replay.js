/* ═══════════════ Replay Engine ═══════════════ */

const SPEED_STOPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20];
const LOOKBACK_BARS = 30;

/** First display candle whose period ends after T: the candle that contains T, or the first one after it. */
function originIndexOf(agg, originTime, periodSecs) {
    if (originTime == null) return 0;
    const i = agg.findIndex(c => c.time + periodSecs > originTime);
    return i < 0 ? Math.max(0, agg.length - 1) : i;
}

/**
 * Keep at most `bars` display candles before the origin as background.
 * Returns the trimmed base data and the origin index in its aggregation.
 */
function lookbackSlice(baseData, tf, baseMinutes, originTime, bars) {
    const agg = aggregateCandles(baseData, tf);
    const origin = originIndexOf(agg, originTime, Math.max(tf, baseMinutes) * 60);
    if (origin <= bars) return { data: baseData, origin };
    const from = agg[origin - bars].time;
    return { data: baseData.filter(b => b.time >= from), origin: bars };
}

const ReplayEngine = {
    baseData: [],
    baseIntervalMinutes: 5,
    currentTF: 60,
    replayIndex: 0,
    originIndex: 0,   // display index of T; bars before it are background
    originTime: null,
    isPlaying: false,
    speed: 1,
    speedIndex: 3,
    _timer: null,
    _userScrolled: false,
    openOnly: false, // When true, show only the open price of the current candle
    indicatorState: { sma: true, ema: false, bb: false, rsi: false, macd: false, vol: true },

    // Sub-candle mode: when speed < 1x, step through base candles one at a time
    // so the current aggregated candle builds up progressively
    _subMode: false,
    _baseIdx: 0,
    _baseOrigin: 0,   // first base index of the origin candle

    dom: {},

    init() {
        this.dom = {
            playBtn: document.getElementById('btn-play'),
            speedSlider: document.getElementById('speed-slider'),
            speedLabel: document.getElementById('speed-label'),
            speedStops: [...document.querySelectorAll('[data-speed-stop]')],
            progressBar: document.getElementById('progress-bar'),
            barCounter: document.getElementById('bar-counter'),
            datetime: document.getElementById('current-datetime'),
        };

        this.dom.speedSlider.addEventListener('input', () => {
            this.setSpeed(parseInt(this.dom.speedSlider.value, 10));
        });

        this.dom.progressBar.addEventListener('input', () => {
            const total = this._getAgg().length;
            this.replayIndex = this.originIndex + Math.round((parseInt(this.dom.progressBar.value) / 100) * (total - 1 - this.originIndex));
            // Sync base index to end of this aggregated candle
            if (this._subMode) {
                this._baseIdx = aggregatedIndexToBaseIndex(this.baseData, this.currentTF, this.replayIndex);
            }
            this._renderFrame(false);
        });

        document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
        document.getElementById('btn-step-fwd').addEventListener('click', () => this.stepForward());
        document.getElementById('btn-step-back').addEventListener('click', () => this.stepBack());
        document.getElementById('btn-to-start').addEventListener('click', () => this.goToStart());
        document.getElementById('btn-to-end').addEventListener('click', () => this.goToEnd());

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
            switch (e.code) {
                case 'Space': e.preventDefault(); this.togglePlay(); break;
                case 'ArrowRight': e.preventDefault(); this.stepForward(); break;
                case 'ArrowLeft': e.preventDefault(); this.stepBack(); break;
                case 'Equal': case 'NumpadAdd':
                    e.preventDefault();
                    this.setSpeed(this.speedIndex + 1);
                    break;
                case 'Minus': case 'NumpadSubtract':
                    e.preventDefault();
                    this.setSpeed(this.speedIndex - 1);
                    break;
                case 'Home': e.preventDefault(); this.goToStart(); break;
                case 'End': e.preventDefault(); this.goToEnd(); break;
            }
        });

        this.setSpeed(parseInt(this.dom.speedSlider.value, 10), false);
    },

    setSpeed(index, restart) {
        const next = Math.max(0, Math.min(SPEED_STOPS.length - 1, Number.isFinite(index) ? index : this.speedIndex));
        const changed = next !== this.speedIndex;
        this.speedIndex = next;
        this.speed = SPEED_STOPS[next];
        this.dom.speedSlider.value = String(next);
        this._syncSubMode();
        this._updateSpeedLabel();
        if (restart !== false && changed && this.isPlaying) this._restartTimer();
    },

    _updateSpeedLabel() {
        const label = String(this.speed) + '×';
        const sub = this.speed < 1 && this.currentTF > (this.baseIntervalMinutes || 5);
        this.dom.speedLabel.textContent = sub ? label + ' (' + I18n.t('speed.sub') + ')' : label;
        this.dom.speedSlider.setAttribute('aria-valuetext', sub ? label + ', ' + I18n.t('speed.sub') : label);
        this.dom.speedStops.forEach((stop) => {
            stop.classList.toggle('active', Number(stop.dataset.speedStop) === this.speedIndex);
        });
    },

    _setPlayVisual(isPlaying) {
        const use = this.dom.playBtn.querySelector('use');
        if (use) use.setAttribute('href', isPlaying ? '#icon-pause' : '#icon-play');
        this.dom.playBtn.classList.toggle('playing', isPlaying);
        this.dom.playBtn.setAttribute('aria-pressed', String(isPlaying));
    },

    /** Enter or exit sub-candle mode based on current speed and timeframe. */
    _syncSubMode() {
        const shouldBeSub = this.speed < 1 && this.currentTF > (this.baseIntervalMinutes || 5);

        if (!this.baseData.length) {
            this._subMode = false;
            return;
        }

        if (shouldBeSub && !this._subMode) {
            // Entering sub-mode: convert replayIndex to base index
            this._subMode = true;
            this._baseIdx = aggregatedIndexToBaseIndex(this.baseData, this.currentTF, this.replayIndex);
        } else if (!shouldBeSub && this._subMode) {
            // Exiting sub-mode: convert base index to agg index
            this._subMode = false;
            this.replayIndex = baseIndexToAggregatedIndex(this.baseData, this.currentTF, this._baseIdx);
        }
    },

    /** @param {number} [originTime] Unix seconds of T. Omitted: start at the first bar. */
    loadData(data, tf, baseMinutes, originTime) {
        this.pause();
        this.baseIntervalMinutes = baseMinutes || 5;
        this.currentTF = tf || 60;
        this.originTime = originTime == null ? null : originTime;
        const sliced = lookbackSlice(data, this.currentTF, this.baseIntervalMinutes, this.originTime, LOOKBACK_BARS);
        this.baseData = sliced.data;
        this._setOrigin(sliced.origin);
        this.replayIndex = this.originIndex;
        this._baseIdx = this._baseOrigin;
        if (typeof Drawings !== 'undefined') Drawings.clear(); // user drawings live for one load
        this._syncSubMode();
        this._updateSpeedLabel();
        this._renderFrame(true);
    },

    /** Longer series from the same load (background fetch finished). Keeps the first bar and T. */
    extendData(data) {
        const first = this.baseData.length ? this.baseData[0].time : -Infinity;
        this.baseData = data.filter(b => b.time >= first);
    },

    _setOrigin(index) {
        this.originIndex = index;
        const agg = this._getAgg();
        const t = agg[index] ? agg[index].time : 0;
        const b = this.baseData.findIndex(c => c.time >= t);
        this._baseOrigin = b < 0 ? 0 : b;
    },

    switchTimeframe(newTF) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) this.pause();
        const oldAgg = this._getAgg();
        const currentTime = (oldAgg[this.replayIndex] || {}).time || 0;
        this.currentTF = newTF;
        const newAgg = this._getAgg();
        let bestIdx = 0;
        for (let i = 0; i < newAgg.length; i++) {
            if (newAgg[i].time <= currentTime) bestIdx = i;
            else break;
        }
        this._setOrigin(originIndexOf(newAgg, this.originTime, Math.max(newTF, this.baseIntervalMinutes) * 60));
        this.replayIndex = Math.max(bestIdx, this.originIndex);
        this._syncSubMode();
        this._updateSpeedLabel();
        this._renderFrame(true);
        if (wasPlaying) this.play();
    },

    _getAgg() {
        return aggregateCandles(this.baseData, this.currentTF);
    },

    togglePlay() { this.isPlaying ? this.pause() : this.play(); },

    play() {
        if (this.isPlaying) return;
        if (this._subMode) {
            if (this._baseIdx >= this.baseData.length - 1) this._baseIdx = this._baseOrigin;
        } else {
            const total = this._getAgg().length;
            if (this.replayIndex >= total - 1) this.replayIndex = this.originIndex;
        }
        this.isPlaying = true;
        this._setPlayVisual(true);
        this._restartTimer();
    },

    pause() {
        this.isPlaying = false;
        this._setPlayVisual(false);
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    stepForward() {
        if (this._subMode) {
            if (this._baseIdx < this.baseData.length - 1) {
                this._baseIdx++;
                this._renderFrame(false);
            }
        } else {
            const total = this._getAgg().length;
            if (this.replayIndex < total - 1) { this.replayIndex++; this._renderFrame(false); }
        }
    },

    stepBack() {
        if (this._subMode) {
            if (this._baseIdx > this._baseOrigin) { this._baseIdx--; this._renderFrame(false); }
        } else {
            if (this.replayIndex > this.originIndex) { this.replayIndex--; this._renderFrame(false); }
        }
    },

    goToStart() {
        this.pause();
        this.replayIndex = this.originIndex;
        this._baseIdx = this._baseOrigin;
        this._renderFrame(true);
    },

    goToEnd() {
        this.pause();
        this.replayIndex = this._getAgg().length - 1;
        this._baseIdx = this.baseData.length - 1;
        this._renderFrame(true);
    },

    _restartTimer() {
        if (this._timer) clearInterval(this._timer);
        let interval;
        if (this._subMode) {
            // Sub-candle mode: each tick = 1 base candle, interval scales with speed
            interval = Math.max(30, Math.round(400 / this.speed));
        } else {
            interval = Math.max(16, Math.round(500 / this.speed));
        }
        this._timer = setInterval(() => this._tick(), interval);
    },

    _tick() {
        if (this._subMode) {
            if (this._baseIdx >= this.baseData.length - 1) { this.pause(); return; }
            this._baseIdx++;
        } else {
            const total = this._getAgg().length;
            if (this.replayIndex >= total - 1) { this.pause(); return; }
            this.replayIndex++;
        }
        // During live play, DON'T force scroll — just append data
        this._renderFrame(false);
    },

    /**
     * @param {boolean} fitContent - If true, fit chart to content (on load/TF switch/jump).
     *   During normal playback, this is false so the user's scroll position is preserved.
     */
    _renderFrame(fitContent) {
        let visible;

        if (this._subMode) {
            // Sub-candle mode: aggregate only the base data up to _baseIdx
            const slice = this.baseData.slice(0, this._baseIdx + 1);
            visible = aggregateCandles(slice, this.currentTF);
            // Keep replayIndex in sync for progress bar and other systems
            this.replayIndex = visible.length - 1;
        } else {
            const allAgg = this._getAgg();
            const total = allAgg.length;
            if (total === 0) return;
            if (this.replayIndex >= total) this.replayIndex = total - 1;
            if (this.replayIndex < this.originIndex) this.replayIndex = this.originIndex;
            visible = allAgg.slice(0, this.replayIndex + 1);
        }

        if (!visible || visible.length === 0) return;

        // Save the real candle (with full OHLC) BEFORE flattening for open-only
        const realCandle = visible.length > 0 ? { ...visible[visible.length - 1] } : null;

        // Open-only mode: flatten the current (last) candle to just its open price
        if (this.openOnly && visible.length > 0) {
            const last = { ...visible[visible.length - 1] };
            last.high = last.open;
            last.low = last.open;
            last.close = last.open;
            visible[visible.length - 1] = last;
        }

        ChartManager.updateData(visible, this.indicatorState);
        if (typeof Drawings !== 'undefined') Drawings.setLastTime(visible[visible.length - 1].time);

        // Only force-fit on explicit jumps (load, TF switch, go-to-start/end)
        if (fitContent) {
            ChartManager.mainChart.timeScale().fitContent();
        }

        // Use flattened candle for display price, but REAL candle for TP/SL checks
        const displayCandle = visible.length > 0 ? visible[visible.length - 1] : null;

        // Build the tick candle for the trading engine:
        // - high/low from the REAL candle → so TP/SL triggers on actual wicks
        // - close from the DISPLAY candle → so P&L and addon drawdown checks
        //   reflect the price the user actually sees (open in open-only mode)
        if (realCandle && TradingEngine.positions.length > 0) {
            const tickCandle = this.openOnly
                ? { ...realCandle, close: displayCandle.close }
                : realCandle;
            TradingEngine.onTick(tickCandle);
        }

        // Update position lines on chart
        ChartManager.updatePositionLines(TradingEngine.positions, displayCandle ? displayCandle.close : 0);

        // Emit candle to bridge (if connected)
        if (displayCandle && typeof BridgeClient !== 'undefined') BridgeClient.emitCandle(displayCandle);

        // Update UI controls
        const totalAgg = this._getAgg().length;
        const o = this.originIndex, span = totalAgg - 1 - o;
        const pct = span > 0 ? Math.round(((this.replayIndex - o) / span) * 100) : 0;
        this.dom.progressBar.value = pct;
        const counter = `${this.replayIndex - o + 1} / ${totalAgg - o}`;
        if (this._subMode) {
            const bo = this._baseOrigin;
            this.dom.barCounter.textContent = `${counter} (base ${this._baseIdx - bo + 1}/${this.baseData.length - bo})`;
        } else {
            this.dom.barCounter.textContent = counter;
        }
        if (displayCandle) {
            const dt = new Date(displayCandle.time * 1000);
            this.dom.datetime.textContent = dt.toISOString().replace('T', ' ').substring(0, 19);
        }
    },

    getCurrentPrice() {
        const allAgg = this._getAgg();
        const c = allAgg[this.replayIndex];
        if (!c) return 0;
        return this.openOnly ? c.open : c.close;
    },

    updateIndicators(state) {
        this.indicatorState = { ...state };
        this._renderFrame(false);
    },
};
