import { BUST_DEFAULTS } from './mannequin-renderer.js';
import { SetBustCfgCommand } from './commands.js';

/**
 * Floating debug panel for live-tweaking bust config parameters.
 *
 * Accepts AppStore + CommandHistory — all changes go through commands
 * (undo/redo works for bust param tweaks).
 *
 * Usage:
 *   const dbg = new BustDebugPanel(store, history);
 *   dbg.mount(document.body);
 *   dbg.toggle();
 */
export class BustDebugPanel {
    constructor(store, history) {
        this._store   = store;
        this._history = history;
        this._el      = null;
        this._inputs  = {};

        // Store refs for cleanup
        this._onMouseMove = null;
        this._onMouseUp   = null;
        this._storeUnsub  = null;
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

        // ── Header + drag ──────────────────────────────────────────────────────
        const title = document.createElement('div');
        title.textContent = '⚙ Bust Config';
        title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#7cf;cursor:move;';
        panel.appendChild(title);

        let ox = 0, oy = 0, dragging = false;
        title.addEventListener('mousedown', e => {
            dragging = true;
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
        });
        this._onMouseMove = e => {
            if (!dragging) return;
            panel.style.left  = (e.clientX - ox) + 'px';
            panel.style.top   = (e.clientY - oy) + 'px';
            panel.style.right = 'auto';
        };
        this._onMouseUp = () => { dragging = false; };
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup',   this._onMouseUp);

        // ── Buttons ────────────────────────────────────────────────────────────
        const mkBtn = (label, onClick) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'margin-bottom:6px;padding:2px 8px;font-size:10px;cursor:pointer;width:100%;';
            b.addEventListener('click', onClick);
            panel.appendChild(b);
            return b;
        };

        mkBtn('Reset defaults', () => {
            const prev = this._store.getState().bustCfg;
            this._history.execute(
                new SetBustCfgCommand(prev, { ...BUST_DEFAULTS }),
                this._store
            );
            this._syncInputs();
        });

        const copyBtn = mkBtn('Copy as JS', () => {
            const cfg   = this._store.getState().bustCfg;
            const lines = Object.entries(cfg).map(([k, v]) => `    ${k.padEnd(9)}: ${v},`).join('\n');
            navigator.clipboard?.writeText(`{\n${lines}\n}`).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy as JS'; }, 1200);
            }).catch(() => { copyBtn.textContent = 'Clipboard error'; });
        });

        // ── Sliders ────────────────────────────────────────────────────────────
        const FIELDS = [
            { key: 'baseFwd',  min: -0.2, max:  0.2,  step: 0.01 },
            { key: 'fwdPush',  min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'droop',    min: -1.0, max:  1.0,  step: 0.05 },
            { key: 'spread',   min:  0.0, max:  0.3,  step: 0.005 }, // ← world horizontal spread
            { key: 'latX',     min: -1.0, max:  1.0,  step: 0.05 },
            { key: 'latY',     min: -1.0, max:  1.0,  step: 0.05 },
            { key: 'rotFwd',   min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'rotLat',   min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'rotY',     min: -2.0, max:  2.0,  step: 0.05 },
            { key: 'xSqueeze', min:  0.1, max:  2.0,  step: 0.05 },
        ];

        for (const { key, min, max, step } of FIELDS) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0;';

            const lbl = document.createElement('span');
            lbl.textContent = key;
            lbl.style.cssText = 'width:64px;flex-shrink:0;color:#aaa;';
            row.appendChild(lbl);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = min; slider.max = max; slider.step = step;
            slider.value = this._store.getState().bustCfg[key] ?? BUST_DEFAULTS[key];
            slider.style.cssText = 'flex:1;cursor:pointer;';

            const num = document.createElement('input');
            num.type = 'number';
            num.min = min; num.max = max; num.step = step;
            num.value = slider.value;
            num.style.cssText = 'width:52px;background:#333;color:#eee;border:1px solid #555;border-radius:3px;padding:1px 3px;font-size:10px;';

            // Live update via slider (no history entry — too noisy while dragging)
            slider.addEventListener('input', () => {
                const v = parseFloat(slider.value);
                num.value = v;
                this._store.setBustCfg({ [key]: v });
            });

            // Commit to history on slider release and number change
            slider.addEventListener('change', () => this._commitBustChange(key, parseFloat(slider.value)));
            num.addEventListener('change', () => {
                const v = parseFloat(num.value);
                if (isNaN(v)) return;
                slider.value = v;
                this._commitBustChange(key, v);
            });

            row.appendChild(slider);
            row.appendChild(num);
            panel.appendChild(row);
            this._inputs[key] = { slider, num };
        }

        // ── Subscribe to store for external changes ───────────────────────────
        this._storeUnsub = this._store.subscribe(() => this._syncInputs());

        this._el = panel;
        parent.appendChild(panel);
    }

    /** Commit a slider change to CommandHistory (creates undo-able action). */
    _commitBustChange(key, value) {
        const prev = this._store.getState().bustCfg;
        if (prev[key] === value) return;
        this._history.execute(
            new SetBustCfgCommand(prev, { ...prev, [key]: value }),
            this._store
        );
    }

    /** Sync UI inputs from current store state (e.g. after undo/redo). */
    _syncInputs() {
        const cfg = this._store.getState().bustCfg;
        for (const [key, { slider, num }] of Object.entries(this._inputs)) {
            if (cfg[key] !== undefined) {
                slider.value = cfg[key];
                num.value    = cfg[key];
            }
        }
    }

    show()   { if (this._el) this._el.style.display = 'block'; }
    hide()   { if (this._el) this._el.style.display = 'none'; }
    toggle() {
        if (!this._el) return;
        this._el.style.display = this._el.style.display === 'none' ? 'block' : 'none';
    }

    /** Cleanup — call when removing the panel. */
    dispose() {
        if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
        if (this._onMouseUp)   document.removeEventListener('mouseup',   this._onMouseUp);
        if (this._storeUnsub)  this._storeUnsub();
        this._el?.remove();
        this._el = null;
    }
}
