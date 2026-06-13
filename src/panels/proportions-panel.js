import { defaultProportions } from '../mannequin-model.js';
import { SetProportionsCommand } from '../commands.js';

const SLIDERS = [
    { key: 'head',  label: 'Head',  min: 0.5,  max: 1.5,  step: 0.01 },
    { key: 'bust',  label: 'Bust',  min: 0.3,  max: 2.0,  step: 0.01, femaleOnly: true },
    { key: 'hips',  label: 'Hips',  min: 0.6,  max: 1.6,  step: 0.01 },
    { key: 'waist', label: 'Waist', min: 0.5,  max: 1.5,  step: 0.01 },
    { key: 'legs',  label: 'Legs',  min: 0.6,  max: 1.4,  step: 0.01 },
    { key: 'arms',  label: 'Arms',  min: 0.6,  max: 1.4,  step: 0.01 },
];

export class ProportionsPanel {
    /**
     * @param {import('./app-store.js').AppStore} store
     * @param {import('./commands.js').CommandHistory} history
     */
    constructor(store, history) {
        this._store    = store;
        this._history  = history;
        this._panel    = null;
        this._visible  = false;
        this._sliderEls = {};
        this._storeUnsub = null;
    }

    toggle() {
        this._visible = !this._visible;
        if (this._panel) this._panel.style.display = this._visible ? 'flex' : 'none';
    }

    show() { this._visible = true;  if (this._panel) this._panel.style.display = 'flex'; }
    hide() { this._visible = false; if (this._panel) this._panel.style.display = 'none'; }
    isVisible() { return this._visible; }

    mount(container) {
        this._panel = document.createElement('div');
        this._panel.style.cssText = [
            'position:fixed', 'right:0', 'top:40px', 'bottom:0', 'width:210px',
            'background:#222', 'border-left:1px solid #444', 'z-index:101',
            'display:none', 'flex-direction:column', 'overflow:hidden',
        ].join(';');

        // ── Header ─────────────────────────────────────────────────────────────
        const header = document.createElement('div');
        header.style.cssText = 'padding:8px 10px;border-bottom:1px solid #444;flex-shrink:0;display:flex;align-items:center;gap:6px;';
        const title = document.createElement('span');
        title.textContent = 'Model Control';
        title.style.cssText = 'color:#fff;font-size:12px;font-weight:bold;flex:1;';
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.title = 'Reset all proportions to default';
        resetBtn.style.cssText = 'background:#333;color:#aaa;border:none;border-radius:3px;cursor:pointer;font-size:10px;padding:3px 7px;';
        resetBtn.onclick = () => this._commitProportions(defaultProportions());
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0 2px;line-height:1;';
        closeBtn.onclick = () => this.toggle();
        header.appendChild(title); header.appendChild(resetBtn); header.appendChild(closeBtn);
        this._panel.appendChild(header);

        // ── Sliders ────────────────────────────────────────────────────────────
        const body = document.createElement('div');
        body.style.cssText = 'flex:1;overflow-y:auto;padding:10px;';

        const initProps = this._store?.getState().proportions ?? defaultProportions();

        for (const { key, label, min, max, step, femaleOnly } of SLIDERS) {
            const row = document.createElement('div');
            row.style.cssText = 'margin-bottom:12px;';
            if (femaleOnly) row.dataset.femaleOnly = '1';

            const labelRow = document.createElement('div');
            labelRow.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';
            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            labelEl.style.cssText = 'color:#ccc;font-size:11px;';
            const valueEl = document.createElement('span');
            valueEl.style.cssText = 'color:#888;font-size:11px;';
            valueEl.textContent   = Math.round((initProps[key] ?? 1) * 100) + '%';
            labelRow.appendChild(labelEl); labelRow.appendChild(valueEl);

            const slider = document.createElement('input');
            slider.type  = 'range';
            slider.min   = min; slider.max = max; slider.step = step;
            slider.value = initProps[key] ?? 1;
            slider.style.cssText = 'width:100%;accent-color:#4fc3f7;';

            // Live update while dragging (no history — too noisy)
            slider.addEventListener('input', () => {
                const v = parseFloat(slider.value);
                valueEl.textContent = Math.round(v * 100) + '%';
                this._store?.setProportions({ [key]: v });
            });

            // Commit to history on release
            slider.addEventListener('change', () => {
                this._commitProportions({ [key]: parseFloat(slider.value) });
            });

            row.appendChild(labelRow); row.appendChild(slider);
            body.appendChild(row);
            this._sliderEls[key] = { slider, valueEl, row };
        }

        // ── Ground plane toggle ────────────────────────────────────────────────
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px solid #444;margin:8px 0;';
        body.appendChild(sep);

        const groundRow = document.createElement('div');
        groundRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
        const groundLabel = document.createElement('span');
        groundLabel.textContent = 'Ground plane';
        groundLabel.title = 'Show solid ground in exported images';
        groundLabel.style.cssText = 'color:#ccc;font-size:11px;';
        const groundBtn = document.createElement('button');
        const initGround = this._store?.getState().groundEnabled ?? false;
        groundBtn.textContent    = initGround ? 'ON' : 'OFF';
        groundBtn.style.cssText  = `background:${initGround ? '#1b5e20' : '#333'};color:${initGround ? '#8f8' : '#888'};border:none;border-radius:3px;cursor:pointer;font-size:10px;padding:3px 8px;`;
        groundBtn.addEventListener('click', () => {
            const next = !this._store.getState().groundEnabled;
            this._store?.setState({ groundEnabled: next });
            groundBtn.textContent   = next ? 'ON' : 'OFF';
            groundBtn.style.background = next ? '#1b5e20' : '#333';
            groundBtn.style.color      = next ? '#8f8'   : '#888';
        });
        groundRow.appendChild(groundLabel); groundRow.appendChild(groundBtn);
        body.appendChild(groundRow);

        this._panel.appendChild(body);
        container.appendChild(this._panel);

        // ── Subscribe to store — sync sliders on external change (undo/redo) ──
        this._storeUnsub = this._store?.subscribe(state => this._syncFromStore(state));
        this._syncBustVisibility(this._store?.getState().gender ?? 'F');
    }

    /** Commit proportions change to CommandHistory (creates undo-able entry). */
    _commitProportions(partial) {
        if (!this._store) return;
        const prev = this._store.getState().proportions;
        const next = { ...prev, ...partial };
        this._history.execute(new SetProportionsCommand(prev, next), this._store);
        this._syncInputs(next);
    }

    /** Sync slider UI from store state (after undo/redo or external change). */
    _syncFromStore(state) {
        this._syncInputs(state.proportions);
        this._syncBustVisibility(state.gender);
    }

    _syncInputs(props) {
        for (const [key, { slider, valueEl }] of Object.entries(this._sliderEls)) {
            if (props[key] !== undefined) {
                slider.value        = props[key];
                valueEl.textContent = Math.round(props[key] * 100) + '%';
            }
        }
    }

    _syncBustVisibility(gender) {
        const bustEl = this._sliderEls['bust'];
        if (bustEl) bustEl.row.style.display = gender === 'F' ? '' : 'none';
    }

    dispose() {
        if (this._storeUnsub) this._storeUnsub();
        this._panel?.remove();
        this._panel = null;
    }
}
