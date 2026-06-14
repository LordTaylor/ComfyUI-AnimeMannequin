import { describe, it, expect } from 'vitest';
import { solveTwoBone, sub, len } from '../../static/src/ik-solver.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('solveTwoBone', () => {
    it('reachable target: end lands on target, bone lengths preserved', () => {
        const r = solveTwoBone({ root: [0, 0, 0], target: [1, -1, 0], lenA: 1, lenB: 1, pole: [1, 0, 0] });
        expect(r.reachable).toBe(true);
        expect(close(r.endClamped[0], 1)).toBe(true);
        expect(close(r.endClamped[1], -1)).toBe(true);
        expect(close(len(sub(r.mid, [0, 0, 0])), 1, 1e-5)).toBe(true);
        expect(close(len(sub(r.endClamped, r.mid)), 1, 1e-5)).toBe(true);
    });

    it('pole controls bend side', () => {
        const a = solveTwoBone({ root: [0, 0, 0], target: [0, -2 + 0.001, 0], lenA: 1.2, lenB: 1.2, pole: [1, 0, 0] });
        const b = solveTwoBone({ root: [0, 0, 0], target: [0, -2 + 0.001, 0], lenA: 1.2, lenB: 1.2, pole: [-1, 0, 0] });
        expect(a.mid[0]).toBeGreaterThan(0);
        expect(b.mid[0]).toBeLessThan(0);
    });

    it('out of reach: straightens and clamps, reachable=false', () => {
        const r = solveTwoBone({ root: [0, 0, 0], target: [10, 0, 0], lenA: 1, lenB: 1, pole: [0, 1, 0] });
        expect(r.reachable).toBe(false);
        expect(close(r.endClamped[0], 2, 1e-3)).toBe(true);
        expect(close(r.mid[0], 1, 1e-3)).toBe(true);
        expect(close(r.mid[1], 0, 1e-3)).toBe(true);
    });
});
