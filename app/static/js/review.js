/* End the current session, then ask the server for a review. The key never enters the browser. */

const SessionReview = {
    report: null,

    init() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        bind('btn-ai-config', () => this.openConfig());
        bind('btn-end-session', () => this.endSession());
        bind('btn-open-review', () => this.reopen());
        bind('btn-ai-save', () => this.saveConfig(false));
        bind('btn-ai-clear', () => this.saveConfig(true));
        bind('btn-ai-review', () => this.requestReview());
        bind('btn-close-ai-config', () => this.hide('ai-config-modal'));
        bind('btn-close-ai-review', () => this.hide('ai-review-modal'));
        ['ai-config-modal', 'ai-review-modal'].forEach((id) => {
            const modal = document.getElementById(id);
            if (!modal) return;
            modal.addEventListener('click', (event) => {
                if (event.target === modal) this.hide(id);
            });
        });
    },

    hide(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('hidden');
    },

    show(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('hidden');
    },

    notify(message, type) {
        const bar = document.getElementById('status-bar');
        if (!bar) return;
        bar.className = type || '';
        bar.classList.remove('hidden');
        bar.textContent = message;
    },

    async openConfig() {
        this.show('ai-config-modal');
        const status = document.getElementById('ai-config-status');
        const keyInput = document.getElementById('ai-key');
        if (keyInput) keyInput.value = '';
        try {
            const response = await fetch('/api/ai/config');
            const data = await response.json();
            const base = document.getElementById('ai-base-url');
            const model = document.getElementById('ai-model');
            if (base && data.base_url) base.value = data.base_url;
            if (model && data.model) model.value = data.model;
            if (status) {
                status.textContent = data.configured
                    ? I18n.t('ai.configured', { mask: data.key_mask || '' })
                    : I18n.t('ai.notConfigured');
            }
        } catch (err) {
            if (status) status.textContent = I18n.t('ai.offline');
        }
    },

    async saveConfig(clear) {
        const status = document.getElementById('ai-config-status');
        const payload = {
            base_url: document.getElementById('ai-base-url').value,
            model: document.getElementById('ai-model').value,
        };
        if (clear) payload.clear_key = true;
        else payload.api_key = document.getElementById('ai-key').value;
        try {
            const response = await fetch('/api/ai/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok) {
                if (status) status.textContent = data.error || I18n.t('ai.saveFail');
                return;
            }
            document.getElementById('ai-key').value = '';
            if (status) {
                status.textContent = data.configured
                    ? I18n.t('ai.saved', { mask: data.key_mask || '' })
                    : I18n.t('ai.cleared');
            }
        } catch (err) {
            if (status) status.textContent = I18n.t('ai.offline');
        }
    },

    async endSession() {
        if (typeof Companion === 'undefined' || !Companion.online) {
            this.notify(I18n.t('ai.offline'), 'error');
            return;
        }
        let result;
        try {
            result = await Companion.endSession();
        } catch (err) {
            this.notify(I18n.t('ai.endFail'), 'error');
            return;
        }
        if (!result || result.error) {
            const code = result && result.error;
            const key = code === 'open' ? 'ai.openPositions'
                : code === 'no-session' ? 'ai.noSession'
                : code === 'offline' ? 'ai.offline'
                : 'ai.endFail';
            this.notify(I18n.t(key), 'error');
            return;
        }
        this.report = result.report;
        this.renderFacts(result.report);
        const body = document.getElementById('ai-review-body');
        if (body) body.textContent = '';
        this.show('ai-review-modal');
        const reopen = document.getElementById('btn-open-review');
        if (reopen) reopen.classList.remove('hidden');
        document.dispatchEvent(new CustomEvent('lbr-session-ended'));
    },

    reopen() {
        if (!this.report) return;
        this.renderFacts(this.report);
        this.show('ai-review-modal');
    },

    renderFacts(report) {
        const box = document.getElementById('ai-review-facts');
        if (!box || !report) return;
        box.textContent = '';
        const title = document.createElement('div');
        title.className = 'ai-facts-title';
        title.textContent = I18n.t('ai.facts');
        const line = document.createElement('div');
        const ret = Number(report.total_return);
        const retText = Number.isFinite(ret) ? ((ret >= 0 ? '+' : '') + ret.toFixed(2) + '%') : '-';
        line.textContent = (report.symbol || '-') + ' · ' + I18n.t('ai.return') + ' ' + retText;
        const tradeLine = document.createElement('div');
        const trade = (report.trades || [])[0];
        tradeLine.textContent = trade
            ? I18n.t('ai.oneTrade', {
                side: trade.side || '-',
                entry: trade.entry_price,
                exit: trade.exit_price,
            })
            : I18n.t('ai.noTrades');
        box.appendChild(title);
        box.appendChild(line);
        box.appendChild(tradeLine);
    },

    async requestReview() {
        const body = document.getElementById('ai-review-body');
        const button = document.getElementById('btn-ai-review');
        if (!this.report) return;
        if (body) body.textContent = I18n.t('ai.waiting');
        if (button) button.disabled = true;
        try {
            const response = await fetch('/api/ai/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.report),
            });
            const data = await response.json();
            if (!response.ok) {
                this.showError(data);
                return;
            }
            this.showCommentary(data);
        } catch (err) {
            if (body) body.textContent = I18n.t('ai.offline');
        } finally {
            if (button) button.disabled = false;
        }
    },

    showError(data) {
        const body = document.getElementById('ai-review-body');
        if (!body) return;
        body.textContent = '';
        const message = (data && data.code === 'missing_key')
            ? I18n.t('ai.missing')
            : ((data && data.error) || I18n.t('ai.reviewFail'));
        const el = document.createElement('p');
        el.className = 'ai-error';
        el.textContent = message;
        body.appendChild(el);
    },

    showCommentary(data) {
        const body = document.getElementById('ai-review-body');
        if (!body) return;
        body.textContent = '';
        const score = data ? data.score : null;
        const parsed = !!(data && data.parsed === true && data.sections
            && Number.isInteger(score) && score >= 0 && score <= 100);
        if (!parsed) {
            const note = document.createElement('p');
            note.className = 'ai-raw-note';
            note.textContent = I18n.t('ai.raw');
            const raw = document.createElement('pre');
            raw.className = 'ai-raw';
            raw.textContent = (data && data.raw) || '';
            body.appendChild(note);
            body.appendChild(raw);
            return;
        }
        const scoreEl = document.createElement('div');
        scoreEl.className = 'ai-score';
        scoreEl.textContent = I18n.t('ai.score') + ' ' + score;
        body.appendChild(scoreEl);
        [
            ['ai.strengths', data.sections.strengths],
            ['ai.risks', data.sections.risks],
            ['ai.improvements', data.sections.improvements],
        ].forEach((item) => {
            const heading = document.createElement('h4');
            heading.textContent = I18n.t(item[0]);
            const text = document.createElement('p');
            text.textContent = item[1] || '';
            body.appendChild(heading);
            body.appendChild(text);
        });
    },
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SessionReview.init());
} else {
    SessionReview.init();
}
