import test from "node:test";
import assert from "node:assert/strict";
import { Crosshair3dRangeService } from "../scripts/crosshairs3d/range-service.js";
import { freeLineRangeBoundary, freeLineWithinRange } from "../scripts/crosshairs3d/free-line-placement.js";
const range = new Crosshair3dRangeService();
const volume = { minX:0,maxX:5,minY:0,maxY:5,bottom:0,top:5 };
test("3D grid allows equal-cost XY and XYZ diagonals", () => {
  const origin = {x:0,y:0,z:0};
  assert.equal(range.distanceBetweenPoints(origin,{x:150,y:150,z:150},"grid"),150);
  assert.equal(range.distanceBetweenPoints(origin,{x:155,y:150,z:150},"grid"),155);
  assert.equal(range.distanceBetweenPoints(origin,{x:30,y:40,z:0}),50);
});
test("source occupied-volume corner retains diagonal plus height checks", () => {
  assert.equal(range.distanceFromVolumeCornerToPoint(volume,{x:155,y:155,z:155},"grid"),150);
  assert.equal(range.distanceFromVolumeCornerToPoint(volume,{x:160,y:155,z:155},"grid"),155);
  assert.equal(range.distanceFromVolumeToPoint(volume,{x:155,y:155,z:155},"grid"),150);
});
test("grid range outline forms a rectangle at legal elevations", () => {
  assert.deepEqual(freeLineRangeBoundary(volume,10,15,"grid"),[
    {x:-10,y:-10,z:15},{x:15,y:-10,z:15},{x:15,y:15,z:15},{x:-10,y:15,z:15}
  ]);
  assert.deepEqual(freeLineRangeBoundary(volume,10,16,"grid"),[]);
});
test("free-line endpoint policy honors grid metric", () => {
  const state={point:{x:12.5,y:12.5,z:10},yaw:0,length:5};
  assert.equal(freeLineWithinRange(state,volume,10,"endpoints",range,"grid"),true);
  assert.equal(freeLineWithinRange(state,volume,7.49,"endpoints",range,"grid"),false);
});
test("Euclidean remains selectable and invalid metric rejected", () => {
  assert.ok(range.distanceBetweenPoints({x:0,y:0,z:0},{x:10,y:10,z:10},"euclidean")>10);
  assert.equal(range.distanceBetweenPoints({x:0,y:0,z:0},{x:10,y:10,z:10},"grid"),10);
  assert.throws(()=>range.distanceBetweenPoints({x:0,y:0,z:0},{x:1,y:1,z:1},"invalid"),/Unsupported/);
});