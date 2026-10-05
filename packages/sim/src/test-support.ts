// Helpers shared by the tests, exported as "@hitstop/sim/testing" (not part of the game API).
import { STAGE_WIDTH } from "./character.ts";
import { Button, type FrameInput, type Input } from "./input.ts";
import { Result, type State } from "./state.ts";

/** Mulberry32: small seeded PRNG built on exact integer operations. Returns uint32 values. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const DIRECTIONS: readonly Input[] = [
  0,
  Button.Up,
  Button.Down,
  Button.Left,
  Button.Right,
  Button.Up | Button.Left,
  Button.Up | Button.Right,
  Button.Down | Button.Left,
  Button.Down | Button.Right,
];

/** Plausible inputs for one player: held directions, random presses and quarter-circle motions. */
function* playerInputs(random: () => number): Generator<Input, never> {
  while (true) {
    if (random() % 10 < 3) {
      const side = random() % 2 === 0 ? Button.Right : Button.Left;
      const attack = random() % 2 === 0 ? Button.Light : Button.Heavy;
      for (let i = 1 + (random() % 2); i > 0; i--) yield Button.Down;
      for (let i = 1 + (random() % 2); i > 0; i--) yield Button.Down | side;
      yield side;
      yield side | attack;
    } else {
      const direction = DIRECTIONS[random() % DIRECTIONS.length] ?? 0;
      for (let i = 1 + (random() % 15); i > 0; i--) {
        const press = random() % 6 === 0 ? (random() % 2 === 0 ? Button.Light : Button.Heavy) : 0;
        yield direction | press;
      }
    }
  }
}

export function randomInputs(seed: number, frames: number): FrameInput[] {
  const random = seededRandom(seed);
  const p1 = playerInputs(random);
  const p2 = playerInputs(random);
  return Array.from({ length: frames }, () => [p1.next().value, p2.next().value] as const);
}

function mirrorInput(input: Input): Input {
  const left = input & Button.Left ? Button.Right : 0;
  const right = input & Button.Right ? Button.Left : 0;
  return (input & ~(Button.Left | Button.Right)) | left | right;
}

export function mirrorFrameInput([a, b]: FrameInput): FrameInput {
  return [mirrorInput(a), mirrorInput(b)];
}

export function swapFrameInput([a, b]: FrameInput): FrameInput {
  return [b, a];
}

/**
 * The same state seen in a mirror: positions, speeds, facings and left/right inputs flipped.
 * `0 - v` rather than `-v` avoids -0, which would make equal states look different in diffs.
 */
export function mirrorState(state: State): State {
  const fighter = (f: State["fighters"][number]) => ({
    ...f,
    x: STAGE_WIDTH - f.x,
    vx: 0 - f.vx,
    facing: 0 - f.facing,
    jumpDirection: 0 - f.jumpDirection,
  });
  const projectile = (p: State["projectiles"][number]) =>
    p.active === 1 ? { ...p, x: STAGE_WIDTH - p.x, vx: 0 - p.vx } : { ...p };
  return {
    ...state,
    fighters: [fighter(state.fighters[0]), fighter(state.fighters[1])],
    projectiles: [projectile(state.projectiles[0]), projectile(state.projectiles[1])],
    inputHistory: [state.inputHistory[0].map(mirrorInput), state.inputHistory[1].map(mirrorInput)],
  };
}

/** The same state with player 1 and player 2 exchanged. */
export function swapState(state: State): State {
  const result =
    state.result === Result.Player1Wins
      ? Result.Player2Wins
      : state.result === Result.Player2Wins
        ? Result.Player1Wins
        : state.result;
  return {
    ...state,
    result,
    wins: [state.wins[1], state.wins[0]],
    fighters: [{ ...state.fighters[1] }, { ...state.fighters[0] }],
    projectiles: [{ ...state.projectiles[1] }, { ...state.projectiles[0] }],
    inputHistory: [[...state.inputHistory[1]], [...state.inputHistory[0]]],
  };
}
