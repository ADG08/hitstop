import { Button, type FrameInput, type Input } from "@hitstop/sim";

type Player = 0 | 1;

/**
 * Physical keys (KeyboardEvent.code), so the layout is the same on AZERTY and QWERTY:
 * player 1 uses ZQSD on AZERTY (WASD on QWERTY) with F and G, player 2 the arrows with numpad 1 and 2.
 */
export const KEY_BINDINGS: Readonly<Record<string, readonly [Player, number]>> = {
  KeyW: [0, Button.Up],
  KeyA: [0, Button.Left],
  KeyS: [0, Button.Down],
  KeyD: [0, Button.Right],
  KeyF: [0, Button.Light],
  KeyG: [0, Button.Heavy],
  ArrowUp: [1, Button.Up],
  ArrowLeft: [1, Button.Left],
  ArrowDown: [1, Button.Down],
  ArrowRight: [1, Button.Right],
  Numpad1: [1, Button.Light],
  Numpad2: [1, Button.Heavy],
};

/** The part of the Gamepad API used here, so it can be faked in tests. */
export interface GamepadLike {
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

const STICK_DEADZONE = 0.5;

/** Standard gamepad mapping: d-pad or left stick, A/X for light, B/Y for heavy. */
export function gamepadInput(pad: GamepadLike): Input {
  const pressed = (index: number) => pad.buttons[index]?.pressed === true;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  let input = 0;
  if (pressed(12) || y < -STICK_DEADZONE) input |= Button.Up;
  if (pressed(13) || y > STICK_DEADZONE) input |= Button.Down;
  if (pressed(14) || x < -STICK_DEADZONE) input |= Button.Left;
  if (pressed(15) || x > STICK_DEADZONE) input |= Button.Right;
  if (pressed(0) || pressed(2)) input |= Button.Light;
  if (pressed(1) || pressed(3)) input |= Button.Heavy;
  return input;
}

/**
 * Collects keyboard and gamepad state between simulation ticks. A key pressed and released
 * between two ticks is still seen by the next tick, so short taps are never lost.
 */
export class Controls {
  private readonly held: [Input, Input] = [0, 0];
  private readonly tapped: [Input, Input] = [0, 0];

  /** Returns false when the key is not a game key. */
  keyDown(code: string): boolean {
    const binding = KEY_BINDINGS[code];
    if (!binding) return false;
    const [player, bit] = binding;
    this.held[player] |= bit;
    this.tapped[player] |= bit;
    return true;
  }

  keyUp(code: string): boolean {
    const binding = KEY_BINDINGS[code];
    if (!binding) return false;
    const [player, bit] = binding;
    this.held[player] &= ~bit;
    return true;
  }

  /** Releases everything, e.g. when the window loses focus. */
  releaseAll(): void {
    this.held[0] = this.held[1] = 0;
    this.tapped[0] = this.tapped[1] = 0;
  }

  /** Input for the next tick. Connected gamepads go to player 1 then player 2, in order. */
  sample(gamepads: readonly (GamepadLike | null)[] = []): FrameInput {
    const pads = gamepads.filter((pad): pad is GamepadLike => pad !== null);
    const input = (player: Player): Input => {
      const pad = pads[player];
      return this.held[player] | this.tapped[player] | (pad ? gamepadInput(pad) : 0);
    };
    const frame: FrameInput = [input(0), input(1)];
    this.tapped[0] = this.tapped[1] = 0;
    return frame;
  }
}
