// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom in this setup ships no localStorage — provide a minimal in-memory stub.
const _ls = (() => {
    let m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
        clear: () => { m = new Map(); },
    };
})();
globalThis.localStorage = _ls;

const { PoseLibrary } = await import('../../static/src/panels/pose-library.js');
const { POSE_PRESETS } = await import('../../static/src/pose-presets.js');

function setup() {
    document.body.innerHTML = '';
    const editor = { applyPosePreset: vi.fn(), getSceneData: () => ({}) };
    const renderer = { _renderer: { domElement: { toDataURL: () => '' } } };
    const lib = new PoseLibrary(editor, renderer);
    lib.mount(document.body);
    return { lib, editor };
}

describe('Poses panel — presets section', () => {
    beforeEach(() => { localStorage.clear(); });

    it('renders one row per built-in preset', () => {
        setup();
        const rows = document.querySelectorAll('[data-preset-id]');
        expect(rows.length).toBe(POSE_PRESETS.length);
    });

    it('clicking a preset row calls applyPosePreset with its id', () => {
        const { editor } = setup();
        const row = document.querySelector('[data-preset-id="t_pose"]');
        expect(row).toBeTruthy();
        row.click();
        expect(editor.applyPosePreset).toHaveBeenCalledWith('t_pose');
    });

    it('shows Basic and Combat group labels', () => {
        setup();
        const text = document.body.textContent;
        expect(text).toContain('Basic');
        expect(text).toContain('Combat');
    });
});
