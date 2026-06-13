// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PropsPanel } from '../../static/src/panels/props-panel.js';

describe('PropsPanel', () => {
    let api, panel;
    beforeEach(() => {
        document.body.innerHTML = '';
        api = {
            addLibraryProp: vi.fn(),
            addUpload: vi.fn(),
            removeProp: vi.fn(),
            selectProp: vi.fn(),
            listProps: () => ([{ id:'p1', ref:'hat_01', bone:'head', missing:false },
                               { id:'p2', ref:'sword.glb', bone:'hand_R', missing:true }]),
        };
        panel = new PropsPanel(api);
        panel.mount(document.body);
    });
    it('mounts hidden; show/hide/toggle work', () => {
        expect(panel.isVisible()).toBe(false);
        panel.show(); expect(panel.isVisible()).toBe(true);
        panel.hide(); expect(panel.isVisible()).toBe(false);
    });
    it('refresh renders one row per current prop with its id', () => {
        panel.refresh();
        expect(document.querySelector('[data-prop-id="p1"]')).toBeTruthy();
        expect(document.querySelector('[data-prop-id="p2"]')).toBeTruthy();
    });
    it('a missing prop shows a missing/re-upload marker', () => {
        panel.refresh();
        const row = document.querySelector('[data-prop-id="p2"]');
        expect(row.textContent.toLowerCase()).toMatch(/missing|re-?upload|wczytaj/);
    });
    it('clicking remove on a row calls api.removeProp(id)', () => {
        panel.refresh();
        const btn = document.querySelector('[data-remove-prop="p1"]');
        btn.click();
        expect(api.removeProp).toHaveBeenCalledWith('p1');
    });
    it('uploading a file calls api.addUpload(filename, arrayBuffer)', async () => {
        const input = document.querySelector('[data-prop-upload]');
        expect(input).toBeTruthy();
        const file = new File([new Uint8Array([1,2,3])], 'gun.glb');
        // jsdom File.arrayBuffer exists; dispatch change
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await Promise.resolve(); await Promise.resolve();
        expect(api.addUpload).toHaveBeenCalled();
        expect(api.addUpload.mock.calls[0][0]).toBe('gun.glb');
    });
});
