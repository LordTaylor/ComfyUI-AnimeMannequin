import { BUST_DEFAULTS } from '../mannequin-renderer.js';
import { SetBustCfgCommand } from '../commands.js';

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
            'user-select:none', 'display:none',   // closed by default
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
            const text  = `{\n${lines}\n}`;

            const finish = ok => {
                copyBtn.textContent = ok ? 'Copied!' : 'Clipboard error';
                setTimeout(() => { copyBtn.textContent = 'Copy as JS'; }, 1200);
            };

            // Primary: async Clipboard API (works in standalone / secure context)
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => execCopy());
            } else {
                execCopy();
            }

            // Fallback: execCommand via hidden textarea (works inside iframe/ComfyUI)
            function execCopy() {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                finish(ok);
            }
        });

        // ── Sliders organised by section ───────────────────────────────────────
        const SECTIONS = [
            {
                label: 'Position — Local',
                fields: [
                    { key: 'loc_x',      label: 'X',      min: -1.0, max:  1.0,  step: 0.05  },
                    { key: 'loc_y',      label: 'Y',      min: -1.0, max:  1.0,  step: 0.05  },
                    { key: 'loc_z',      label: 'Z',      min: -2.0, max:  2.0,  step: 0.05  },
                    { key: 'loc_z_base', label: 'Z base', min: -0.2, max:  0.2,  step: 0.01  },
                ],
            },
            {
                label: 'Position — Global',
                fields: [
                    { key: 'glob_y_base', label: 'Y sep', min: -0.3, max: 0.3, step: 0.005 },
                    { key: 'glob_y',      label: 'Y',     min:  0.0, max: 0.3, step: 0.005 },
                    { key: 'glob_z',      label: 'Z',     min: -1.0, max: 1.0, step: 0.05  },
                ],
            },
            {
                label: 'Rotation — Local',
                fields: [
                    { key: 'rot_x', label: 'X', min: -2.0, max: 2.0, step: 0.05 },
                    { key: 'rot_y', label: 'Y', min: -2.0, max: 2.0, step: 0.05 },
                    { key: 'rot_z', label: 'Z', min: -2.0, max: 2.0, step: 0.05 },
                ],
            },
            {
                label: 'Rotation — Global',
                fields: [
                    { key: 'grot_x', label: 'X', min: -2.0, max: 2.0, step: 0.05 },
                    { key: 'grot_y', label: 'Y', min: -2.0, max: 2.0, step: 0.05 },
                    { key: 'grot_z', label: 'Z', min: -2.0, max: 2.0, step: 0.05 },
                ],
            },
            {
                label: 'Scale',
                fields: [
                    { key: 'scale_x', label: 'X', min: 0.1, max: 2.0, step: 0.05 },
                ],
            },
        ];

        const mkSectionHeader = label => {
            const d = document.createElement('div');
            d.style.cssText = 'font-size:10px;color:#7cf;border-top:1px solid #444;margin:7px 0 3px;padding-top:4px;font-weight:bold;';
            d.textContent = label;
            panel.appendChild(d);
        };

        for (const { label, fields } of SECTIONS) {
            mkSectionHeader(label);

            for (const { key, label: lbl, min, max, step } of fields) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0;';

                const lblEl = document.createElement('span');
                lblEl.textContent = lbl;
                lblEl.style.cssText = 'width:44px;flex-shrink:0;color:#aaa;';
                row.appendChild(lblEl);

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
