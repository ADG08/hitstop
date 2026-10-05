import { describe, expect, it } from "vitest";
import {
  BODY_HALF_WIDTH,
  BODY_HEIGHT,
  HEAVY,
  KNOCKDOWN_FRAMES,
  LIGHT,
  MAX_HEALTH,
  PROJECTILE,
  PROJECTILE_SPEED,
  PROJECTILE_THROW,
  RUSH,
  STAGE_WIDTH,
  SUBPIXELS,
  totalFrames,
} from "./character.ts";
import { Button, type FrameInput } from "./input.ts";
import { ROUND_FRAMES, ROUND_INTRO_FRAMES, ROUND_OVER_FRAMES } from "./rules.ts";
import { Action, createInitialState, Phase, Result, type State, serialize } from "./state.ts";
import { step } from "./step.ts";

const { Up, Down, Left, Right, Light, Heavy } = Button;
const NONE: FrameInput = [0, 0];

/** Fight already started, with the players `distance` pixels apart, centered. */
function setup(distance: number): State {
  const state = createInitialState();
  state.phase = Phase.Fight;
  const center = STAGE_WIDTH / 2;
  state.fighters[0].x = center - (distance * SUBPIXELS) / 2;
  state.fighters[1].x = center + (distance * SUBPIXELS) / 2;
  return state;
}

/** Plays the inputs and returns the state after each frame. */
function play(state: State, inputs: readonly FrameInput[]): State[] {
  const states: State[] = [];
  let current = state;
  for (const input of inputs) {
    current = step(current, input);
    states.push(current);
  }
  return states;
}

function repeat(input: FrameInput, frames: number): FrameInput[] {
  return Array.from({ length: frames }, () => input);
}

function last(states: readonly State[]): State {
  const state = states.at(-1);
  if (!state) throw new Error("no frame played");
  return state;
}

/** Index of the first state matching the predicate, or -1. */
function firstFrame(states: readonly State[], predicate: (state: State) => boolean): number {
  return states.findIndex(predicate);
}

const isActionable = (action: number) =>
  action === Action.Idle || action === Action.WalkForward || action === Action.WalkBack;

describe("normal attacks", () => {
  it("light hits on its 4th frame, not before", () => {
    const states = play(setup(100), [[Light, 0], ...repeat(NONE, 3)]);
    expect(states[2]?.fighters[1].action).toBe(Action.Idle);
    const hit = last(states);
    expect(hit.fighters[1].action).toBe(Action.Hitstun);
    expect(hit.fighters[1].health).toBe(MAX_HEALTH - LIGHT.damage);
  });

  it("freezes both fighters during hitstop", () => {
    const states = play(setup(100), [[Light, 0], ...repeat(NONE, 3 + LIGHT.hitstop + 1)]);
    const hit = states[3];
    expect(hit?.fighters[0].hitstop).toBe(LIGHT.hitstop);
    expect(hit?.fighters[1].hitstop).toBe(LIGHT.hitstop);
    const frozen = states[3 + LIGHT.hitstop];
    expect(frozen?.fighters[0].actionFrame).toBe(LIGHT.startup - 1);
    expect(frozen?.fighters[1].actionFrame).toBe(0);
    expect(last(states).fighters[0].actionFrame).toBe(LIGHT.startup);
  });

  it("gives the frame advantage implied by the frame data, on hit and on block", () => {
    for (const blocking of [false, true]) {
      const defenderInput = blocking ? Right : 0;
      const states = play(setup(100), [[Light, defenderInput], ...repeat([0, defenderInput], 60)]);
      const contact = firstFrame(states, (s) => s.fighters[1].hitstop > 0);
      const attackerFree = firstFrame(
        states,
        (s) => s.frame > contact + 1 && isActionable(s.fighters[0].action),
      );
      const defenderFree = firstFrame(
        states,
        (s) => s.frame > contact + 1 && isActionable(s.fighters[1].action),
      );
      const stun = blocking ? LIGHT.blockstun : LIGHT.hitstun;
      const attackerRemaining = totalFrames(LIGHT) - (LIGHT.startup - 1);
      expect(defenderFree - attackerFree).toBe(stun - attackerRemaining);
    }
  });

  it("heavy is unsafe on block: the defender recovers first", () => {
    const states = play(setup(100), [[Heavy, Right], ...repeat([0, Right], 60)]);
    const contact = firstFrame(states, (s) => s.fighters[1].hitstop > 0);
    expect(states[contact]?.fighters[1].action).toBe(Action.Blockstun);
    const attackerFree = firstFrame(
      states,
      (s) => s.frame > contact + 1 && isActionable(s.fighters[0].action),
    );
    const defenderFree = firstFrame(
      states,
      (s) => s.frame > contact + 1 && isActionable(s.fighters[1].action),
    );
    expect(defenderFree).toBeLessThan(attackerFree);
    expect(HEAVY.blockstun).toBeLessThan(HEAVY.active - 1 + HEAVY.recovery);
  });

  it("trades when both players hit on the same frame", () => {
    const hit = last(play(setup(100), [[Light, Light], ...repeat(NONE, 3)]));
    for (const fighter of hit.fighters) {
      expect(fighter.action).toBe(Action.Hitstun);
      expect(fighter.health).toBe(MAX_HEALTH - LIGHT.damage);
    }
  });
});

describe("guard", () => {
  it("blocks when holding away from the attacker: no damage, blockstun", () => {
    const hit = last(play(setup(100), [[Light, Right], ...repeat([0, Right], 3)]));
    expect(hit.fighters[1].action).toBe(Action.Blockstun);
    expect(hit.fighters[1].stun).toBe(LIGHT.blockstun);
    expect(hit.fighters[1].health).toBe(MAX_HEALTH);
  });

  it("does not block when holding toward the attacker", () => {
    const hit = last(play(setup(100), [[Light, Left], ...repeat([0, Left], 3)]));
    expect(hit.fighters[1].action).toBe(Action.Hitstun);
  });

  it("cannot block in the air: an airborne fighter is knocked down", () => {
    const state = setup(100);
    Object.assign(state.fighters[1], { action: Action.Airborne, y: 50 * SUBPIXELS, vy: 0 });
    const states = play(state, [[Light, Right], ...repeat([0, Right], 120)]);
    expect(states[3]?.fighters[1].action).toBe(Action.AirFall);
    const knockdown = firstFrame(states, (s) => s.fighters[1].action === Action.Knockdown);
    expect(knockdown).toBeGreaterThan(3);
    const up = firstFrame(
      states,
      (s) => s.frame > knockdown + 1 && isActionable(s.fighters[1].action),
    );
    expect(up - knockdown).toBe(KNOCKDOWN_FRAMES);
  });
});

describe("motion inputs", () => {
  const quarterCircleForward: FrameInput[] = [
    [Down, 0],
    [Down | Right, 0],
    [Right | Light, 0],
  ];
  const quarterCircleBack: FrameInput[] = [
    [Down, 0],
    [Down | Left, 0],
    [Left | Heavy, 0],
  ];

  it("down, down-forward, forward + attack throws a projectile on its 13th frame", () => {
    const states = play(setup(800), [
      ...quarterCircleForward,
      ...repeat(NONE, PROJECTILE_THROW.startup),
    ]);
    expect(states[2]?.fighters[0].action).toBe(Action.ProjectileThrow);
    expect(states[2 + PROJECTILE_THROW.startup - 2]?.projectiles[0].active).toBe(0);
    const spawned = states[2 + PROJECTILE_THROW.startup - 1]?.projectiles[0];
    expect(spawned?.active).toBe(1);
    expect(spawned?.vx).toBe(PROJECTILE_SPEED);
  });

  it("the projectile hits the opponent at range and only the defender freezes", () => {
    const states = play(setup(400), [...quarterCircleForward, ...repeat(NONE, 80)]);
    const contact = firstFrame(states, (s) => s.fighters[1].action === Action.Hitstun);
    expect(contact).toBeGreaterThan(0);
    const hit = states[contact];
    expect(hit?.fighters[1].health).toBe(MAX_HEALTH - PROJECTILE.damage);
    expect(hit?.fighters[1].hitstop).toBe(PROJECTILE.hitstop);
    expect(hit?.fighters[0].hitstop).toBe(0);
    expect(hit?.projectiles[0].active).toBe(0);
  });

  it("allows one projectile at a time: the motion gives a normal attack instead", () => {
    const throwFrames = totalFrames(PROJECTILE_THROW);
    const states = play(setup(800), [
      ...quarterCircleForward,
      ...repeat(NONE, throwFrames),
      ...quarterCircleForward,
    ]);
    const after = last(states);
    expect(after.projectiles[0].active).toBe(1);
    expect(after.fighters[0].action).toBe(Action.Light);
  });

  it("down, down-back, back + attack starts the rush, which travels and knocks down", () => {
    const states = play(setup(250), [...quarterCircleBack, ...repeat(NONE, 100)]);
    expect(states[2]?.fighters[0].action).toBe(Action.Rush);
    const contact = firstFrame(states, (s) => s.fighters[1].action === Action.AirFall);
    expect(contact).toBeGreaterThan(2 + RUSH.startup - 1);
    expect(states[contact]?.fighters[1].health).toBe(MAX_HEALTH - RUSH.damage);
    expect(firstFrame(states, (s) => s.fighters[1].action === Action.Knockdown)).toBeGreaterThan(
      contact,
    );
  });

  it("ignores the motion when forward was released before the press", () => {
    const states = play(setup(800), [
      [Down, 0],
      [Down | Right, 0],
      [Right, 0],
      ...repeat(NONE, 3),
      [Light, 0],
    ]);
    expect(last(states).fighters[0].action).toBe(Action.Light);
  });
});

describe("movement", () => {
  it("jumps after 3 frames of prejump, peaks below head height and lands", () => {
    const states = play(setup(400), [[Up, 0], ...repeat(NONE, 70)]);
    expect(states[2]?.fighters[0].action).toBe(Action.Prejump);
    expect(states[3]?.fighters[0].action).toBe(Action.Airborne);
    const peak = Math.max(...states.map((s) => s.fighters[0].y));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(BODY_HEIGHT);
    expect(firstFrame(states, (s) => s.fighters[0].action === Action.Landing)).toBeGreaterThan(3);
    expect(last(states).fighters[0].action).toBe(Action.Idle);
  });

  it("allows a single air attack per jump", () => {
    const states = play(setup(800), [
      [Up, 0],
      ...repeat(NONE, 5),
      [Light, 0],
      ...repeat(NONE, 25),
      [Light, 0],
    ]);
    expect(states[6]?.fighters[0].action).toBe(Action.JumpAttack);
    expect(last(states).fighters[0].action).toBe(Action.Airborne);
  });

  it("never lets fighters overlap or leave the stage", () => {
    const states = play(setup(300), [
      ...repeat([Right, Left], 200),
      ...repeat([Left, Left], 400),
      ...repeat([Right, Right], 400),
    ]);
    for (const { fighters } of states) {
      expect(Math.abs(fighters[0].x - fighters[1].x)).toBeGreaterThanOrEqual(2 * BODY_HALF_WIDTH);
      for (const fighter of fighters) {
        expect(fighter.x).toBeGreaterThanOrEqual(BODY_HALF_WIDTH);
        expect(fighter.x).toBeLessThanOrEqual(STAGE_WIDTH - BODY_HALF_WIDTH);
      }
    }
  });
});

describe("rounds", () => {
  it("ignores inputs during the round intro, then starts the fight", () => {
    const states = play(createInitialState(), repeat([Right, 0], ROUND_INTRO_FRAMES + 5));
    const start = createInitialState().fighters[0].x;
    expect(states[ROUND_INTRO_FRAMES - 2]?.fighters[0].x).toBe(start);
    expect(states[ROUND_INTRO_FRAMES - 1]?.phase).toBe(Phase.Fight);
    expect(last(states).fighters[0].x).toBeGreaterThan(start);
  });

  it("gives the round to the player still standing after a KO, then starts the next one", () => {
    const state = setup(100);
    state.fighters[1].health = LIGHT.damage;
    const states = play(state, [[Light, 0], ...repeat(NONE, 3 + ROUND_OVER_FRAMES)]);
    const ko = states[3];
    expect(ko?.phase).toBe(Phase.RoundOver);
    expect(ko?.fighters[1].action).toBe(Action.Ko);
    expect(ko?.wins).toEqual([1, 0]);
    const next = last(states);
    expect(next.phase).toBe(Phase.Intro);
    expect(next.round).toBe(2);
    expect(next.timer).toBe(ROUND_FRAMES);
    expect(next.fighters.map((f) => f.health)).toEqual([MAX_HEALTH, MAX_HEALTH]);
    expect(next.result).toBe(Result.Ongoing);
  });

  it("gives the round to the healthier player when time runs out, to both on a tie", () => {
    for (const [health0, health1, wins] of [
      [500, 400, [1, 0]],
      [400, 500, [0, 1]],
      [500, 500, [1, 1]],
    ] as const) {
      const state = setup(400);
      state.timer = 1;
      state.fighters[0].health = health0;
      state.fighters[1].health = health1;
      const [after] = play(state, [NONE]);
      expect(after?.phase).toBe(Phase.RoundOver);
      expect(after?.wins).toEqual(wins);
    }
  });

  it("ends the match at two rounds won and freezes it", () => {
    const state = setup(100);
    state.wins = [1, 1];
    state.fighters[1].health = LIGHT.damage;
    const states = play(state, [
      [Light, 0],
      ...repeat(NONE, 3 + ROUND_OVER_FRAMES),
      [Light | Right, Left | Heavy],
    ]);
    const over = states.at(-2);
    expect(over?.phase).toBe(Phase.MatchOver);
    expect(over?.result).toBe(Result.Player1Wins);
    expect(over?.wins).toEqual([2, 1]);
    const after = last(states);
    expect(serialize(after).subarray(1)).toEqual(over && serialize(over).subarray(1));
  });

  it("disables hits once the round is over", () => {
    const state = setup(100);
    state.phase = Phase.RoundOver;
    Object.assign(state.fighters[0], { action: Action.Light, actionFrame: LIGHT.startup - 2 });
    const [active] = play(state, [NONE]);
    expect(active?.fighters[0].actionFrame).toBe(LIGHT.startup - 1);
    expect(active?.fighters[1].health).toBe(MAX_HEALTH);
  });
});
