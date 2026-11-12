/* ═══════════════ Main Application ═══════════════ */

(function () {
    'use strict';
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    // ─── DOM refs ───
    const tabs = $$('#tabs .tab');
    const tabContents = { crypto: $('#tab-crypto'), forex: $('#tab-forex'), csv: $('#tab-csv'), ashare: $('#tab-ashare') };
    const statusBar = $('#status-bar');
    const cryptoSymbol = $('#crypto-symbol'), cryptoCustom = $('#crypto-custom');
    const cryptoDate = $('#crypto-date'), tfSelect = $('#timeframe');
    const btnFetch = $('#btn-fetch-binance'), btnDownload = $('#btn-download-csv'), btnClearCache = $('#btn-clear-cache');
    const forexSymbol = $('#forex-symbol'), forexDate = $('#forex-date');
    const btnMT5 = $('#btn-fetch-mt5');
    const csvFile = $('#csv-file');

    // ─── Clear Cache ───
    btnClearCache.addEventListener('click', async () => {
        if (!confirm('Delete all cached historical data? You will need to re-fetch.')) return;
        await clearAllCandles();
        alert('Cache cleared.');
    });
    const csvModal = $('#csv-modal'), csvMappingTable = $('#csv-mapping-table');
    const csvConfirm = $('#csv-confirm'), csvCancel = $('#csv-cancel');

    // Trading
    const tradeTabs = $$('.tt-tab');
    const tradeLots = $('#trade-lots'), tradeUSDT = $('#trade-usdt');
    const tradeLeverage = $('#trade-leverage');
    const tradeTP = $('#trade-tp'), tradeSL = $('#trade-sl');
    const btnPlaceTrade = $('#btn-place-trade'), btnCloseAll = $('#btn-close-all');

    // Indicators
    const btnIndicators = $('#btn-indicators');
    const indDropdown = $('#ind-dropdown');
    const indApply = $('#ind-apply');
    const indicatorChecks = $$('#ind-dropdown input[data-ind]');

    // PineScript
    const pineModal = $('#pine-modal');
    const pineName = $('#pine-name'), pineCode = $('#pine-code');
    const pineSave = $('#pine-save'), pineCancel = $('#pine-cancel');
    const btnPineNew = $('#btn-pine-new');
    const pineList = $('#pine-list');

    // Detail Modal
    const tradeDetailModal = $('#trade-detail-modal');
    const btnCloseDetailModal = $('#btn-close-detail-modal');
    const btnExportHistory = $('#btn-export-history');

    // ─── State ───
    let rawBaseData = null, csvParsedData = null;
    let currentSide = 'buy', currentSymbol = 'BTCUSDT', activeTab = 'crypto';
    let editingPineId = null; // null = new, string = editing existing
    let statusTimeout = null;

    // ─── Helpers ───
    function showStatus(msg, type, duration) {
        clearTimeout(statusTimeout);
        statusBar.className = type || '';
        statusBar.classList.remove('hidden');
        statusBar.innerHTML = type ? msg : `<span class="spinner"></span> ${msg}`;
        if (duration > 0) statusTimeout = setTimeout(hideStatus, duration);
    }
    function hideStatus() {
        clearTimeout(statusTimeout);
        statusTimeout = null;
        statusBar.classList.add('hidden');
    }
    function setDefaultDates() {
        const saved = localStorage.getItem('lbr_start_date');
        const iso = saved || (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })();
        cryptoDate.value = iso; forexDate.value = iso;
        const ashareDate = document.getElementById('ashare-date');
        if (ashareDate) ashareDate.value = iso;
    }

    // ─── Tabs ───
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.values(tabContents).forEach(tc => tc.classList.remove('active'));
            tabContents[tab.dataset.tab].classList.add('active');
            activeTab = tab.dataset.tab;
            if (MarketController.id === 'ashare') TradingEngine.setAssetType('ashare');
            else TradingEngine.setAssetType(activeTab === 'crypto' ? 'crypto' : 'forex');
            MarketController.applyChrome();
        });
    });

    cryptoSymbol.addEventListener('change', () => {
        if (cryptoSymbol.value === '__custom__') { cryptoCustom.classList.remove('hidden'); cryptoCustom.focus(); }
        else { cryptoCustom.classList.add('hidden'); }
    });

    // ─── Fetch from Binance ───
    btnFetch.addEventListener('click', async () => {
        if (MarketController.id === 'ashare') return;
        const symbol = cryptoSymbol.value === '__custom__' ? cryptoCustom.value.trim().toUpperCase() : cryptoSymbol.value;
        if (!symbol) { alert('Enter a symbol'); return; }
        const startDate = cryptoDate.value;
        if (!startDate) { alert('Select a start date'); return; }
        currentSymbol = symbol;
        btnFetch.disabled = true;
        let earlyStarted = false;
        try {
            showStatus(`Fetching ${symbol} from Binance…`);
            rawBaseData = await fetchAllBinanceData(symbol, startDate, showStatus, (partialData, isFinal) => {
                if (!earlyStarted && !isFinal) {
                    // First chunk — start replay immediately
                    earlyStarted = true;
                    TradingEngine.setAssetType('crypto');
                    TradingEngine.reset();
                    rawBaseData = partialData;
                    startReplay(partialData, parseInt(tfSelect.value), { market: 'crypto', symbol: currentSymbol, interval: '5m', adjust: 'none', baseMinutes: 5, saveCandles: true });
                    showStatus(`Playing with ${partialData.length} bars… still fetching more in background`);
                } else if (isFinal) {
                    // Background fetch finished — silently extend the data
                    rawBaseData = partialData;
                    ReplayEngine.baseData = partialData;
                    showStatus(`✓ ${partialData.length} bars fully loaded.`, 'success');
                    setTimeout(hideStatus, 3000);
                }
            });
            localStorage.setItem('lbr_start_date', startDate);

            if (!earlyStarted) {
                // Short date range — no progressive load happened, start normally
                if (!rawBaseData.length) { showStatus('No data returned.', 'error'); btnFetch.disabled = false; return; }
                showStatus(`✓ ${rawBaseData.length} bars loaded.`, 'success');
                TradingEngine.setAssetType('crypto');
                TradingEngine.reset();
                startReplay(rawBaseData, parseInt(tfSelect.value), { market: 'crypto', symbol: currentSymbol, interval: '5m', adjust: 'none', baseMinutes: 5, saveCandles: true });
                setTimeout(hideStatus, 3000);
            }

            btnDownload.classList.remove('hidden');
            btnDownload.onclick = () => downloadCSV(rawBaseData, `${symbol}_5m.csv`);
        } catch (err) { showStatus('Error: ' + err.message, 'error'); console.error(err); }
        btnFetch.disabled = false;
    });

    tfSelect.addEventListener('change', () => {
        if (rawBaseData && rawBaseData.length) ReplayEngine.switchTimeframe(parseInt(tfSelect.value));
    });

    // ─── Open-Only Toggle ───
    const btnOpenOnly = document.getElementById('btn-open-only');
    btnOpenOnly.addEventListener('click', () => {
        ReplayEngine.openOnly = !ReplayEngine.openOnly;
        btnOpenOnly.classList.toggle('ctrl-active', ReplayEngine.openOnly);
        btnOpenOnly.setAttribute('aria-pressed', String(ReplayEngine.openOnly));
        ReplayEngine._renderFrame(false);
    });

    // ─── Forex MT5 ───
    btnMT5.addEventListener('click', () => {
        currentSymbol = forexSymbol.value;
        showStatus(`Testing MT5 for ${currentSymbol}…`);
        setTimeout(() => {
            showStatus(`MT5 bridge needed. Export from MT5 as CSV and use "Load CSV" tab.`, 'error');
            setTimeout(() => {
                tabs.forEach(t => t.classList.remove('active'));
                $$('#tabs .tab')[2].classList.add('active');
                Object.values(tabContents).forEach(tc => tc.classList.remove('active'));
                tabContents.csv.classList.add('active');
                activeTab = 'csv';
            }, 1500);
        }, 800);
    });

    // ─── CSV ───
    csvFile.addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try { const p = parseCSVText(ev.target.result); showCSVModal(p, autoDetectMapping(p.headers)); }
            catch (err) { showStatus('CSV error: ' + err.message, 'error'); }
        };
        reader.readAsText(file);
    });
    function showCSVModal(parsed, mapping) {
        csvParsedData = parsed;
        csvModal.classList.remove('hidden');
        const fields = ['date', 'open', 'high', 'low', 'close', 'volume'];
        let html = '<table><thead><tr><th>Field</th><th>Column</th>';
        for (let i = 0; i < Math.min(3, parsed.rows.length); i++) html += `<th>Row ${i + 1}</th>`;
        html += '</tr></thead><tbody>';
        for (const f of fields) {
            html += `<tr><td>${f}</td><td><select data-field="${f}"><option value="-1">— skip —</option>`;
            for (let c = 0; c < parsed.headers.length; c++)
                html += `<option value="${c}" ${mapping[f] === c ? 'selected' : ''}>${parsed.headers[c]}</option>`;
            html += '</select></td>';
            for (let r = 0; r < Math.min(3, parsed.rows.length); r++)
                html += `<td>${mapping[f] >= 0 ? parsed.rows[r][mapping[f]] || '' : ''}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';
        csvMappingTable.innerHTML = html;
    }
    csvConfirm.addEventListener('click', () => {
        if (!csvParsedData) return;
        const mapping = {};
        csvMappingTable.querySelectorAll('select').forEach(s => { mapping[s.dataset.field] = parseInt(s.value); });
        try {
            rawBaseData = csvRowsToCandles(csvParsedData.rows, mapping);
            if (!rawBaseData.length) throw new Error('No valid candles');
            csvModal.classList.add('hidden');
            showStatus(`✓ ${rawBaseData.length} candles from CSV.`, 'success');
            TradingEngine.setAssetType(MarketController.id === 'ashare' ? 'ashare' : (activeTab === 'crypto' ? 'crypto' : 'forex'));
            TradingEngine.reset();
            startReplay(rawBaseData, parseInt(tfSelect.value), {
                market: MarketController.id === 'ashare' ? 'ashare' : 'crypto',
                symbol: currentSymbol || 'CSV',
                interval: MarketController.id === 'ashare' ? '1d' : '5m',
                adjust: 'none',
                baseMinutes: MarketController.id === 'ashare' ? 1440 : 5,
                saveCandles: true,
            });
            setTimeout(hideStatus, 3000);
        } catch (err) { showStatus('Error: ' + err.message, 'error'); }
    });
    csvCancel.addEventListener('click', () => { csvModal.classList.add('hidden'); csvParsedData = null; });

    // ─── Indicator Dropdown ───
    btnIndicators.addEventListener('click', (e) => {
        e.stopPropagation();
        indDropdown.classList.toggle('hidden');
        btnIndicators.setAttribute('aria-expanded', String(!indDropdown.classList.contains('hidden')));
        renderPineList();
    });
    document.addEventListener('click', (e) => {
        if (!indDropdown.contains(e.target) && e.target !== btnIndicators) {
            indDropdown.classList.add('hidden');
            btnIndicators.setAttribute('aria-expanded', 'false');
        }
    });

    function readIndicatorState() {
        const state = {};
        indicatorChecks.forEach(c => { state[c.dataset.ind] = c.checked; });
        return state;
    }
    function readIndicatorParams() {
        return {
            sma1: parseInt($('#p-sma1').value) || 20, sma2: parseInt($('#p-sma2').value) || 50,
            sma1On: $('#p-sma1-on').checked, sma2On: $('#p-sma2-on').checked,
            ema1: parseInt($('#p-ema1').value) || 12, ema2: parseInt($('#p-ema2').value) || 26,
            ema1On: $('#p-ema1-on').checked, ema2On: $('#p-ema2-on').checked,
            bbPeriod: parseInt($('#p-bb-period').value) || 20, bbMult: parseFloat($('#p-bb-mult').value) || 2,
            rsiPeriod: parseInt($('#p-rsi').value) || 14,
            macdFast: parseInt($('#p-macd-fast').value) || 12, macdSlow: parseInt($('#p-macd-slow').value) || 26,
            macdSignal: parseInt($('#p-macd-signal').value) || 9,
        };
    }
    function applyIndicators() {
        ChartManager.params = readIndicatorParams();
        ReplayEngine.indicatorState = readIndicatorState();
        localStorage.setItem('lbr_ind_state', JSON.stringify(ReplayEngine.indicatorState));
        localStorage.setItem('lbr_ind_params', JSON.stringify(ChartManager.params));
        ReplayEngine._renderFrame(false);
    }

    indApply.addEventListener('click', () => {
        applyIndicators();
        indDropdown.classList.add('hidden');
        btnIndicators.setAttribute('aria-expanded', 'false');
    });
    indicatorChecks.forEach(cb => { cb.addEventListener('change', applyIndicators); });

    // ─── PineScript Editor ───
    btnPineNew.addEventListener('click', (e) => {
        e.stopPropagation();
        editingPineId = null;
        pineName.value = ''; pineCode.value = '';
        pineModal.classList.remove('hidden');
    });

    pineSave.addEventListener('click', () => {
        const name = pineName.value.trim() || 'Custom Indicator';
        const code = pineCode.value.trim();
        if (!code) { alert('Enter PineScript code'); return; }
        if (editingPineId) {
            const s = PineEngine.scripts.find(s => s.id === editingPineId);
            if (s) { s.name = name; PineEngine.updateScript(editingPineId, code); }
        } else {
            PineEngine.addScript(name, code);
        }
        pineModal.classList.add('hidden');
        renderPineList();
        applyIndicators();
    });
    pineCancel.addEventListener('click', () => pineModal.classList.add('hidden'));

    function renderPineList() {
        if (!pineList) return;
        if (!PineEngine.scripts.length) {
            pineList.innerHTML = '<div style="font-size:10px;color:var(--text-dim);padding:4px 0">No custom indicators yet</div>';
            return;
        }
        pineList.innerHTML = PineEngine.scripts.map(s => `
      <div class="pine-item" data-pine-id="${s.id}">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} class="pine-toggle">
        <span class="pine-name">${s.name}</span>
        <button class="pine-edit" title="Edit">✏️</button>
        <button class="pine-del" title="Delete">🗑️</button>
      </div>
    `).join('');

        pineList.querySelectorAll('.pine-toggle').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.closest('.pine-item').dataset.pineId;
                PineEngine.toggleScript(id);
                applyIndicators();
            });
        });
        pineList.querySelectorAll('.pine-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.closest('.pine-item').dataset.pineId;
                const s = PineEngine.scripts.find(s => s.id === id);
                if (!s) return;
                editingPineId = id;
                pineName.value = s.name;
                pineCode.value = s.code;
                pineModal.classList.remove('hidden');
            });
        });
        pineList.querySelectorAll('.pine-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.closest('.pine-item').dataset.pineId;
                PineEngine.removeScript(id);
                renderPineList();
                applyIndicators();
            });
        });
    }

    // ─── Trading Panel ───
    tradeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tradeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentSide = tab.dataset.side;
            btnPlaceTrade.className = currentSide === 'buy' ? 'btn-trade-buy' : 'btn-trade-buy btn-trade-sell';
            MarketController.applyChrome();
        });
    });

    // ─── Pick-from-chart TP/SL ───
    const btnPickTP = document.getElementById('btn-pick-tp');
    const btnPickSL = document.getElementById('btn-pick-sl');

    btnPickTP.addEventListener('click', () => {
        if (ChartManager._pickMode === 'tp') { ChartManager.exitPickMode(); return; }
        ChartManager.exitPickMode();
        ChartManager.enterPickMode('tp');
    });
    btnPickSL.addEventListener('click', () => {
        if (ChartManager._pickMode === 'sl') { ChartManager.exitPickMode(); return; }
        ChartManager.exitPickMode();
        ChartManager.enterPickMode('sl');
    });
    // ESC cancels pick mode
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && ChartManager._pickMode) ChartManager.exitPickMode();
    });

    // ─── Trade Value Preview ───
    const tradeValuePreview = document.getElementById('trade-value-preview');
    function updateTradeValuePreview() {
        const price = ReplayEngine.getCurrentPrice();
        const lots = parseFloat(tradeLots.value) || 0;
        if (MarketController.id === 'ashare') {
            const hands = Math.round(lots);
            if (!price || hands <= 0) { tradeValuePreview.textContent = ''; return; }
            const amount = hands * AshareRules.lotSize * price;
            const fee = AshareRules.commission(amount);
            tradeValuePreview.textContent = I18n.t('preview.ashare', { hands: hands, shares: hands * AshareRules.lotSize, amount: amount.toLocaleString(undefined, {maximumFractionDigits: 2}), fee: fee.toFixed(2) });
            return;
        }
        const lev = parseInt(tradeLeverage.value) || 10;
        if (!price || lots <= 0) { tradeValuePreview.textContent = ''; return; }
        const notional = lots * price;
        const margin = notional / lev;
        tradeValuePreview.textContent = `≈ $${notional.toLocaleString(undefined, {maximumFractionDigits: 2})} value, $${margin.toLocaleString(undefined, {maximumFractionDigits: 2})} margin`;
    }
    tradeLots.addEventListener('input', updateTradeValuePreview);
    tradeLeverage.addEventListener('change', updateTradeValuePreview);

    tradeUSDT.addEventListener('input', () => {
        const usdt = parseFloat(tradeUSDT.value);
        const price = ReplayEngine.getCurrentPrice();
        if (usdt > 0 && price > 0) tradeLots.value = (usdt / price).toFixed(4);
        updateTradeValuePreview();
    });

    btnPlaceTrade.addEventListener('click', () => {
        const price = ReplayEngine.getCurrentPrice();
        if (!price) { alert('Load data and start replay first'); return; }
        const usdt = parseFloat(tradeUSDT.value);
        let lots = usdt > 0 && price > 0 ? usdt / price : (parseFloat(tradeLots.value) || 0.1);
        let lev = parseInt(tradeLeverage.value) || 10;
        if (MarketController.id === 'ashare') {
            lots = Math.round(parseFloat(tradeLots.value) || 0);
            lev = 1;
            tradeLots.value = String(lots);
        } else if (usdt > 0) {
            tradeLots.value = lots.toFixed(4);
        }
        const tpV = parseFloat(tradeTP.value); const tp = isNaN(tpV) ? null : tpV;
        const slV = parseFloat(tradeSL.value); const sl = isNaN(slV) ? null : slV;
        const opened = TradingEngine.openPosition(currentSide, lots, lev, price, tp, sl, currentSymbol);
        if (!opened && TradingEngine.lastReject) showStatus(TradingEngine.lastReject, 'error');
        tradeTP.value = ''; tradeSL.value = ''; tradeUSDT.value = '';
        // Instant fill: force render so position lines appear even when paused
        ReplayEngine._renderFrame(false);
    });

    btnCloseAll.addEventListener('click', () => {
        const price = ReplayEngine.getCurrentPrice();
        if (price) TradingEngine.closeAll(price);
        // Update chart immediately
        ReplayEngine._renderFrame(false);
    });

    document.getElementById('open-positions').addEventListener('click', (e) => {
        const btn = e.target.closest('.pos-close');
        if (!btn) return;
        TradingEngine.closePosition(parseInt(btn.dataset.closeId), ReplayEngine.getCurrentPrice());
        ReplayEngine._renderFrame(false);
    });

    // ─── Per-trade context detail modal ───
    // Close modal
    btnCloseDetailModal.addEventListener('click', () => tradeDetailModal.classList.add('hidden'));
    tradeDetailModal.addEventListener('click', (e) => { if (e.target === tradeDetailModal) tradeDetailModal.classList.add('hidden'); });

    // Click on a "Details ▸" button in the history list
    document.getElementById('trade-history').addEventListener('click', (e) => {
        const btn = e.target.closest('.hist-detail-btn');
        if (!btn) return;
        const idx = parseInt(btn.dataset.histIdx);
        if (!isNaN(idx)) TradingEngine.renderDetailModal(idx);
    });

    // ─── Export all trades as JSON ───
    btnExportHistory.addEventListener('click', () => TradingEngine.downloadHistoryJSON());

    // ─── Start Replay ───
    function startReplay(data, tf, meta) {
        const baseMinutes = meta && meta.baseMinutes ? meta.baseMinutes : 5;
        ReplayEngine.loadData(data, tf, baseMinutes);
        if (meta && typeof Companion !== 'undefined' && Companion.online) {
            Companion.startSession({
                market: meta.market,
                symbol: meta.symbol,
                adjust: meta.adjust || '',
                initialCapital: TradingEngine.startingBalance,
            });
            if (meta.saveCandles) {
                Companion.saveCandles({
                    market: meta.market,
                    symbol: meta.symbol,
                    interval: meta.interval,
                    adjust: meta.adjust || 'none',
                    candles: data,
                });
            }
        }
        setTimeout(() => ReplayEngine.play(), 300);
    }

    // ─── Restore saved indicator preferences ───
    function restoreIndicatorPrefs() {
        try {
            const savedState = JSON.parse(localStorage.getItem('lbr_ind_state'));
            const savedParams = JSON.parse(localStorage.getItem('lbr_ind_params'));
            if (savedState) {
                indicatorChecks.forEach(c => { if (savedState[c.dataset.ind] !== undefined) c.checked = savedState[c.dataset.ind]; });
            }
            if (savedParams) {
                if ($('#p-sma1')) $('#p-sma1').value = savedParams.sma1 || 20;
                if ($('#p-sma2')) $('#p-sma2').value = savedParams.sma2 || 50;
                if ($('#p-sma1-on')) $('#p-sma1-on').checked = savedParams.sma1On !== false;
                if ($('#p-sma2-on')) $('#p-sma2-on').checked = savedParams.sma2On !== false;
                if ($('#p-ema1')) $('#p-ema1').value = savedParams.ema1 || 12;
                if ($('#p-ema2')) $('#p-ema2').value = savedParams.ema2 || 26;
                if ($('#p-ema1-on')) $('#p-ema1-on').checked = savedParams.ema1On !== false;
                if ($('#p-ema2-on')) $('#p-ema2-on').checked = savedParams.ema2On !== false;
                if ($('#p-bb-period')) $('#p-bb-period').value = savedParams.bbPeriod || 20;
                if ($('#p-bb-mult')) $('#p-bb-mult').value = savedParams.bbMult || 2;
                if ($('#p-rsi')) $('#p-rsi').value = savedParams.rsiPeriod || 14;
                if ($('#p-macd-fast')) $('#p-macd-fast').value = savedParams.macdFast || 12;
                if ($('#p-macd-slow')) $('#p-macd-slow').value = savedParams.macdSlow || 26;
                if ($('#p-macd-signal')) $('#p-macd-signal').value = savedParams.macdSignal || 9;
            }
        } catch (e) { }
    }

    // ─── Addon selector ───
    const _loadedAddonScripts = {}; // path → <script> element

    function initAddons() {
        const saved = JSON.parse(localStorage.getItem('lbr_addons') || '{}');
        document.querySelectorAll('#addon-list input[data-addon]').forEach(cb => {
            const path = cb.dataset.addon;
            if (saved[path]) { cb.checked = true; _loadAddon(path); }
            cb.addEventListener('change', () => {
                if (cb.checked) _loadAddon(path);
                else _unloadAddon(path);
                const s = JSON.parse(localStorage.getItem('lbr_addons') || '{}');
                s[path] = cb.checked;
                localStorage.setItem('lbr_addons', JSON.stringify(s));
            });
        });
    }

    function _loadAddon(path) {
        if (_loadedAddonScripts[path]) return; // already loaded
        const script = document.createElement('script');
        script.src = path + '?v=' + Date.now(); // bust cache
        script.dataset.addonPath = path;
        document.body.appendChild(script);
        _loadedAddonScripts[path] = script;
    }

    function _unloadAddon(path) {
        const script = _loadedAddonScripts[path];
        if (script) { script.remove(); delete _loadedAddonScripts[path]; }
        // Unregister from manager (fires onDeactivate hooks)
        if (typeof TradeAddonManager !== 'undefined') {
            const filename = path.split('/').pop();
            TradeAddonManager.unregister(a => a._sourcePath && String(a._sourcePath).includes(filename));
        }
    }

    let recordMarket = 'all';

    function renderRecords(sessions, trades) {
        const summary = document.getElementById('record-summary');
        const list = document.getElementById('record-sessions');
        if (!summary || !list) return;
        const match = (row) => recordMarket === 'all' || row.market === recordMarket;
        const shownSessions = (sessions || []).filter(match);
        const shownTrades = (trades || []).filter(match);
        const returns = shownSessions.map(s => Number(s.total_return)).filter(n => Number.isFinite(n));
        const wins = shownTrades.filter(tr => Number(tr.pnl) > 0).length;
        const avg = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null;
        const best = returns.length ? Math.max(...returns) : null;
        const worst = returns.length ? Math.min(...returns) : null;
        const pct = (n) => n === null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
        const winRate = shownTrades.length ? Math.round(wins / shownTrades.length * 100) + '%' : '—';
        summary.textContent = I18n.t('rec.line', {
            n: shownSessions.length, avg: pct(avg), best: pct(best), worst: pct(worst), win: winRate,
        });
        if (!shownSessions.length) {
            list.innerHTML = '<div class="empty-state">' + I18n.t('rec.empty') + '</div>';
            return;
        }
        list.innerHTML = shownSessions.slice(0, 12).map(s => {
            const ret = Number(s.total_return);
            const label = Number.isFinite(ret) ? ((ret >= 0 ? '+' : '') + ret.toFixed(2) + '%') : '—';
            return '<div class="record-row">' + I18n.t(s.market === 'ashare' ? 'rec.ashare' : 'rec.crypto')
                + ' ' + (s.symbol || '—') + ' ' + label
                + ', ' + (s.trade_count || 0) + '笔</div>';
        }).join('');
    }

    async function refreshRecords() {
        const summary = document.getElementById('record-summary');
        if (!Companion.online) {
            if (summary) summary.textContent = I18n.t('rec.offline');
            return;
        }
        try {
            const [sessions, trades] = await Promise.all([Companion.listSessions(), Companion.listTrades()]);
            renderRecords(sessions, trades);
        } catch (err) {
            if (summary) summary.textContent = I18n.t('rec.fail');
        }
    }

    // ─── Workspace panel ───
    function initWorkspacePanel() {
        const panel = document.getElementById('trading-panel');
        if (!panel) return;

        const tabs = [...panel.querySelectorAll('.panel-tab')];
        const pages = [...panel.querySelectorAll('.panel-page')];
        const toggle = document.getElementById('btn-panel-toggle');
        const mobileQuery = window.matchMedia('(max-width: 40rem)');

        function selectPanelPage(name, focus) {
            const active = tabs.find(tab => tab.dataset.panelName === name) ? name : 'trade';
            tabs.forEach((tab) => {
                const selected = tab.dataset.panelName === active;
                tab.classList.toggle('active', selected);
                tab.setAttribute('aria-selected', String(selected));
                tab.tabIndex = selected ? 0 : -1;
                if (selected && focus) tab.focus();
            });
            pages.forEach((page) => {
                const selected = page.dataset.panelPage === active;
                page.classList.toggle('active', selected);
                page.hidden = !selected;
            });
            localStorage.setItem('lbr_panel_tab', active);
        }

        function setPanelCollapsed(collapsed, persist) {
            panel.classList.toggle('is-collapsed', collapsed);
            toggle.setAttribute('aria-expanded', String(!collapsed));
            const key = collapsed ? 'panel.expand' : 'panel.collapse';
            toggle.dataset.i18nAriaLabel = key;
            toggle.dataset.i18nTitle = key;
            toggle.setAttribute('aria-label', I18n.t(key));
            toggle.title = I18n.t(key);
            if (persist) localStorage.setItem('lbr_panel_collapsed', collapsed ? '1' : '0');
            if (ChartManager._scheduleResize) ChartManager._scheduleResize();
        }

        panel.classList.add('panel-enhanced');
        const savedCollapsed = localStorage.getItem('lbr_panel_collapsed');
        setPanelCollapsed(savedCollapsed === null ? mobileQuery.matches : savedCollapsed === '1', false);
        selectPanelPage(localStorage.getItem('lbr_panel_tab') || 'trade', false);

        tabs.forEach((tab) => {
            tab.addEventListener('click', () => selectPanelPage(tab.dataset.panelName, false));
            tab.addEventListener('keydown', (e) => {
                const index = tabs.indexOf(tab);
                let next = null;
                if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
                if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
                if (e.key === 'Home') next = 0;
                if (e.key === 'End') next = tabs.length - 1;
                if (next === null) return;
                e.preventDefault();
                selectPanelPage(tabs[next].dataset.panelName, true);
            });
        });

        toggle.addEventListener('click', () => {
            setPanelCollapsed(!panel.classList.contains('is-collapsed'), true);
        });
    }

    function initInfoTips() {
        const tips = [...document.querySelectorAll('.info-tip')];
        const closeTips = (except) => tips.forEach((tip) => {
            if (tip !== except) tip.setAttribute('aria-expanded', 'false');
        });

        tips.forEach((tip) => {
            tip.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = tip.getAttribute('aria-expanded') !== 'true';
                closeTips(tip);
                tip.setAttribute('aria-expanded', String(open));
            });
            tip.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                tip.setAttribute('aria-expanded', 'false');
                tip.blur();
            });
        });
        document.addEventListener('click', () => closeTips());
    }

    // ─── Boot ───
    function boot() {
        setDefaultDates();
        restoreIndicatorPrefs();
        PineEngine.init();
        initWorkspacePanel();
        initInfoTips();
        ChartManager.init();
        ReplayEngine.init();
        BridgeClient.init();
        ReplayEngine.indicatorState = readIndicatorState();
        ChartManager.params = readIndicatorParams();
        TradingEngine.updateUI();
        initAddons();
        window.__lbrShowDataTab = (name) => {
            if (!tabContents[name]) return;
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
            Object.entries(tabContents).forEach(([key, el]) => el.classList.toggle('active', key === name));
            activeTab = name;
            if (MarketController.id === 'ashare') TradingEngine.setAssetType('ashare');
            else TradingEngine.setAssetType(name === 'crypto' ? 'crypto' : name === 'forex' ? 'forex' : TradingEngine.assetType);
        };
        MarketController.notifier = showStatus;
        MarketController.onAfterSwitch = () => {
            if (typeof Companion !== 'undefined') Companion.completeSession().then(refreshRecords);
            rawBaseData = [];
            ReplayEngine.pause();
            ReplayEngine.baseData = [];
            ReplayEngine.replayIndex = 0;
            if (ChartManager.clearAll) ChartManager.clearAll();
            btnDownload.classList.add('hidden');
        };
        I18n.init();
        I18n.onChange = () => {
            MarketController.applyChrome();
            TradingEngine.updateUI();
            ReplayEngine._updateSpeedLabel();
            refreshRecords();
        };
        MarketController.init();
        if (typeof Companion !== 'undefined') {
            Companion.init().then(refreshRecords);
        }
        document.querySelectorAll('.record-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.record-filter').forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                recordMarket = btn.dataset.market;
                refreshRecords();
            });
        });
        const btnRecords = document.getElementById('btn-refresh-records');
        if (btnRecords) btnRecords.addEventListener('click', refreshRecords);
        document.addEventListener('lbr-trade-saved', () => setTimeout(refreshRecords, 400));
        document.addEventListener('lbr-session-ended', () => setTimeout(refreshRecords, 200));
        const btnFetchAshare = document.getElementById('btn-fetch-ashare');
        if (btnFetchAshare) {
            btnFetchAshare.addEventListener('click', async () => {
                if (!Companion.online) await Companion.init();
                if (!Companion.online) {
                    showStatus(I18n.t('fetch.needServer'), 'error');
                    return;
                }
                const code = (document.getElementById('ashare-code').value || '').trim();
                const start = document.getElementById('ashare-date').value;
                const adjust = document.getElementById('ashare-adjust').value || 'qfq';
                const refresh = document.getElementById('ashare-refresh').checked;
                if (!/^\d{6}$/.test(code)) { showStatus(I18n.t('fetch.badCode'), 'error'); return; }
                btnFetchAshare.disabled = true;
                try {
                    showStatus(I18n.t('fetch.loading', { code: code }));
                    const data = await Companion.fetchAshare(code, start, adjust, refresh);
                    if (!data.candles || !data.candles.length) throw new Error(I18n.t('fetch.empty'));
                    currentSymbol = code;
                    TradingEngine.setAssetType('ashare');
                    TradingEngine.reset();
                    const tf = document.getElementById('timeframe');
                    if (tf) tf.value = '1440';
                    startReplay(data.candles, 1440, {
                        market: 'ashare', symbol: code, interval: '1d', adjust: adjust,
                        baseMinutes: 1440, saveCandles: false,
                    });
                    const where = data.from_cache ? I18n.t('fetch.db') : (data.source || I18n.t('fetch.source'));
                    showStatus(I18n.t('fetch.loaded', { count: data.candles.length, where: where }), 'success');
                } catch (err) {
                    showStatus(err.message || String(err), 'error');
                }
                btnFetchAshare.disabled = false;
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
