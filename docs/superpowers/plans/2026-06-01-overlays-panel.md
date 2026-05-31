# Overlays Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating "Overlays" panel with a semi-transparent reference background image and crop-frame color/opacity controls — editor-only, invisible in exports.

**Architecture:** CSS overlay `<img>` behind WebGL canvas (renderer never sees it → exports clean). State lives in AppStore (`bgImage` + `cropFrame`). All changes go through CommandHistory → fully undo/redo-able. OverlaysPanel follows the BustDebugPanel pattern.

**Tech Stack:** Vanilla JS ES modules, AppStore/CommandHistory, Vitest + jsdom, Three.js (untouched)

---

## Files

| Action | Path |
|--------|------|
| Modify | `static/src/app-store.js` |
| Modify | `static/src/commands.js` |
| Create | `static/src/overlays-panel.js` |
| Modify | `static/index.html` |
| Modify | `tests/js/app-store-setters.test.js` |
| Modify | `tests/js/commands.test.js` |
| Create | `tests/js/overlays-panel.test.js` |

---

## Task 1: AppStore — bgImage + cropFrame state + setters

**Files:**
- Modify: `static/src/app-store.js`
- Modify: `tests/js/app-store-setters.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/js/app-store-setters.test.js` (after the existing `setOutputSize` describe block):

```js
// ── setBgImage ────────────────────────────────────────────────────────────────

describe('setBgImage', () => {
    it('patches dataUrl, preserves opacity and zoom', () => {
        const s = mkStore();
        s.setBgImage({ dataUrl: 'data:image/png;base64,abc' });
        const bg = s.getState().bgImage;
        expect(bg.dataUrl).toBe('data:image/png;base64,abc');
        expect(bg.opacity).toBe(0.5);
        expect(bg.zoom).toBe(1.0);
    });

    it('successive patches accumulate', () => {
        const s = mkStore();
        s.setBgImage({ opacity: 0.3 });
        s.setBgImage({ zoom: 2.0 });
        const bg = s.getState().bgImage;
        expect(bg.opacity).toBe(0.3);
        expect(bg.zoom).toBe(2.0);
    });

    it('getState returns copy — mutation does not affect store', () => {
        const s = mkStore();
        s.setBgImage({ dataUrl: 'x' });
        const bg = s.getState().bgImage;
        bg.dataUrl = 'mutated';
        expect(s.getState().bgImage.dataUrl).toBe('x');
    });

    it('notifies subscribers once', () => {
        const s = mkStore(); const spy = vi.fn();
        s.subscribe(spy);
        s.setBgImage({ opacity: 0.2 });
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

// ── setCropFrame ──────────────────────────────────────────────────────────────

describe('setCropFrame', () => {
    it('patches color, preserves opacity', () => {
        const s = mkStore();
        s.setCropFrame({ color: '#ff0000' });
        const cf = s.getState().cropFrame;
        expect(cf.color).toBe('#ff0000');
        expect(cf.opacity).toBe(0.55);
    });

    it('patches opacity, preserves color', () => {
        const s = mkStore();
        s.setCropFrame({ opacity: 0.9 });
        expect(s.getState().cropFrame.opacity).toBe(0.9);
        expect(s.getState().cropFrame.color).toBe('#ffffff');
    });

    it('notifies subscribers once', () => {
        const s = mkStore(); const spy = vi.fn();
        s.subscribe(spy);
        s.setCropFrame({ opacity: 0.9 });
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run — expect FAIL (setBgImage is not a function)**

```bash
npx vitest run tests/js/app-store-setters.test.js 2>&1 | tail -20
```

Expected: failures on `setBgImage` and `setCropFrame` not defined.

- [ ] **Step 3: Implement in app-store.js**

In `defaultState()`, add two new fields after `outputHeight`:

```js
export function defaultState(gender = 'F') {
    return {
        gender,
        pose:          {},
        proportions:   defaultProportions(),
        bustCfg:       { ...BUST_DEFAULTS },
        jointColorMode: 'openpose',
        groundEnabled:  false,
        outputWidth:    768,
        outputHeight:   1024,
        bgImage:   { dataUrl: null, opacity: 0.5, zoom: 1.0 },
        cropFrame: { color: '#ffffff', opacity: 0.55 },
    };
}
```

In `getState()`, add clones for the two new fields (after `bustCfg` line):

```js
getState() {
    const pose = {};
    for (const [k, v] of Object.entries(this._state.pose)) pose[k] = { ...v };
    return {
        ...this._state,
        pose,
        proportions: { ...this._state.proportions },
        bustCfg:     { ...this._state.bustCfg },
        bgImage:     { ...this._state.bgImage },
        cropFrame:   { ...this._state.cropFrame },
    };
}
```

Add two setters after `setOutputSize` (before `subscribe`):

```js
/** Patch background image config — niezmienione pola zostają. */
setBgImage(partial) {
    this._state = { ...this._state, bgImage: { ...this._state.bgImage, ...partial } };
    this._notify();
}

/** Patch crop frame style — niezmienione pola zostają. */
setCropFrame(partial) {
    this._state = { ...this._state, cropFrame: { ...this._state.cropFrame, ...partial } };
    this._notify();
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/js/app-store-setters.test.js 2>&1 | tail -10
```

Expected: all tests pass (was 20, now ~27).

- [ ] **Step 5: Run full suite — expect no regressions**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: all previous 184 + new tests pass.

- [ ] **Step 6: Commit**

```bash
git add static/src/app-store.js tests/js/app-store-setters.test.js
git commit -m "feat: AppStore — bgImage + cropFrame state and setters"
```

---

## Task 2: Commands — SetBgImageCommand + SetCropFrameCfgCommand

**Files:**
- Modify: `static/src/commands.js`
- Modify: `tests/js/commands.test.js`

- [ ] **Step 1: Write failing tests**

In `tests/js/commands.test.js`:

1. Add the new commands to the import line (replace existing destructure):

```js
const {
    CommandHistory,
    RotateBoneCommand, SetProportionsCommand, SetBustCfgCommand,
    SetGenderCommand, ResetPoseCommand, MirrorPoseCommand,
    RandomPoseCommand, SetJointColorModeCommand,
    SetBgImageCommand, SetCropFrameCfgCommand,
} = await import('../../static/src/commands.js');
```

2. Append describe blocks at the end of the file:

```js
// ── SetBgImageCommand ─────────────────────────────────────────────────────────

describe('SetBgImageCommand', () => {
    it('execute sets dataUrl and opacity', () => {
        const s = mkStore();
        const prev = s.getState().bgImage;
        const next = { ...prev, dataUrl: 'data:image/png;base64,abc', opacity: 0.3 };
        new SetBgImageCommand(prev, next).execute(s);
        expect(s.getState().bgImage.dataUrl).toBe('data:image/png;base64,abc');
        expect(s.getState().bgImage.opacity).toBe(0.3);
    });

    it('undo restores previous state', () => {
        const s = mkStore();
        const prev = s.getState().bgImage;
        const next = { ...prev, dataUrl: 'data:image/png;base64,abc' };
        const cmd = new SetBgImageCommand(prev, next);
        cmd.execute(s);
        cmd.undo(s);
        expect(s.getState().bgImage.dataUrl).toBe(null);
    });

    it('undo of remove restores dataUrl', () => {
        const s = mkStore();
        s.setBgImage({ dataUrl: 'data:image/png;base64,xyz' });
        const prev = s.getState().bgImage;
        const cmd = new SetBgImageCommand(prev, { ...prev, dataUrl: null });
        cmd.execute(s);
        expect(s.getState().bgImage.dataUrl).toBeNull();
        cmd.undo(s);
        expect(s.getState().bgImage.dataUrl).toBe('data:image/png;base64,xyz');
    });
});

// ── SetCropFrameCfgCommand ────────────────────────────────────────────────────

describe('SetCropFrameCfgCommand', () => {
    it('execute sets color and opacity', () => {
        const s = mkStore();
        const prev = s.getState().cropFrame;
        const next = { ...prev, color: '#ff0000', opacity: 0.8 };
        new SetCropFrameCfgCommand(prev, next).execute(s);
        expect(s.getState().cropFrame.color).toBe('#ff0000');
        expect(s.getState().cropFrame.opacity).toBe(0.8);
    });

    it('undo restores previous crop frame', () => {
        const s = mkStore();
        const prev = s.getState().cropFrame;
        const cmd = new SetCropFrameCfgCommand(prev, { ...prev, color: '#ff0000' });
        cmd.execute(s); cmd.undo(s);
        expect(s.getState().cropFrame.color).toBe('#ffffff');
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/js/commands.test.js 2>&1 | tail -10
```

Expected: `SetBgImageCommand is not a constructor` (or similar).

- [ ] **Step 3: Implement in commands.js**

Append at the end of `static/src/commands.js`:

```js
/**
 * Zmiana background image (dataUrl, opacity, zoom).
 * Undo obrazu "load" → przywraca poprzedni obraz (lub null).
 */
export class SetBgImageCommand extends Command {
    constructor(prev, next) {
        super();
        this._prev = { ...prev };
        this._next = { ...next };
    }

    execute(store) { store.setBgImage(this._next); }
    undo(store)    { store.setBgImage(this._prev); }
    get description() { return 'Set background image'; }
}

/**
 * Zmiana stylu ramki kadrowania (color, opacity).
 */
export class SetCropFrameCfgCommand extends Command {
    constructor(prev, next) {
        super();
        this._prev = { ...prev };
        this._next = { ...next };
    }

    execute(store) { store.setCropFrame(this._next); }
    undo(store)    { store.setCropFrame(this._prev); }
    get description() { return 'Set crop frame style'; }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/js/commands.test.js 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Full suite — no regressions**

```bash
npx vitest run 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add static/src/commands.js tests/js/commands.test.js
git commit -m "feat: SetBgImageCommand + SetCropFrameCfgCommand"
```

---

## Task 3: OverlaysPanel component

**Files:**
- Create: `static/src/overlays-panel.js`
- Create: `tests/js/overlays-panel.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/js/overlays-panel.test.js`:

```js
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: { baseFwd:0, fwdPush:0.65, droop:0.2, latX:0.18, latY:0.3, spread:0.0,
                     rotFwd:0.6, rotLat:-0.5, rotY:0.5, xSqueeze:1.0 },
}));
vi.mock('../../static/src/mannequin-model.js', () => ({
    defaultProportions: () => ({ head:1, bust:1, hips:1, waist:1, legs:1, arms:1 }),
}));

const { AppStore, defaultState } = await import('../../static/src/app-store.js');
const { CommandHistory }         = await import('../../static/src/commands.js');
const { OverlaysPanel }          = await import('../../static/src/overlays-panel.js');

const mkStore   = () => new AppStore(defaultState());
const mkHistory = () => new CommandHistory(20);

function mkPanel() {
    const store   = mkStore();
    const history = mkHistory();
    const panel   = new OverlaysPanel(store, history);
    panel.mount(document.body);
    return { store, history, panel };
}

// ── mount / toggle ────────────────────────────────────────────────────────────

describe('mount / visibility', () => {
    it('starts hidden after mount', () => {
        const { panel } = mkPanel();
        expect(panel.isVisible()).toBe(false);
        panel.dispose();
    });

    it('toggle shows panel', () => {
        const { panel } = mkPanel();
        panel.toggle();
        expect(panel.isVisible()).toBe(true);
        panel.dispose();
    });

    it('toggle twice hides panel', () => {
        const { panel } = mkPanel();
        panel.toggle(); panel.toggle();
        expect(panel.isVisible()).toBe(false);
        panel.dispose();
    });
});

// ── background image ──────────────────────────────────────────────────────────

describe('background image', () => {
    it('remove button sets dataUrl to null in store', () => {
        const { store, panel } = mkPanel();
        store.setBgImage({ dataUrl: 'data:image/png;base64,abc' });
        const removeBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent === '✕');
        removeBtn.click();
        expect(store.getState().bgImage.dataUrl).toBeNull();
        panel.dispose();
    });

    it('remove button creates undo-able command', () => {
        const { store, history, panel } = mkPanel();
        store.setBgImage({ dataUrl: 'data:image/png;base64,abc' });
        const removeBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent === '✕');
        removeBtn.click();
        expect(history.canUndo).toBe(true);
        history.undo(store);
        expect(store.getState().bgImage.dataUrl).toBe('data:image/png;base64,abc');
        panel.dispose();
    });

    it('remove button does nothing when dataUrl already null', () => {
        const { store, history, panel } = mkPanel();
        const removeBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent === '✕');
        removeBtn.click();
        expect(history.canUndo).toBe(false);
        panel.dispose();
    });
});

// ── crop frame ────────────────────────────────────────────────────────────────

describe('crop frame color input', () => {
    it('input event updates store live (no history entry)', () => {
        const { store, history, panel } = mkPanel();
        const colorInput = document.querySelector('input[type="color"]');
        colorInput.value = '#ff0000';
        colorInput.dispatchEvent(new Event('input'));
        expect(store.getState().cropFrame.color).toBe('#ff0000');
        expect(history.canUndo).toBe(false);   // live update, no commit
        panel.dispose();
    });

    it('change event commits to history', () => {
        const { store, history, panel } = mkPanel();
        const colorInput = document.querySelector('input[type="color"]');
        colorInput.dispatchEvent(new Event('focus'));
        colorInput.value = '#ff0000';
        colorInput.dispatchEvent(new Event('input'));
        colorInput.dispatchEvent(new Event('change'));
        expect(history.canUndo).toBe(true);
        history.undo(store);
        expect(store.getState().cropFrame.color).toBe('#ffffff');
        panel.dispose();
    });
});

// ── _syncFromStore (undo/redo sync) ───────────────────────────────────────────

describe('_syncFromStore', () => {
    it('opacity slider updates after store change', () => {
        const { store, panel } = mkPanel();
        store.setBgImage({ opacity: 0.2 });
        const sliders = document.querySelectorAll('input[type="range"]');
        // First range slider is bgOpacity
        expect(parseFloat(sliders[0].value)).toBeCloseTo(0.2);
        panel.dispose();
    });

    it('crop frame opacity slider updates after store change', () => {
        const { store, panel } = mkPanel();
        store.setCropFrame({ opacity: 0.9 });
        const sliders = document.querySelectorAll('input[type="range"]');
        // Third range slider is cropOpacity (after bgOpacity, bgZoom)
        expect(parseFloat(sliders[2].value)).toBeCloseTo(0.9);
        panel.dispose();
    });
});

// ── dispose ───────────────────────────────────────────────────────────────────

describe('dispose', () => {
    it('stops receiving store notifications after dispose', () => {
        const { store, panel } = mkPanel();
        panel.dispose();
        const spy = vi.spyOn(panel, '_syncFromStore');
        store.setBgImage({ opacity: 0.1 });
        expect(spy).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/js/overlays-panel.test.js 2>&1 | tail -10
```

Expected: `Cannot find module '../../static/src/overlays-panel.js'`

- [ ] **Step 3: Create overlays-panel.js**

Create `static/src/overlays-panel.js`:

```js
import { SetBgImageCommand, SetCropFrameCfgCommand } from './commands.js';

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
            const prev = { ...this._store.getState().cropFrame, color: colorBeforeEdit };
            const next = { ...this._store.getState().cropFrame };
            if (prev.color === next.color) return;
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
     * @param {HTMLElement} parent
     * @param {string} label
     * @param {number} min / max / step
     * @param {() => number} getValue — reads current value from store
     * @param {(v: number) => void} onInput — live update (no history)
     * @param {(v: number) => void} onChange — commit to history
     * @returns {{ slider: HTMLInputElement, num: HTMLElement }}
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/js/overlays-panel.test.js 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 5: Full suite**

```bash
npx vitest run 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add static/src/overlays-panel.js tests/js/overlays-panel.test.js
git commit -m "feat: OverlaysPanel component — bg image + crop frame controls"
```

---

## Task 4: index.html — DOM, FileReader, reactive wiring

**Files:**
- Modify: `static/index.html`

No automated tests for this task — tested manually in Task 5.

- [ ] **Step 1: Add DOM elements**

Inside `#canvas-wrap`, after `<canvas id="c">` and before `#export-bar`, add:

```html
<!-- Background reference image — editor only, not in exports -->
<img id="bg-image"
     style="display:none; position:absolute; inset:0;
            width:100%; height:100%; object-fit:cover;
            pointer-events:none; transform-origin:center;" />

<!-- Hidden file input for bg image picker -->
<input type="file" id="bg-file-input" accept="image/*" style="display:none" />
```

- [ ] **Step 2: Add toolbar button**

In `#toolbar`, after `<button id="btn-bust-dbg"...>`, add:

```html
<button id="btn-overlays" title="Overlays — reference image &amp; crop frame">Overlays</button>
```

Add CSS for it in the `<style>` block (after `#btn-bust-dbg` line or with similar buttons):

```css
#btn-overlays { background: #333; color: #aaa; }
#btn-overlays.active { background: #4a5a3a; color: #cef; }
```

- [ ] **Step 3: Import OverlaysPanel**

Add `OverlaysPanel` to the import block. Also extend the existing `commands.js` import line to include `SetBgImageCommand` (needed for the FileReader handler):

```js
// NEW line:
import { OverlaysPanel } from './src/overlays-panel.js';

// CHANGE existing line from:
import { CommandHistory } from './src/commands.js';
// TO:
import { CommandHistory, SetBgImageCommand } from './src/commands.js';
```

- [ ] **Step 4: Instantiate OverlaysPanel and wire toolbar button**

After `bustDbg` lines:

```js
const overlaysPanel = new OverlaysPanel(store, history);
overlaysPanel.mount(document.body);

const btnOverlays = document.getElementById('btn-overlays');
btnOverlays.addEventListener('click', () => {
    overlaysPanel.toggle();
    btnOverlays.classList.toggle('active', overlaysPanel.isVisible());
});
```

- [ ] **Step 5: Wire FileReader for image loading**

Add after the `overlaysPanel` setup (still inside the module script):

```js
// Load background image via file picker
document.getElementById('bg-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const prev = store.getState().bgImage;
        history.execute(
            new SetBgImageCommand(prev, { ...prev, dataUrl: ev.target.result }),
            store
        );
    };
    reader.readAsDataURL(file);
    e.target.value = '';   // reset so same file can be re-selected
});
```

- [ ] **Step 6: Add reactive store subscription for overlays**

Add a `store.subscribe` call (alongside the existing toolbar/store wiring). Place it after the `btnColors` listener setup:

```js
// ── Reactive overlay updates ──────────────────────────────────────────────────
store.subscribe(state => {
    // Background image
    const bgImg = document.getElementById('bg-image');
    const { dataUrl, opacity, zoom } = state.bgImage;
    if (dataUrl) {
        if (bgImg.src !== dataUrl) bgImg.src = dataUrl;
        bgImg.style.display = 'block';
    } else {
        bgImg.style.display = 'none';
    }
    bgImg.style.opacity   = opacity;
    bgImg.style.transform = `scale(${zoom})`;

    // Crop frame border color (driven by store instead of static CSS)
    const frame = document.getElementById('crop-frame');
    const { color, opacity: cfOpacity } = state.cropFrame;
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    frame.style.borderColor  = `rgba(${r},${g},${b},${cfOpacity})`;
    frame.style.outlineColor = `rgba(0,0,0,${Math.min(1, cfOpacity * 0.65)})`;
});
```

- [ ] **Step 7: Remove static crop frame border CSS**

The `#crop-frame` style block currently has:
```css
border: 1.5px solid rgba(255, 255, 255, 0.55);
outline: 1px solid rgba(0, 0, 0, 0.35);
```

Change it so border/outline are still declared (prevents flash on load) but will be overridden reactively. Replace those two lines with:

```css
border: 1.5px solid rgba(255, 255, 255, 0.55);   /* overridden by store subscription */
outline: 1px solid rgba(0, 0, 0, 0.35);           /* overridden by store subscription */
```

(No change needed — the CSS defaults match the store defaults so no flash.)

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat: Overlays panel wired — bg image loader + crop frame reactive"
```

---

## Task 5: Manual verification

Verify in browser at `http://localhost:8080` (or however you serve it). No server needed — open `static/index.html` directly in browser with `file://` or via a local server.

**Checklist A — Background image basics:**

- [ ] Click "Overlays" button → panel appears
- [ ] Click "Wybierz obraz" → system file picker opens
- [ ] Select a PNG/JPG → image appears behind mannequin, semi-transparent
- [ ] Opacity slider → image fades/brightens in real-time
- [ ] Zoom slider → image scales around center
- [ ] "✕" (remove) → image disappears
- [ ] Ctrl+Z → image comes back (undo)
- [ ] Ctrl+Shift+Z → removed again (redo)

**Checklist B — Export verification (critical):**

- [ ] Load a bright/distinctive background image (solid colour works well)
- [ ] Click "⬇ pose.png" → downloaded PNG has **no background image**, only mannequin on dark bg
- [ ] Click "⬇ depth.png" → depth map has **no background image**
- [ ] Click "⬇ canny.png" → canny edges show **no background image edges**

**Checklist C — Crop frame color:**

- [ ] Open Overlays panel → Crop frame section visible
- [ ] Change color to red `#ff0000` → crop frame border turns red immediately
- [ ] Change opacity to 0 → crop frame invisible
- [ ] Change opacity back to 0.8 → visible again
- [ ] Ctrl+Z → restores previous opacity (undo works)

**Checklist D — With/without bone locking:**

- [ ] Rotate a bone (drag), then open Overlays and load a background image → pose unchanged
- [ ] Undo image load (Ctrl+Z) → image removed, pose still intact
- [ ] Redo image load (Ctrl+Shift+Z) → image back, pose still intact
- [ ] Load image, rotate another bone, Undo twice → second undo reverts bone rotation (not image)

**Checklist E — Full suite still green:**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: all tests pass (zero regressions).

- [ ] **Step: Deploy and smoke-test on nox**

```bash
./deploy.sh
```

Then open `http://192.168.50.199:8188` → Extensions → Mannequin node → repeat Checklist B in ComfyUI iframe context.

- [ ] **Final commit (if deploy needed tweaks)**

```bash
git add -p
git commit -m "fix: overlays panel — post-deploy tweaks"
git push
```
