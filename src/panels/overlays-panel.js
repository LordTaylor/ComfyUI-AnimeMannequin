import { SetBgImageCommand, SetCropFrameCfgCommand } from '../commands.js';

/**
 * Floating "Overlays" panel — reference background image + crop frame style.
 *
 * Editor-only: neither element appears in exported renders (pose/depth/canny).
 * All changes go through CommandHistory → fully undo/redo-able.
 *
 * Usage:
 *   const panel = new OverlaysPanel(store, history);
 *   panel.mount(document.body);
 *   panel.toggle();
 */
export class OverlaysPanel {
    constructor(store, history) {
        this._store   = store;
        this._history = history;
        this._el      = null;
        this._inputs  = {};
        this._onMouseMove = null;
        this._onMouseUp   = null;
        this._storeUnsub  = null;
    }

    mount(parent) {
        if (this._el) return;

        const panel = document.createElement('div');
        panel.id = 'overlays-panel';
        panel.style.cssText = [
            'position:fixed', 'top:48px', 'left:8px',
            'background:rgba(20,20,20,0.92)', 'color:#eee',
            'font-size:11px', 'font-family:monospace',
            'padding:8px 10px', 'border-radius:6px',
            'z-index:9999', 'min-width:220px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
            'user-select:none', 'display:none',
        ].join(';');

        // ── Header + drag ──────────────────────────────────────────────────────
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';

        const title = document.createElement('span');
        title.textContent = '🖼 Overlays';
        title.style.cssText = 'font-weight:bold;color:#7cf;cursor:move;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.id = 'overlays-close';
        closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;padding:0 4px;font-size:12px;';
        closeBtn.addEventListener('click', () => this.hide());

        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // Drag logic
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

        // ── Section label helper ───────────────────────────────────────────────
        const mkSep = label => {
            const d = document.createElement('div');
            d.style.cssText = 'font-size:10px;color:#888;border-top:1px solid #444;margin:6px 0 4px;padding-top:4px;';
            d.textContent = label;
            panel.appendChild(d);
        };

        // ── Background image section ───────────────────────────────────────────
        mkSep('Background image');

        const bgBtnRow = document.createElement('div');
        bgBtnRow.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;';

        const chooseBtn = document.createElement('button');
        chooseBtn.textContent = 'Wybierz obraz';
        chooseBtn.style.cssText = 'flex:1;padding:3px 6px;font-size:10px;cursor:pointer;';
        chooseBtn.addEventListener('click', () => {
            document.getElementById('bg-file-input')?.click();
        });

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'padding:3px 8px;font-size:10px;cursor:pointer;';
        removeBtn.addEventListener('click', () => {
            const prev = this._store.getState().bgImage;
            if (!prev.dataUrl) return;
            this._history.execute(
                new SetBgImageCommand(prev, { ...prev, dataUrl: null }),
                this._store
            );
        });

        bgBtnRow.appendChild(chooseBtn);
        bgBtnRow.appendChild(removeBtn);
        panel.appendChild(bgBtnRow);

        // bg opacity slider
        this._inputs.bgOpacity = this._mkSlider(panel, 'Opacity', 0, 1, 0.01,
            () => this._store.getState().bgImage.opacity,
            v  => this._store.setBgImage({ opacity: v }),
            v  => {
                const prev = this._store.getState().bgImage;
                this._history.execute(new SetBgImageCommand(prev, { ...prev, opacity: v }), this._store);
            }
        );

        // bg zoom slider
        this._inputs.bgZoom = this._mkSlider(panel, 'Zoom', 0.5, 3.0, 0.05,
            () => this._store.getState().bgImage.zoom,
            v  => this._store.setBgImage({ zoom: v }),
            v  => {
                const prev = this._store.getState().bgImage;
                this._history.execute(new SetBgImageCommand(prev, { ...prev, zoom: v }), this._store);
            }
        );

        // ── Crop frame section ─────────────────────────────────────────────────
        mkSep('Crop frame');

        // Color picker row
        const colorRow = document.createElement('div');
        colorRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0;';

        const colorLbl = document.createElement('span');
        colorLbl.textContent = 'Color';
        colorLbl.style.cssText = 'width:64px;flex-shrink:0;color:#aaa;';

        const colorInput = document.createElement('input');
        colorInput.type  = 'color';
        colorInput.value = this._store.getState().cropFrame.color;
        colorInput.style.cssText = 'flex:1;height:22px;cursor:pointer;border:none;background:none;padding:0;';

        // Capture value before color picker opens so undo can restore it
        let colorBeforeEdit = this._store.getState().cropFrame.color;
        colorInput.addEventListener('focus', () => {
            colorBeforeEdit = this._store.getState().cropFrame.color;
        });
        colorInput.addEventListener('input', () => {
            this._store.setCropFrame({ color: colorInput.value });
        });
        colorInput.addEventListener('change', () => {
            const currentColor = this._store.getState().cropFrame.color;
            if (colorBeforeEdit === currentColor) return;
            const prev = { ...this._store.getState().cropFrame, color: colorBeforeEdit };
            const next = { ...this._store.getState().cropFrame };
            this._history.execute(new SetCropFrameCfgCommand(prev, next), this._store);
        });

        colorRow.appendChild(colorLbl);
        colorRow.appendChild(colorInput);
        panel.appendChild(colorRow);
        this._inputs.cropColor = colorInput;

        // crop frame opacity slider
        this._inputs.cropOpacity = this._mkSlider(panel, 'Opacity', 0, 1, 0.01,
            () => this._store.getState().cropFrame.opacity,
            v  => this._store.setCropFrame({ opacity: v }),
            v  => {
                const prev = this._store.getState().cropFrame;
                this._history.execute(new SetCropFrameCfgCommand(prev, { ...prev, opacity: v }), this._store);
            }
        );

        // ── Store sync ─────────────────────────────────────────────────────────
        this._storeUnsub = this._store.subscribe(() => this._syncFromStore());

        this._el = panel;
        parent.appendChild(panel);
    }

    /**
     * Helper: labeled range slider row.
     * Returns { slider, num } for external sync.
     */
    _mkSlider(parent, label, min, max, step, getValue, onInput, onChange) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0;';

        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'width:64px;flex-shrink:0;color:#aaa;';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min; slider.max = max; slider.step = step;
        slider.value = getValue();
        slider.style.cssText = 'flex:1;cursor:pointer;';

        const num = document.createElement('span');
        num.style.cssText = 'width:36px;text-align:right;color:#ccc;font-size:10px;';
        num.textContent = parseFloat(getValue()).toFixed(2);

        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            num.textContent = v.toFixed(2);
            onInput(v);
        });
        slider.addEventListener('change', () => onChange(parseFloat(slider.value)));

        row.appendChild(lbl);
        row.appendChild(slider);
        row.appendChild(num);
        parent.appendChild(row);
        return { slider, num };
    }

    _syncFromStore() {
        if (!this._el) return;
        const state = this._store.getState();

        if (this._inputs.bgOpacity) {
            this._inputs.bgOpacity.slider.value = state.bgImage.opacity;
            this._inputs.bgOpacity.num.textContent = state.bgImage.opacity.toFixed(2);
        }
        if (this._inputs.bgZoom) {
            this._inputs.bgZoom.slider.value = state.bgImage.zoom;
            this._inputs.bgZoom.num.textContent = state.bgImage.zoom.toFixed(2);
        }
        if (this._inputs.cropColor) {
            this._inputs.cropColor.value = state.cropFrame.color;
        }
        if (this._inputs.cropOpacity) {
            this._inputs.cropOpacity.slider.value = state.cropFrame.opacity;
            this._inputs.cropOpacity.num.textContent = state.cropFrame.opacity.toFixed(2);
        }
    }

    isVisible() { return this._el ? this._el.style.display !== 'none' : false; }
    show()   { if (this._el) this._el.style.display = 'block'; }
    hide()   { if (this._el) this._el.style.display = 'none'; }
    toggle() {
        if (!this._el) return;
        this._el.style.display = this._el.style.display === 'none' ? 'block' : 'none';
    }

    dispose() {
        if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
        if (this._onMouseUp)   document.removeEventListener('mouseup',   this._onMouseUp);
        if (this._storeUnsub)  this._storeUnsub();
        this._el?.remove();
        this._el = null;
    }
}
