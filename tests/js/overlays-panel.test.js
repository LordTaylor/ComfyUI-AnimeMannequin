// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: { loc_z_base:0, loc_z:0.65, glob_z:0.2, loc_x:0.18, loc_y:0.3, glob_y:0.0,
                     rot_x:0.6, rot_z:-0.5, rot_y:0.5, grot_x:0.0, grot_y:0.0, grot_z:0.0, scale_x:1.0 },
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
    afterEach(() => { document.body.innerHTML = ''; });

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
    afterEach(() => { document.body.innerHTML = ''; });

    it('remove button sets dataUrl to null in store', () => {
        const { store, panel } = mkPanel();
        store.setBgImage({ dataUrl: 'data:image/png;base64,abc' });
        const removeBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent === '✕' && b.id !== 'overlays-close');
        removeBtn.click();
        expect(store.getState().bgImage.dataUrl).toBeNull();
        panel.dispose();
    });

    it('remove button creates undo-able command', () => {
        const { store, history, panel } = mkPanel();
        store.setBgImage({ dataUrl: 'data:image/png;base64,abc' });
        const removeBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent === '✕' && b.id !== 'overlays-close');
        removeBtn.click();
        expect(history.canUndo).toBe(true);
        history.undo(store);
        expect(store.getState().bgImage.dataUrl).toBe('data:image/png;base64,abc');
        panel.dispose();
    });

    it('remove button does nothing when dataUrl already null', () => {
        const { store, history, panel } = mkPanel();
        const removeBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent === '✕' && b.id !== 'overlays-close');
        removeBtn.click();
        expect(history.canUndo).toBe(false);
        panel.dispose();
    });
});

// ── crop frame ────────────────────────────────────────────────────────────────

describe('crop frame color input', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('input event updates store live (no history entry)', () => {
        const { store, history, panel } = mkPanel();
        const colorInput = document.querySelector('input[type="color"]');
        colorInput.value = '#ff0000';
        colorInput.dispatchEvent(new Event('input'));
        expect(store.getState().cropFrame.color).toBe('#ff0000');
        expect(history.canUndo).toBe(false);
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
    afterEach(() => { document.body.innerHTML = ''; });

    it('bgOpacity slider updates after store change', () => {
        const { store, panel } = mkPanel();
        store.setBgImage({ opacity: 0.2 });
        const sliders = document.querySelectorAll('input[type="range"]');
        expect(parseFloat(sliders[0].value)).toBeCloseTo(0.2);
        panel.dispose();
    });

    it('cropOpacity slider updates after store change', () => {
        const { store, panel } = mkPanel();
        store.setCropFrame({ opacity: 0.9 });
        const sliders = document.querySelectorAll('input[type="range"]');
        // sliders: [bgOpacity, bgZoom, cropOpacity]
        expect(parseFloat(sliders[2].value)).toBeCloseTo(0.9);
        panel.dispose();
    });
});

// ── dispose ───────────────────────────────────────────────────────────────────

describe('dispose', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('stops receiving store notifications after dispose', () => {
        const { store, panel } = mkPanel();
        panel.dispose();
        const spy = vi.spyOn(panel, '_syncFromStore');
        store.setBgImage({ opacity: 0.1 });
        expect(spy).not.toHaveBeenCalled();
    });
});
