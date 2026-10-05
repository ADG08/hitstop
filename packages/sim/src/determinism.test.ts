import { describe, expect, it } from "vitest";
import type { FrameInput } from "./input.ts";
import { replay } from "./replay.ts";
import {
  ACTION_COUNT,
  createInitialState,
  deserialize,
  hashState,
  Result,
  type State,
  serialize,
} from "./state.ts";
import { step } from "./step.ts";
import { randomInputs } from "./test-support.ts";

const FRAMES = 100_000;
const SEED = 20261005;

interface Run {
  hashes: Uint32Array;
  /** Actions reached by each player at least once. */
  visited: [Set<number>, Set<number>];
  results: number[];
}

/** Plays consecutive matches: a new match starts as soon as one ends. */
function playMatches(inputs: readonly FrameInput[], onFrame?: (state: State) => void): Run {
  const hashes = new Uint32Array(inputs.length);
  const visited: Run["visited"] = [new Set(), new Set()];
  const results: number[] = [];
  let state = createInitialState();
  for (const [i, input] of inputs.entries()) {
    state = step(state, input);
    hashes[i] = hashState(state);
    visited[0].add(state.fighters[0].action);
    visited[1].add(state.fighters[1].action);
    onFrame?.(state);
    if (state.result !== Result.Ongoing) {
      results.push(state.result);
      state = createInitialState();
    }
  }
  return { hashes, visited, results };
}

function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

function allValuesAreInt32(value: unknown): boolean {
  if (typeof value === "number") return isInt32(value);
  if (Array.isArray(value)) return value.every(allValuesAreInt32);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).every(allValuesAreInt32);
  }
  return false;
}

/** Folds a list of hashes into one, to pin a whole run in a single value. */
function combine(hashes: Uint32Array): number {
  let hash = 0x811c9dc5;
  for (const value of hashes) hash = Math.imul(hash ^ value, 0x01000193);
  return hash >>> 0;
}

describe("determinism", () => {
  const inputs = randomInputs(SEED, FRAMES);
  const first = playMatches(inputs);

  it("gives identical hashes on every frame for two runs of 100 000 random frames", () => {
    const second = playMatches(inputs);
    expect(second.hashes).toEqual(first.hashes);
  });

  it("covers every action for both players and finishes matches", () => {
    expect(first.visited[0].size).toBe(ACTION_COUNT);
    expect(first.visited[1].size).toBe(ACTION_COUNT);
    expect(first.results.length).toBeGreaterThan(0);
  });

  it("matches the reference hash of the run (same value on every machine)", () => {
    // Changes when the rules or the frame data change: update with `pnpm test -- -u` on purpose.
    expect(combine(first.hashes)).toMatchInlineSnapshot(`3808570942`);
  });

  it("detects a single changed input from the frame it happens", () => {
    const changed = inputs.slice();
    const frame = 100; // early enough that no match can be over yet
    const [a, b] = inputs[frame] ?? [0, 0];
    changed[frame] = [a ^ 1, b];
    const { hashes } = replay(changed);
    const reference = replay(inputs).hashes;
    expect(hashes.subarray(0, frame)).toEqual(reference.subarray(0, frame));
    expect(hashes[frame]).not.toBe(reference[frame]);
  });

  it("resumes identically from a serialized snapshot (rollback)", () => {
    const before = inputs.slice(0, 5000);
    const after = inputs.slice(5000, 7000);
    const { state } = replay(before);
    const snapshot = serialize(state);
    const original = replay(after, state).hashes;
    const restored = replay(after, deserialize(snapshot)).hashes;
    expect(restored).toEqual(original);
  });

  it("keeps every value an int32 and serializes the whole state", () => {
    let checked = 0;
    playMatches(inputs.slice(0, 20_000), (state) => {
      if (state.frame % 97 !== 0) return;
      expect(allValuesAreInt32(state)).toBe(true);
      expect(deserialize(serialize(state))).toEqual(state);
      checked++;
    });
    expect(checked).toBeGreaterThan(100);
  });

  it("never modifies the state it is given", () => {
    const state = replay(inputs.slice(0, 3000)).state;
    const before = serialize(state);
    step(state, [0b111111, 0b111111]);
    expect(serialize(state)).toEqual(before);
  });
});
