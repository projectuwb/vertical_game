import { describe, expect, it } from 'vitest';
import { computeProjectionParams } from '../../src/render/camera.js';
import { DepthBucketList, project } from '../../src/render/projection.js';

describe('computeProjectionParams', () => {
  it('scales proportionally with canvas size (same framing at any resolution)', () => {
    const small = computeProjectionParams(390, 844);
    const large = computeProjectionParams(1170, 2532); // exactly 3x
    expect(large.unit / small.unit).toBeCloseTo(3, 6);
    expect(large.cx / small.cx).toBeCloseTo(3, 6);
    expect(large.horizonOffsetPx / small.horizonOffsetPx).toBeCloseTo(3, 6);
  });

  it('centres horizontally and places the horizon above vertical centre', () => {
    const params = computeProjectionParams(1080, 1920);
    expect(params.cx).toBeCloseTo(540, 6);
    expect(params.horizonOffsetPx).toBeLessThan(0); // shifts the vanishing point upward
  });
});

describe('project', () => {
  it('maps world-centre (x=0) to screen-centre (cx) regardless of depth', () => {
    const params = computeProjectionParams(1080, 1920);
    for (const z of [0, 10, 50, 150]) {
      const p = project(0, 4.2, z, params); // y doesn't affect screenX
      expect(p.screenX).toBeCloseTo(params.cx, 6);
    }
  });

  it('positive x projects to the right of centre, negative x to the left', () => {
    const params = computeProjectionParams(1080, 1920);
    const left = project(-2, 0, 10, params);
    const right = project(2, 0, 10, params);
    expect(left.screenX).toBeLessThan(params.cx);
    expect(right.screenX).toBeGreaterThan(params.cx);
  });

  it('farther objects (larger z) project smaller (lower scale) than nearer ones', () => {
    const params = computeProjectionParams(1080, 1920);
    const near = project(1, 0, 5, params);
    const far = project(1, 0, 100, params);
    expect(far.scale).toBeLessThan(near.scale);
  });

  it('two points at the same x/y/z with the same params produce identical screen coords (determinism)', () => {
    const params = computeProjectionParams(1080, 1920);
    const a = project(1.5, 0.2, 30, params);
    const b = project(1.5, 0.2, 30, params);
    expect(a).toEqual(b);
  });

  it('scale never diverges to infinity as depth approaches the camera plane (nearClip floor)', () => {
    const params = computeProjectionParams(1080, 1920);
    const atCamera = project(0, 0, -6.5, params); // depth = 0, would divide by zero without the clip
    expect(Number.isFinite(atCamera.scale)).toBe(true);
  });
});

describe('DepthBucketList', () => {
  it('visits items in strict far-to-near order (painter’s algorithm)', () => {
    const list = new DepthBucketList<string>(100, 16, 0, 200);
    const entries: [string, number][] = [
      ['a', 5],
      ['b', 190],
      ['c', 50],
      ['d', 0.1],
      ['e', 120],
    ];
    for (const [item, z] of entries) list.add(item, z);

    const visited: string[] = [];
    list.forEachBackToFront((item) => visited.push(item));

    expect(visited).toEqual(['b', 'e', 'c', 'a', 'd']);
  });

  it('clear() empties the list', () => {
    const list = new DepthBucketList<number>(10, 8, 0, 100);
    list.add(1, 10);
    list.add(2, 20);
    list.clear();

    const visited: number[] = [];
    list.forEachBackToFront((item) => visited.push(item));
    expect(visited).toEqual([]);
  });

  it('silently drops items beyond capacity rather than throwing or growing', () => {
    const list = new DepthBucketList<number>(2, 4, 0, 10);
    list.add(1, 1);
    list.add(2, 2);
    list.add(3, 3); // dropped

    const visited: number[] = [];
    list.forEachBackToFront((item) => visited.push(item));
    expect(visited.length).toBe(2);
  });

  it('items outside [zNear, zFar] are clamped into the first/last bucket, not lost', () => {
    const list = new DepthBucketList<string>(10, 4, 10, 20);
    list.add('behind-camera', -5);
    list.add('beyond-far-clip', 1000);

    const visited: string[] = [];
    list.forEachBackToFront((item) => visited.push(item));
    expect(visited.sort()).toEqual(['behind-camera', 'beyond-far-clip']);
  });

  it('handles repeated clear()/add() cycles without leaking stale items', () => {
    const list = new DepthBucketList<number>(4, 8, 0, 100);
    for (let cycle = 0; cycle < 50; cycle++) {
      list.clear();
      list.add(cycle, 10);
      const visited: number[] = [];
      list.forEachBackToFront((item) => visited.push(item));
      expect(visited).toEqual([cycle]);
    }
  });
});
