/* Talks to the Flask host. Offline file:// mode stays usable. */

const Companion = {
    online: false,
    sessionId: null,
    username: 'local',
    meta: null,

    async init() {
        this.username = localStorage.getItem('lbr_username') || 'local';
        const input = document.getElementById('lbr-user');
        if (input) {
            input.value = this.username;
            input.addEventListener('change', () => {
                this.username = (input.value || 'local').trim() || 'local';
                localStorage.setItem('lbr_username', this.username);
                this.ensureUser();
            });
        }
        try {
            const response = await fetch('/api/health');
            this.online = response.ok;
        } catch (err) {
            this.online = false;
        }
        this._paintStatus();
        if (this.online) this.ensureUser();
    },

    _paintStatus() {
        const el = document.getElementById('server-status');
        if (!el) return;
        el.textContent = I18n.t(this.online ? 'server.online' : 'server.offline');
        el.classList.toggle('online', this.online);
    },

    async ensureUser() {
        if (!this.online) return;
        await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: this.username }),
        });
    },

    async startSession(info) {
        if (!this.online) return;
        await this.completeSession();
        this.sessionId = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID().replace(/-/g, '')
            : String(Date.now());
        this.meta = {
            market: info.market,
            symbol: info.symbol,
            adjust: info.adjust || '',
            initialCapital: info.initialCapital,
        };
        await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: this.sessionId,
                username: this.username,
                market: info.market,
                symbol: info.symbol,
                adjust: info.adjust || '',
                initial_capital: info.initialCapital,
            }),
        });
    },

    async completeSession() {
        if (!this.online || !this.sessionId || typeof TradingEngine === 'undefined') return false;
        const finalCapital = TradingEngine.balance;
        const initial = TradingEngine.startingBalance || finalCapital;
        const totalReturn = initial ? ((finalCapital - initial) / initial) * 100 : 0;
        const response = await fetch('/api/sessions/' + this.sessionId + '/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                final_capital: finalCapital,
                total_return: totalReturn,
                trade_count: TradingEngine.history.length,
            }),
        });
        if (!response.ok) return false;
        this.sessionId = null;
        return true;
    },

    snapshotReport() {
        const engine = (typeof TradingEngine !== 'undefined') ? TradingEngine : null;
        const history = engine && engine.history ? engine.history : [];
        const finalCapital = engine ? engine.balance : null;
        const initial = engine ? (engine.startingBalance || finalCapital) : null;
        const totalReturn = initial ? ((finalCapital - initial) / initial) * 100 : 0;
        const market = (this.meta && this.meta.market)
            || ((typeof MarketController !== 'undefined' && MarketController.id === 'ashare') ? 'ashare' : 'crypto');
        return {
            session_id: this.sessionId,
            market: market,
            symbol: (this.meta && this.meta.symbol) || '',
            lang: (typeof I18n !== 'undefined' && I18n.lang) || 'zh',
            initial_capital: initial,
            final_capital: finalCapital,
            total_return: totalReturn,
            trades: history.slice(-40).map(function (item) {
                return {
                    symbol: item.symbol || '',
                    side: item.side,
                    lots: item.lots,
                    leverage: item.leverage,
                    entry_price: item.entryPrice,
                    exit_price: item.exitPrice,
                    pnl: item.pnl,
                    fee: item.fee || 0,
                    open_date: item.openDate || '',
                    tp: item.tp,
                    sl: item.sl,
                };
            }),
        };
    },

    async endSession() {
        if (!this.online) return { error: 'offline' };
        if (!this.sessionId) return { error: 'no-session' };
        if (typeof TradingEngine !== 'undefined' && TradingEngine.positions && TradingEngine.positions.length) {
            return { error: 'open' };
        }
        const report = this.snapshotReport();
        const ok = await this.completeSession();
        if (!ok) return { error: 'complete' };
        return { report: report };
    },

    recordClosedTrade(record) {
        if (!this.online || !record) return;
        const market = (typeof MarketController !== 'undefined' && MarketController.id === 'ashare')
            ? 'ashare'
            : (record.market || 'crypto');
        fetch('/api/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: this.sessionId,
                username: this.username,
                market: market,
                symbol: record.symbol,
                side: record.side,
                lots: record.lots,
                leverage: record.leverage,
                entry_price: record.entryPrice,
                exit_price: record.exitPrice,
                pnl: record.pnl,
                fee: record.fee || 0,
                open_date: record.openDate || '',
                close_time: record.closeTime ? new Date(record.closeTime).toISOString() : '',
                payload: record,
            }),
        }).catch(function () {});
    },

    saveCandles(info) {
        if (!this.online || !info || !info.candles || !info.candles.length) return;
        fetch('/api/candles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(info),
        }).catch(function () {});
    },

    async listSessions() {
        if (!this.online) return [];
        const response = await fetch('/api/users/' + encodeURIComponent(this.username) + '/sessions');
        if (!response.ok) return [];
        return response.json();
    },

    async listTrades() {
        if (!this.online) return [];
        const response = await fetch('/api/users/' + encodeURIComponent(this.username) + '/trades');
        if (!response.ok) return [];
        return response.json();
    },

    async fetchAshare(code, start, adjust, refresh) {
        const params = new URLSearchParams({
            code: code,
            start: start || '',
            adjust: adjust || 'qfq',
            refresh: refresh ? '1' : '0',
        });
        const response = await fetch('/api/ashare/klines?' + params.toString());
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'A-share request failed');
        return data;
    },
};
