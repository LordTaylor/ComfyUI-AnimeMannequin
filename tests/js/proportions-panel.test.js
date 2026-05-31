// @vitest-environment jsdom

/**
 * Tests: ProportionsPanel → Store → CommandHistory — Phase 5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: { baseFwd:0, fwdPush:0.65, droop:0.2, latX:0.18, latY:0.3,
                     rotFwd:0.6, rotLat:-0.5, rotY:0.5, xSqueeze:1.0 },
}));
vi.mock('../../static/src/mannequin-model.js', () => ({
    defaultProportions: () => ({ head:1, bust:1, hips:1, waist:1, legs:1, arms:1 }),
}));

const { AppStore, defaultState } = await import('../../static/src/app-store.js');
const { CommandHistory }         = await import('../../static/src/commands.js');
const { ProportionsPanel }       = await import('../../static/src/proportions-panel.js');

function mkPanel() {
    const store   = new AppStore(defaultState('F'));
    const history = new CommandHistory(10);
    const panel   = new ProportionsPanel(store, history);
    const div     = document.createElement('div');
    panel.mount(div);
    return { store, history, panel, div };
}

// ── mount ─────────────────────────────────────────────────────────────────────

describe('mount', () => {
    it('renders sliders for all proportion keys', () => {
        const { div } = mkPanel();
        const sliders = div.querySelectorAll('input[type=range]');
        expect(sliders.length).toBeGreaterThanOrEqual(6);
    });

    it('bust slider initially visible for gender F', () => {
        const { panel } = mkPanel();
        const bustRow = panel._sliderEls['bust']?.row;
        expect(bustRow?.style.display).not.toBe('none');
    });
});

// ── store subscription ────────────────────────────────────────────────────────

describe('store subscription', () => {
    it('slider syncs when store proportions change externally', () => {
        const { store, panel } = mkPanel();
        store.setProportions({ bust: 1.8 });
        expect(panel._sliderEls['bust'].slider.value).toBe('1.8');
    });

    it('gender change from store hides bust slider for M', () => {
        const { store, panel } = mkPanel();
        store.setState({ gender: 'M' });
        const bustRow = panel._sliderEls['bust'].row;
        expect(bustRow.style.display).toBe('none');
    });

    it('gender change from store shows bust slider back for F', () => {
        const { store, panel } = mkPanel();
        store.setState({ gender: 'M' });
        store.setState({ gender: 'F' });
        const bustRow = panel._sliderEls['bust'].row;
        expect(bustRow.style.display).not.toBe('none');
    });
});

// ── _commitProportions ────────────────────────────────────────────────────────

describe('_commitProportions', () => {
    it('creates undo-able command in history', () => {
        const { panel, history } = mkPanel();
        panel._commitProportions({ bust: 1.5 });
        expect(history.canUndo).toBe(true);
    });

    it('store proportions update after commit', () => {
        const { panel, store } = mkPanel();
        panel._commitProportions({ bust: 1.5 });
        expect(store.getState().proportions.bust).toBe(1.5);
    });

    it('undo reverts proportion change', () => {
        const { panel, store, history } = mkPanel();
        panel._commitProportions({ bust: 1.5 });
        history.undo(store);
        expect(store.getState().proportions.bust).toBe(1);
    });

    it('does not destroy other proportions', () => {
        const { panel, store } = mkPanel();
        panel._commitProportions({ bust: 1.5 });
        expect(store.getState().proportions.head).toBe(1);
        expect(store.getState().proportions.legs).toBe(1);
    });
});

// ── live input vs commit ──────────────────────────────────────────────────────

describe('live input event vs commit', () => {
    it('input event updates store but does NOT add to history', () => {
        const { panel, store, history } = mkPanel();
        const slider = panel._sliderEls['bust'].slider;
        slider.value = '1.5';
        slider.dispatchEvent(new Event('input'));
        expect(store.getState().proportions.bust).toBe(1.5);
        expect(history.canUndo).toBe(false);   // no command yet
    });

    it('change event commits to history (undo-able)', () => {
        const { panel, history } = mkPanel();
        const slider = panel._sliderEls['bust'].slider;
        slider.value = '1.5';
        slider.dispatchEvent(new Event('change'));
        expect(history.canUndo).toBe(true);
    });

    it('ground plane button changes store without command', () => {
        const { div, store, history } = mkPanel();
        // Ground button is the one with text 'OFF' (groundEnabled starts false)
        const groundBtn = [...div.querySelectorAll('button')].find(b => b.textContent === 'OFF');
        expect(groundBtn).toBeDefined();
        groundBtn.click();
        expect(store.getState().groundEnabled).toBe(true);
        expect(history.canUndo).toBe(false);   // ground toggle is not command-based
    });
});

// ── dispose ───────────────────────────────────────────────────────────────────

describe('dispose', () => {
    it('stops receiving store notifications after dispose', () => {
        const { store, panel } = mkPanel();
        panel.dispose();
        const spy = vi.spyOn(panel, '_syncFromStore');
        store.setProportions({ bust: 2 });
        expect(spy).not.toHaveBeenCalled();
    });
});

// ── toggle ────────────────────────────────────────────────────────────────────

describe('toggle', () => {
    it('starts hidden', () => {
        const { panel } = mkPanel();
        expect(panel.isVisible()).toBe(false);
    });

    it('shows and hides', () => {
        const { panel } = mkPanel();
        panel.toggle(); expect(panel.isVisible()).toBe(true);
        panel.toggle(); expect(panel.isVisible()).toBe(false);
    });
});
