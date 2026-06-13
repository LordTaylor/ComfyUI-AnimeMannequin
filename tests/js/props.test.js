import { describe, it, expect } from 'vitest';
import { PROP_LIBRARY, libraryEntry } from '../../static/src/props.js';

describe('PROP_LIBRARY manifest', () => {
    it('is an array', () => {
        expect(Array.isArray(PROP_LIBRARY)).toBe(true);
    });
    it('every entry has id, name, file, defaultBone, category', () => {
        for (const e of PROP_LIBRARY) {
            for (const k of ['id','name','file','defaultBone','category']) expect(e[k]).toBeTruthy();
        }
    });
    it('libraryEntry(id) finds by id; undefined if missing', () => {
        if (PROP_LIBRARY.length) expect(libraryEntry(PROP_LIBRARY[0].id)).toBe(PROP_LIBRARY[0]);
        expect(libraryEntry('nope-xyz')).toBeUndefined();
    });
});
