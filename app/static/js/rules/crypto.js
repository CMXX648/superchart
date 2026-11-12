/* Crypto trading rule. Formula is the original LocalBarReplay calculation. */

const CryptoRules = {
    id: 'crypto',

    calcPnL(pos, currentPrice) {
        const dir = pos.side === 'buy' ? 1 : -1;
        const priceDiff = (currentPrice - pos.entryPrice) * dir;
        return priceDiff * pos.lots * pos.leverage;
    },
};
