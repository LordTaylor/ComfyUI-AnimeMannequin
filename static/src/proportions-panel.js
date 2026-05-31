import { defaultProportions } from './mannequin-model.js';

const SLIDERS = [
    { key: 'head',  label: 'Head',  min: 0.5,  max: 1.5,  step: 0.01 },
    { key: 'bust',  label: 'Bust',  min: 0.3,  max: 2.0,  step: 0.01, femaleOnly: true },
    { key: 'hips',  label: 'Hips',  min: 0.6,  max: 1.6,  step: 0.01 },
    { key: 'waist', label: 'Waist', min: 0.5,  max: 1.5,  step: 0.01 },
    { key: 'legs',  label: 'Legs',  min: 0.6,  max: 1.4,  step: 0.01 },
    { key: 'arms',  label: 'Arms',  min: 0.6,  max: 1.4,  step: 0.01 },
];

export class ProportionsPanel {
    constructor(renderer) {
        this._renderer  = renderer;
        this._panel     = null;
        this._visible   = false;
        this._props     = defaultProportions();
        this._sliderEls = {};
        this._gender    = 'F';
    }

    setGender(gender) {
        this._gender = gender;
        this._updateBustVisibility();
    }

    toggle() {
        this._visible = !this._visible;
        if (this._panel) this._panel.style.display = this._visible ? 'flex' : 'none';
    }

    isVisible() { return this._visible; }

    getProportions() { return { ...this._props }; }

    setProportions(props) {
        this._props = { ...this._props, ...props };
        for (const [k, v] of Object.entries(this._props)) {
            const el = this._sliderEls[k];
            if (el) { el.slider.value = v; el.valueEl.textContent = Math.round(v * 100) + '%'; }
        }
        this._renderer.applyProportions(this._props);
    }

    mount(container) {
        this._panel = document.createElement('div');
        this._panel.style.cssText = [
            'position:fixed', 'right:0', 'top:0', 'bottom:0', 'width:200px',
            'background:#222', 'border-left:1px solid #444', 'z-index:101',
            'display:none', 'flex-direction:column', 'overflow:hidden',
        ].join(';');

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'padding:8px;border-bottom:1px solid #444;flex-shrink:0;display:flex;align-items:center;';
        const title = document.createElement('span');
        title.textContent = 'Proportions';
        title.style.cssText = 'color:#fff;font-size:12px;font-weight:bold;flex:1;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;padding:0 2px;';
        closeBtn.onclick = () => this.toggle();
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.style.cssText = 'background:#333;color:#aaa;border:none;border-radius:3px;cursor:pointer;font-size:10px;padding:3px 6px;margin-right:6px;';
        resetBtn.onclick = () => this.setProportions(defaultProportions());
        header.appendChild(title);
        header.appendChild(resetBtn);
        header.appendChild(closeBtn);
        this._panel.appendChild(header);

        // Sliders
        const body = document.createElement('div');
        body.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';

        for (const { key, label, min, max, step, femaleOnly } of SLIDERS) {
            const row = document.createElement('div');
            row.style.cssText = 'margin-bottom:10px;';
            if (femaleOnly) row.dataset.femaleOnly = '1';

            const labelRow = document.createElement('div');
            labelRow.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:3px;';
            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            labelEl.style.cssText = 'color:#ccc;font-size:11px;';
            const valueEl = document.createElement('span');
            valueEl.textContent = '100%';
            valueEl.style.cssText = 'color:#888;font-size:11px;';
            labelRow.appendChild(labelEl);
            labelRow.appendChild(valueEl);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min  = min;
            slider.max  = max;
            slider.step = step;
            slider.value = 1.0;
            slider.style.cssText = 'width:100%;accent-color:#4fc3f7;';
            slider.addEventListener('input', () => {
                const v = parseFloat(slider.value);
                valueEl.textContent = Math.round(v * 100) + '%';
                this._props[key] = v;
                this._renderer.applyProportions(this._props);
            });

            row.appendChild(labelRow);
            row.appendChild(slider);
            body.appendChild(row);
            this._sliderEls[key] = { slider, valueEl, row };
        }

        this._panel.appendChild(body);
        container.appendChild(this._panel);
        this._updateBustVisibility();
    }

    _updateBustVisibility() {
        const bustEl = this._sliderEls['bust'];
        if (bustEl) {
            bustEl.row.style.display = this._gender === 'F' ? '' : 'none';
        }
    }
}
