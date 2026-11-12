/* Market switch. Stage 1: rules and chrome only. No data service. */

const MarketController = {
    id: 'crypto',
    notifier: null,
    onAfterSwitch: null,

    init() {
        const saved = localStorage.getItem('lbr_market');
        this.id = saved === 'ashare' ? 'ashare' : 'crypto';
        if (typeof TradingEngine !== 'undefined') TradingEngine.activateMarket(this.id);
        this.applyChrome({ selectTab: true });
        this.bind();
    },

    bind() {
        document.querySelectorAll('#market-switch .market-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.requestSwitch(btn.dataset.market));
        });
    },

    notify(message, type) {
        if (this.notifier) this.notifier(message, type);
    },

    requestSwitch(nextId) {
        if (nextId !== 'ashare' && nextId !== 'crypto') return;
        if (nextId === this.id) return;
        const dirty = this._isDirty();
        if (dirty) {
            const ok = window.confirm('切换市场会平掉当前可卖持仓，并清空图上的回放。两个市场的资金分开。战绩入库在后续阶段。继续？');
            if (!ok) return;
        }
        if (typeof TradingEngine !== 'undefined' && TradingEngine.positions.length) {
            const reason = TradingEngine.closeForSwitch();
            if (reason) {
                this.notify(reason, 'error');
                window.alert(reason);
                return;
            }
        }
        this.id = nextId;
        localStorage.setItem('lbr_market', nextId);
        TradingEngine.activateMarket(nextId);
        this.applyChrome({ selectTab: true });
        if (this.onAfterSwitch) this.onAfterSwitch();
        this.notify(nextId === 'ashare' ? '已切换到 A股规则' : '已切换到加密货币规则', 'success');
    },

    _isDirty() {
        const hasReplay = typeof ReplayEngine !== 'undefined' && ReplayEngine.baseData && ReplayEngine.baseData.length;
        const hasTrades = typeof TradingEngine !== 'undefined' && (TradingEngine.positions.length || TradingEngine.history.length);
        return Boolean(hasReplay || hasTrades);
    },

    applyChrome(options) {
        const selectTab = Boolean(options && options.selectTab);
        document.body.classList.toggle('market-ashare', this.id === 'ashare');
        document.body.classList.toggle('market-crypto', this.id !== 'ashare');
        document.querySelectorAll('#market-switch .market-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.market === this.id);
        });
        const note = document.getElementById('market-rule-note');
        if (note) {
            note.textContent = this.id === 'ashare'
                ? '当前规则：A股 · 只做多 · 1手=100股 · T+1 · 模拟佣金/印花税 · 杠杆不可用'
                : '当前规则：加密货币 · 可多空 · 杠杆';
        }
        const buy = document.getElementById('side-buy');
        const sell = document.getElementById('side-sell');
        const place = document.getElementById('btn-place-trade');
        const lots = document.getElementById('trade-lots');
        const lotsLabel = document.getElementById('trade-size-label');
        if (this.id === 'ashare') {
            if (buy) buy.textContent = '买入';
            if (sell) sell.textContent = '卖出';
            if (lots) { lots.step = '1'; lots.min = '1'; if (Number(lots.value) < 1) lots.value = '1'; }
            if (lotsLabel) lotsLabel.textContent = '手数';
            if (selectTab) this._showDataTab('ashare');
        } else {
            if (buy) buy.textContent = 'Buy / Long';
            if (sell) sell.textContent = 'Sell / Short';
            if (lots) { lots.step = '0.01'; lots.min = '0.01'; }
            if (lotsLabel) lotsLabel.textContent = 'Size';
            if (selectTab) this._showDataTab('crypto');
        }
        if (place && buy && sell) {
            const side = document.querySelector('.tt-tab.active')?.dataset.side || 'buy';
            place.textContent = this.id === 'ashare'
                ? (side === 'buy' ? '买入' : '卖出')
                : (side === 'buy' ? 'Place Buy' : 'Place Sell');
        }
        const lev = document.getElementById('trade-leverage');
        if (lev) {
            if (this.id === 'ashare') {
                if (lev.value !== '1') this._savedLeverage = lev.value;
                lev.value = '1';
            } else if (this._savedLeverage) {
                lev.value = this._savedLeverage;
            }
        }
    },

    _showDataTab(name) {
        if (typeof window.__lbrShowDataTab === 'function') window.__lbrShowDataTab(name);
    },
};
