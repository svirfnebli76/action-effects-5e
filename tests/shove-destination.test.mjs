import test from "node:test";
import assert from "node:assert/strict";

class TokenDocument {}
globalThis.foundry = { documents: { TokenDocument } };

const { DisplacementDirectionService } = await import("../scripts/displacement/displacement-direction-service.js");
const { MovementObstructionService } = await import("../scripts/displacement/movement-obstruction-service.js");
const { DisplacementPlanner } = await import("../scripts/displacement/displacement-planner.js");
const { DisplacementDestinationOverlay } = await import("../scripts/displacement/displacement-destination-overlay.js");
const { DISPLACEMENT_TYPES, DISPLACEMENT_DIRECTION_CONSTRAINTS } = await import("../scripts/core/constants.js");

function makeFixture(size = 1) {
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: [] };
  const makeToken = (id, x, y) => {
    const token = new TokenDocument();
    Object.assign(token, {
      id,
      uuid: `Scene.scene.Token.${id}`,
      x,
      y,
      width: size,
      height: size,
      elevation: 0,
      parent: scene,
      name: id
    });
    token.object = { constrainMovementPath: () => [null, false] };
    return token;
  };

  const target = makeToken("target", 2300, 2600);
  const source = makeToken("source", 2300, 2600 + ((size + 1) * 100));
  scene.tokens = [source, target];
  const relativeRelationships = { resolve: () => ({ relationship: "nonhostile", reasonCode: "test" }) };
  const planner = new DisplacementPlanner({
    directions: new DisplacementDirectionService(),
    obstructions: new MovementObstructionService({ relativeRelationships })
  });
  return { scene, source, target, planner };
}

function offset(candidate, target) {
  return [
    Math.round((candidate.requestedDestination.x - target.x) / 100),
    Math.round((candidate.requestedDestination.y - target.y) / 100)
  ];
}

test("10-foot AWAY Push exposes three 5-foot stops and five 10-foot endpoints", () => {
  const { scene, source, target, planner } = makeFixture(1);
  const plan = planner.buildCandidates({
    scene,
    sourceToken: source,
    targetToken: target,
    type: DISPLACEMENT_TYPES.PUSH,
    directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY,
    distance: 10
  });

  const actual = plan.candidates.map((candidate) => offset(candidate, target).join(","));
  const expected = ["-1,-1", "0,-1", "1,-1", "-2,-2", "-1,-2", "0,-2", "1,-2", "2,-2"];
  assert.equal(actual.length, 8);
  assert.deepEqual(new Set(actual), new Set(expected));
  assert.equal(plan.candidates.filter((candidate) => candidate.requestedDistance === 5).length, 3);
  assert.equal(plan.candidates.filter((candidate) => candidate.requestedDistance === 10).length, 5);

  const leftIntermediate = plan.candidates.find((candidate) => offset(candidate, target).join(",") === "-1,-2");
  const rightIntermediate = plan.candidates.find((candidate) => offset(candidate, target).join(",") === "1,-2");
  for (const candidate of [leftIntermediate, rightIntermediate]) {
    assert.ok(candidate);
    assert.ok(candidate.routeAlternativeCount >= 2);
    assert.equal(candidate.directionPath.length, 2);
    assert.equal(new Set(candidate.directionPath).size, 2);
  }
});

test("AWAY direction fan remains anchored to original Source-to-Target geometry", () => {
  const { scene, source, target, planner } = makeFixture(1);
  const plan = planner.buildCandidates({
    scene,
    sourceToken: source,
    targetToken: target,
    type: DISPLACEMENT_TYPES.PUSH,
    directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY,
    distance: 10
  });
  assert.deepEqual(new Set(plan.reference.allowedDirectionKeys), new Set(["NW", "N", "NE"]));
  for (const candidate of plan.candidates) {
    assert.ok(candidate.directionPath.every((key) => ["NW", "N", "NE"].includes(key)));
  }
});

test("Large and Huge-style Shove destinations use separated bright-green edge handles", () => {
  const overlay = new DisplacementDestinationOverlay();
  for (const size of [2, 3]) {
    const { scene, source, target, planner } = makeFixture(size);
    const plan = planner.buildCandidates({
      scene,
      sourceToken: source,
      targetToken: target,
      type: DISPLACEMENT_TYPES.PUSH,
      directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY,
      distance: 10
    });
    const layout = overlay.describeLayout({ candidates: plan.candidates, targetToken: target, gridSize: 100 });
    const entries = layout.entries.filter((entry) => entry.selectable);
    assert.equal(entries.length, 8);
    assert.ok(entries.every((entry) => entry.compactSelection && entry.handle));
    assert.ok(entries.every((entry) => entry.handle.color === layout.largeTokenSelectorColor));

    for (let i = 0; i < entries.length; i += 1) {
      const a = entries[i].handle;
      const edgeDistances = [
        Math.abs(a.centerX - entries[i].footprint.x),
        Math.abs(a.centerX - (entries[i].footprint.x + entries[i].footprint.width)),
        Math.abs(a.centerY - entries[i].footprint.y),
        Math.abs(a.centerY - (entries[i].footprint.y + entries[i].footprint.height))
      ];
      assert.ok(Math.min(...edgeDistances) <= 50.01);

      for (let j = i + 1; j < entries.length; j += 1) {
        const b = entries[j].handle;
        const overlap = !(
          a.x + a.width <= b.x + 0.01
          || b.x + b.width <= a.x + 0.01
          || a.y + a.height <= b.y + 0.01
          || b.y + b.height <= a.y + 0.01
        );
        assert.equal(overlap, false);
      }
    }
  }
});
