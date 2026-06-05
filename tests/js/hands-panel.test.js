// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HandsPanel } from '../../static/src/panels/hands-panel.js';

describe('HandsPanel', () => {
    let editor, panel;
    beforeEach(() => {
        document.body.innerHTML = '';
        editor = { applyFingerPreset: vi.fn() };
        panel = new HandsPanel(editor);
        panel.mount(document.body);
    });

    it('mounts hidden and toggles visibility', () => {
        expect(panel.isVisible()).toBe(false);
        panel.show(); expect(panel.isVisible()).toBe(true);
        panel.hide(); expect(panel.isVisible()).toBe(false);
    });

    it('renders one button per preset', () => {
        const btns = document.querySelectorAll('[data-finger-preset]');
        expect(btns.length).toBe(6);
    });

    it('clicking a preset button applies it via the editor', () => {
        const btn = document.querySelector('[data-finger-preset="Pięść"]');
        btn.click();
        expect(editor.applyFingerPreset).toHaveBeenCalledTimes(1);
        const arg = editor.applyFingerPreset.mock.calls[0][0];
        expect(arg).toHaveProperty('index_L');
    });
});
