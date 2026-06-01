/**
 * Tests: AppStore specific setters — pre-Phase 3 fixes
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: { loc_z_base:0, loc_z:0.65, glob_z:0.2, loc_x:0.18, loc_y:0.3, glob_y:0.0,
                     rot_x:0.6, rot_z:-0.5, rot_y:0.5, grot_x:0.0, grot_y:0.0, grot_z:0.0, scale_x:1.0 },
}));
vi.mock('../../static/src/mannequin-model.js', () => ({
    defaultProportions: () => ({ head:1, bust:1, hips:1, waist:1, legs:1, arms:1 }),
}));

const { AppStore, defaultState } = await import('../../static/src/app-store.js');

const mkStore = () => new AppStore(defaultState());

const Q0 = { x:0, y:0, z:0, w:1 };
const Q1 = { x:0.1, y:0.2, z:0.3, w:0.9 };

// ── setPoseBone ───────────────────────────────────────────────────────────────

describe('setPoseBone', () => {
    it('adds bone to empty pose', () => {
        const s = mkStore();
        s.setPoseBone('head', Q1);
        expect(s.getState().pose.head).toEqual(Q1);
    });

    it('does not destroy other bones', () => {
        const s = mkStore();
        s.setPoseBone('head', Q1);
        s.setPoseBone('neck', Q0);
        expect(s.getState().pose.head).toEqual(Q1);
        expect(s.getState().pose.neck).toEqual(Q0);
    });

    it('overwrites existing bone', () => {
        const s = mkStore();
        s.setPoseBone('head', Q0);
        s.setPoseBone('head', Q1);
        expect(s.getState().pose.head).toEqual(Q1);
    });

    it('returned quat is a copy — mutation does not affect store', () => {
        const s = mkStore();
        s.setPoseBone('head', Q1);
        const q = s.getState().pose.head;
        q.x = 99;
        expect(s.getState().pose.head.x).toBe(Q1.x);
    });

    it('notifies subscribers', () => {
        const s = mkStore(); const spy = vi.fn();
        s.subscribe(spy);
        s.setPoseBone('head', Q1);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

// ── setPose ───────────────────────────────────────────────────────────────────

describe('setPose', () => {
    it('replaces full pose map', () => {
        const s = mkStore();
        s.setPoseBone('head', Q0);
        s.setPose({ neck: Q1 });
        expect(s.getState().pose).toEqual({ neck: Q1 });
        expect(s.getState().pose.head).toBeUndefined();
    });

    it('empty pose is valid', () => {
        const s = mkStore();
        s.setPoseBone('head', Q1);
        s.setPose({});
        expect(s.getState().pose).toEqual({});
    });
});

// ── setProportions ────────────────────────────────────────────────────────────

describe('setProportions', () => {
    it('patches single field, others unchanged', () => {
        const s = mkStore();
        s.setProportions({ bust: 1.5 });
        const p = s.getState().proportions;
        expect(p.bust).toBe(1.5);
        expect(p.head).toBe(1);
        expect(p.hips).toBe(1);
    });

    it('multiple fields at once', () => {
        const s = mkStore();
        s.setProportions({ bust: 1.5, legs: 0.9 });
        expect(s.getState().proportions.bust).toBe(1.5);
        expect(s.getState().proportions.legs).toBe(0.9);
        expect(s.getState().proportions.hips).toBe(1);
    });

    it('notifies subscribers', () => {
        const s = mkStore(); const spy = vi.fn();
        s.subscribe(spy);
        s.setProportions({ bust: 2 });
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

// ── setBustCfg ────────────────────────────────────────────────────────────────

describe('setBustCfg', () => {
    it('patches single key, others unchanged', () => {
        const s = mkStore();
        const orig = s.getState().bustCfg;
        s.setBustCfg({ loc_y: 0.9 });
        expect(s.getState().bustCfg.loc_y).toBe(0.9);
        expect(s.getState().bustCfg.loc_z).toBe(orig.loc_z);
    });

    it('successive patches accumulate', () => {
        const s = mkStore();
        s.setBustCfg({ loc_y: 0.9 });
        s.setBustCfg({ glob_z: 0.5 });
        expect(s.getState().bustCfg.loc_y).toBe(0.9);
        expect(s.getState().bustCfg.glob_z).toBe(0.5);
    });
});

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

// ── setOutputSize ─────────────────────────────────────────────────────────────

describe('setOutputSize', () => {
    it('sets both dimensions atomically', () => {
        const s = mkStore();
        s.setOutputSize(512, 768);
        expect(s.getState().outputWidth).toBe(512);
        expect(s.getState().outputHeight).toBe(768);
    });

    it('single notification for both fields', () => {
        const s = mkStore(); const spy = vi.fn();
        s.subscribe(spy);
        s.setOutputSize(512, 768);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
