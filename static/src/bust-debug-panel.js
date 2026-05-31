import { BUST_DEFAULTS } from './mannequin-renderer.js';

/**
 * Floating debug panel for live-tweaking bust config parameters.
 * Usage:
 *   const dbg = new BustDebugPanel(renderer);
 *   dbg.mount(document.body);
 */
export class BustDebugPanel {
    constructor(renderer) {
        this._renderer = renderer;
        this._el = null;
    }

    mount(parent) {
        if (this._el) return;

        const panel = document.createElement('div');
        panel.id = 'bust-debug';
        panel.style.cssText = [
            'position:fixed', 'top:48px', 'right:8px',
            'background:rgba(20,20,20,0.92)', 'color:#eee',
            'font-size:11px', 'font-family:monospace',
            'padding:8px 10px', 'border-radius:6px',
            'z-index:9999', 'min-width:220px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
            'user-select:none',
        ].join(';');

        const title = document.createElement('div');
        title.textContent = '⚙ Bust Config';
        title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#7cf;cursor:move;';
        panel.appendChild(title);

        // Drag to move
        let ox = 0, oy = 0, dragging = false;
        title.addEventListener('mousedown', e => {
            dragging = true;
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = (e.clientX - ox) + 'px';
            panel.style.top  = (e.clientY - oy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset defaults';
        resetBtn.style.cssText = 'margin-bottom:8px;padding:2px 8px;font-size:10px;cursor:pointer;width:100%;';
        resetBtn.addEventListener('click', () => {
            this._renderer.setBustCfg({ ...BUST_DEFAULTS });
            this._syncInputs();
        });
        panel.appendChild(resetBtn);

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy as JS';
        copyBtn.style.cssText = 'margin-bottom:8px;padding:2px 8px;font-size:10px;cursor:pointer;width:100%;';
        copyBtn.addEventListener('click', () => {
            const cfg = this._renderer.bustCfg;
            const lines = Object.entries(cfg).map(([k, v]) => `    ${k.padEnd(9)}: ${v},`).join('\n');
            navigator.clipboard.writeText(`{\n${lines}\n}`);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy as JS'; }, 1200);
        });
        panel.appendChild(copyBtn);

        // Sliders
        const FIELDS = [
            { key: 'baseFwd',  label: 'baseFwd',  min: -0.2, max:  0.2,  step: 0.01 },
            { key: 'fwdPush',  label: 'fwdPush',  min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'droop',    label: 'droop',    min: -1.0, max:  1.0,  step: 0.05 },
            { key: 'latX',     label: 'latX',     min: -1.0, max:  1.0,  step: 0.05 },
            { key: 'latY',     label: 'latY',     min: -1.0, max:  1.0,  step: 0.05 },
            { key: 'rotFwd',   label: 'rotFwd',   min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'rotLat',   label: 'rotLat',   min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'rotY',     label: 'rotY',     min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'xSqueeze', label: 'xSqueeze', min:  0.1, max:  2.0,  step: 0.05 },
        ];

        this._inputs = {};

        for (const { key, label, min, max, step } of FIELDS) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0;';

            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'width:64px;flex-shrink:0;color:#aaa;';
            row.appendChild(lbl);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = min; slider.max = max; slider.step = step;
            slider.value = this._renderer.bustCfg[key] ?? BUST_DEFAULTS[key];
            slider.style.cssText = 'flex:1;cursor:pointer;';

            const num = document.createElement('input');
            num.type = 'number';
            num.min = min; num.max = max; num.step = step;
            num.value = slider.value;
            num.style.cssText = 'width:52px;background:#333;color:#eee;border:1px solid #555;border-radius:3px;padding:1px 3px;font-size:10px;';

            const sync = (val) => {
                const v = parseFloat(val);
                if (isNaN(v)) return;
                slider.value = v;
                num.value = v;
                this._renderer.setBustCfg({ [key]: v });
            };

            slider.addEventListener('input',  () => sync(slider.value));
            num.addEventListener('change',    () => sync(num.value));

            row.appendChild(slider);
            row.appendChild(num);
            panel.appendChild(row);

            this._inputs[key] = { slider, num };
        }

        this._el = panel;
        parent.appendChild(panel);
    }

    _syncInputs() {
        const cfg = this._renderer.bustCfg;
        for (const [key, { slider, num }] of Object.entries(this._inputs)) {
            slider.value = cfg[key];
            num.value    = cfg[key];
        }
    }

    show() { if (this._el) this._el.style.display = 'block'; }
    hide() { if (this._el) this._el.style.display = 'none'; }
    toggle() {
        if (!this._el) return;
        this._el.style.display = this._el.style.display === 'none' ? 'block' : 'none';
    }
}
