import { Button } from "@hitstop/sim";
import { describe, expect, it } from "vitest";
import { Controls, type GamepadLike, gamepadInput } from "./controls.ts";

function pad(pressed: number[] = [], axes: number[] = [0, 0]): GamepadLike {
  return {
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes,
  };
}

describe("Controls", () => {
  it("maps physical keys to each player", () => {
    const controls = new Controls();
    controls.keyDown("KeyD");
    controls.keyDown("KeyF");
    controls.keyDown("ArrowLeft");
    controls.keyDown("Numpad2");
    expect(controls.sample()).toEqual([Button.Right | Button.Light, Button.Left | Button.Heavy]);
  });

  it("keeps held keys until released", () => {
    const controls = new Controls();
    controls.keyDown("KeyW");
    expect(controls.sample()).toEqual([Button.Up, 0]);
    expect(controls.sample()).toEqual([Button.Up, 0]);
    controls.keyUp("KeyW");
    expect(controls.sample()).toEqual([0, 0]);
  });

  it("does not lose a tap shorter than one frame", () => {
    const controls = new Controls();
    controls.keyDown("KeyF");
    controls.keyUp("KeyF");
    expect(controls.sample()).toEqual([Button.Light, 0]);
    expect(controls.sample()).toEqual([0, 0]);
  });

  it("ignores other keys and releases everything on blur", () => {
    const controls = new Controls();
    expect(controls.keyDown("KeyP")).toBe(false);
    controls.keyDown("ArrowUp");
    controls.releaseAll();
    expect(controls.sample()).toEqual([0, 0]);
  });

  it("gives gamepads to player 1 then player 2, skipping empty slots", () => {
    const controls = new Controls();
    expect(controls.sample([null, pad([0]), pad([1])])).toEqual([Button.Light, Button.Heavy]);
  });
});

describe("gamepadInput", () => {
  it("reads the d-pad, the left stick past its deadzone and the face buttons", () => {
    expect(gamepadInput(pad([12, 15]))).toBe(Button.Up | Button.Right);
    expect(gamepadInput(pad([], [-0.9, 0.9]))).toBe(Button.Left | Button.Down);
    expect(gamepadInput(pad([], [0.3, -0.3]))).toBe(0);
    expect(gamepadInput(pad([2, 3]))).toBe(Button.Light | Button.Heavy);
  });
});
