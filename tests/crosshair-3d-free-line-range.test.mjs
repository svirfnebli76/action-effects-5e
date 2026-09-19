import test from "node:test";
import assert from "node:assert/strict";
import { freeLineEndpoints, freeLineWithinRange, freeLineRangeBoundary, constrainFreeLineChange } from "../scripts/crosshairs3d/free-line-placement.js";
import { Crosshair3dRangeService } from "../scripts/crosshairs3d/range-service.js";
const range = new Crosshair3dRangeService();
const volume = { minX: 0, maxX: 5, minY: 0, maxY: 5, bottom: 0, top: 5 };
test("free Line boundary follows the same source-volume XYZ metric as validation", () => {
  for (const z of [-5, 0, 5, 15, 25]) {
    const points = freeLineRangeBoundary(volume, 20, z);
    assert.equal(points.length, 132);
    for (const point of points) assert.ok(Math.abs(range.distanceFromVolumeToPoint(volume, point)-20) < 1e-8);
  }
  assert.deepEqual(freeLineRangeBoundary(volume, 20, 26), []);
});
test("free Line rotation stops at range boundary without translating its midpoint", () => {
  const from = { point: { x: 2.5, y: 17.5, z: 0 }, yaw: 0, length: 20 };
  const valid = state => freeLineWithinRange(state, volume, 15, "endpoints", range);
  assert.ok(valid(from));
  const result = constrainFreeLineChange(from, { ...from, yaw: 90 }, valid, 90);
  assert.ok(result.yaw > 0 && result.yaw < 90);
  assert.deepEqual(result.point, from.point);
  assert.ok(valid(result));
  assert.ok(!valid({ ...result, yaw: result.yaw+0.001 }));
});
test("free Line designated origin remains the first endpoint through a half-turn", () => {
  const state = { point: { x: 15, y: 0, z: 0 }, yaw: 0, length: 20 };
  assert.ok(freeLineWithinRange(state, volume, 5, "origin", range));
  assert.ok(!freeLineWithinRange({ ...state, yaw: 180 }, volume, 5, "origin", range));
  const ends = freeLineEndpoints({ ...state, yaw: 180 });
  assert.ok(Math.abs(ends[0].x-25) < 1e-8);
});
