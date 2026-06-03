/**
 * Tests: AppStore — Phase 1
 *
 * Vitest + pure-JS, no DOM, no Three.js.
 * Mockujemy importy z mannequin-renderer.js i mannequin-model.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: {
        loc_z_base: 0, loc_z: 0.65, glob_z: 0.2,
        loc_x: 0.18, loc_y: 0.3,
        rot_x: 0.6, rot_z: -0.5, rot_y: 0.5,
        scale_x: 1.0,
    },
}));

vi.mock('../../static/src/mannequin-model.js', () => ({
    defaultProportions: () => ({ head: 1, bust: 1, hips: 1, waist: 1, legs: 1, arms: 1 }),
}));

// ── Import po mockach ─────────────────────────────────────────────────────────

const { AppStore, defaultState } = await import('../../static/src/app-store.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('defaultState', () => {
    it('returns correct defaults for gender F', () => {
        const s = defaultState('F');
        expect(s.gender).toBe('F');
        expect(s.outputWidth).toBe(768);
        expect(s.outputHeight).toBe(1024);
        expect(s.jointColorMode).toBe('openpose');
        expect(s.groundEnabled).toBe(false);
        expect(s.proportions).toEqual({ head: 1, bust: 1, hips: 1, waist: 1, legs: 1, arms: 1 });
    });

    it('accepts gender M', () => {
        expect(defaultState('M').gender).toBe('M');
    });
});

describe('AppStore', () => {
    let store;
    beforeEach(() => { store = new AppStore(defaultState()); });

    it('getState() returns current state', () => {
        expect(store.getState().gender).toBe('F');
    });

    it('getState() returns a copy — mutating it does not affect store', () => {
        const s = store.getState();
        s.gender = 'X';
        expect(store.getState().gender).toBe('F');
    });

    it('setState() merges partial update', () => {
        store.setState({ gender: 'M' });
        expect(store.getState().gender).toBe('M');
        expect(store.getState().outputWidth).toBe(768); // other fields untouched
    });

    it('replaceState() with a partial/legacy object does not break getState()', () => {
        // Regression: a restored state missing `pose` used to throw in getState()
        // via Object.entries(undefined). replaceState now normalises against defaults.
        store.replaceState({ gender: 'M' });          // no pose/proportions/bgImage…
        expect(() => store.getState()).not.toThrow();
        const s = store.getState();
        expect(s.gender).toBe('M');
        expect(s.pose).toEqual({});                   // backfilled
        expect(s.bgImage).toBeTruthy();               // backfilled
        expect(s.outputWidth).toBe(768);              // backfilled from defaults
    });

    it('replaceState() preserves provided nested fields', () => {
        store.replaceState({ gender: 'F', outputWidth: 512, pose: { neck: { rotation: [0,0,0,1] } } });
        const s = store.getState();
        expect(s.outputWidth).toBe(512);
        expect(s.pose.neck.rotation).toEqual([0,0,0,1]);
    });

    it('setState() is shallow merge — nested objects replaced, not deep-merged', () => {
        store.setState({ proportions: { bust: 2 } });
        // shallow merge: the old proportions object is replaced entirely
        expect(store.getState().proportions).toEqual({ bust: 2 });
    });

    it('replaceState() replaces full state', () => {
        const newState = { ...defaultState('M'), outputWidth: 512 };
        store.replaceState(newState);
        expect(store.getState().gender).toBe('M');
        expect(store.getState().outputWidth).toBe(512);
    });

    it('subscribe() listener is called on setState', () => {
        const spy = vi.fn();
        store.subscribe(spy);
        store.setState({ gender: 'M' });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ gender: 'M' }));
    });

    it('subscribe() listener is called on replaceState', () => {
        const spy = vi.fn();
        store.subscribe(spy);
        store.replaceState(defaultState('M'));
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('subscribe() returns unsubscribe fn that stops notifications', () => {
        const spy = vi.fn();
        const unsub = store.subscribe(spy);
        unsub();
        store.setState({ gender: 'M' });
        expect(spy).not.toHaveBeenCalled();
    });

    it('multiple subscribers all receive notification', () => {
        const s1 = vi.fn(), s2 = vi.fn();
        store.subscribe(s1);
        store.subscribe(s2);
        store.setState({ outputWidth: 512 });
        expect(s1).toHaveBeenCalledTimes(1);
        expect(s2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribing one does not affect others', () => {
        const s1 = vi.fn(), s2 = vi.fn();
        const unsub1 = store.subscribe(s1);
        store.subscribe(s2);
        unsub1();
        store.setState({ outputWidth: 512 });
        expect(s1).not.toHaveBeenCalled();
        expect(s2).toHaveBeenCalledTimes(1);
    });
});
