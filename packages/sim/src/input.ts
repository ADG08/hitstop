/** One frame of input for one player: a bitmask of the buttons held during that frame. */
export type Input = number;

/** Inputs for both players on a given frame, indexed by player. */
export type FrameInput = readonly [Input, Input];

export const Button = {
  Up: 1 << 0,
  Down: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Light: 1 << 4,
  Heavy: 1 << 5,
} as const;

/** Number of past frames kept per player, used to read motion inputs. */
export const INPUT_HISTORY = 16;

/** A motion (e.g. down, down-forward, forward) must be completed within this many frames. */
export const MOTION_WINDOW = 12;

/** Direction bit pointing toward `facing` (1 = right, -1 = left). */
export function forwardBit(facing: number): number {
  return facing === 1 ? Button.Right : Button.Left;
}

export function backBit(facing: number): number {
  return facing === 1 ? Button.Left : Button.Right;
}

const ATTACK_BUTTONS = Button.Light | Button.Heavy;

/** Horizontal direction held: 1 = right, -1 = left, 0 = none or both. */
export function horizontalDirection(input: Input): number {
  const left = (input & Button.Left) !== 0;
  const right = (input & Button.Right) !== 0;
  if (left === right) return 0;
  return right ? 1 : -1;
}

/** Attack buttons pressed this frame (held now, not held on the previous frame). */
export function pressedAttacks(current: Input, previous: Input): number {
  return current & ~previous & ATTACK_BUTTONS;
}

type Step = "down" | "downToward" | "toward";

function matches(input: Input, step: Step, toward: number): boolean {
  const down = (input & Button.Down) !== 0;
  const horizontal = input & (Button.Left | Button.Right);
  if ((input & Button.Up) !== 0) return false;
  switch (step) {
    case "down":
      return down && horizontal === 0;
    case "downToward":
      return down && horizontal === toward;
    case "toward":
      return !down && horizontal === toward;
  }
}

/** Steps of a quarter circle, newest first (the history is read backward). */
const QUARTER_CIRCLE: readonly Step[] = ["toward", "downToward", "down"];

/**
 * True when the history contains down, down+toward, toward in that order within MOTION_WINDOW
 * frames, the last step being held on the current frame or the one before.
 * `history(0)` is the current frame, `history(1)` the previous one, and so on.
 */
export function hasQuarterCircle(history: (age: number) => Input, toward: number): boolean {
  let step = 0;
  for (let age = 0; age < MOTION_WINDOW && step < QUARTER_CIRCLE.length; age++) {
    const current = QUARTER_CIRCLE[step];
    if (current !== undefined && matches(history(age), current, toward)) {
      step++;
    } else if (step === 0 && age >= 1) {
      // The final direction must still be held (or just released) when the button is pressed.
      return false;
    }
  }
  return step === QUARTER_CIRCLE.length;
}
