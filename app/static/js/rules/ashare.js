/* A-share cash-account rules. Long only, board lots, T+1, simulated fees. */

const AshareRules = {
    id: 'ashare',
    lotSize: 100,
    commissionRate: 0.0003,
    minCommission: 5,
    stampTaxRate: 0.001,
    defaultCapital: 100000,

    commission(amount) {
        return Math.max(amount * this.commissionRate, this.minCommission);
    },

    stamp(amount) {
        return amount * this.stampTaxRate;
    },

    tradeDate(bar) {
        if (!bar || !bar.time) return '';
        const ms = Number(bar.time) > 1e12 ? Number(bar.time) : Number(bar.time) * 1000;
        if (!Number.isFinite(ms)) return '';
        return new Date(ms).toISOString().slice(0, 10);
    },

    currentBar() {
        if (typeof ReplayEngine === 'undefined' || typeof ReplayEngine._getAgg !== 'function') return null;
        const agg = ReplayEngine._getAgg() || [];
        return agg[ReplayEngine.replayIndex] || null;
    },

    canSell(pos, bar) {
        const day = this.tradeDate(bar);
        if (!day || !pos || !pos.openDate) return false;
        return pos.openDate < day;
    },

    availableShares(positions, bar) {
        return (positions || []).reduce((sum, pos) => {
            if (!this.canSell(pos, bar)) return sum;
            return sum + (pos.shares || 0);
        }, 0);
    },

    canOpen(order, engine) {
        const lots = Number(order.lots);
        if (!Number.isInteger(lots) || lots <= 0) {
            return { ok: false, reason: 'A股数量必须是整数手（1手=100股）' };
        }
        const bar = order.bar || this.currentBar();
        if (order.side === 'sell') {
            const available = this.availableShares(engine.positions, bar);
            const want = lots * this.lotSize;
            if (available <= 0) {
                return { ok: false, reason: 'A股不能开空；没有可卖数量（当日买入受 T+1 限制）' };
            }
            if (want > available) {
                return { ok: false, reason: `可卖 ${available / this.lotSize} 手，不能卖出 ${lots} 手` };
            }
            return { ok: true, action: 'close', shares: want, bar };
        }
        const price = Number(order.price);
        if (!(price > 0)) return { ok: false, reason: '没有可用价格' };
        const shares = lots * this.lotSize;
        const amount = shares * price;
        const fee = this.commission(amount);
        if (engine.balance < amount + fee) {
            return { ok: false, reason: '可用资金不足（含模拟佣金）' };
        }
        return { ok: true, action: 'open', shares, amount, fee, bar };
    },

    unrealized(pos, price) {
        const shares = pos.shares || (pos.lots * this.lotSize);
        const amount = shares * price;
        const proceeds = amount - this.commission(amount) - this.stamp(amount);
        const cost = pos.cost || ((pos.entryPrice * shares) + (pos.openFee || 0));
        return proceeds - cost;
    },
};
