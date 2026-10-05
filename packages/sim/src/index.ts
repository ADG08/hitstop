export * from "./character.ts";
export * from "./input.ts";
export * from "./replay.ts";
export * from "./state.ts";
export { step } from "./step.ts";

/** Fixed simulation rate. Every frame advances the state by exactly 1/60 s. */
export const TICK_RATE = 60;
