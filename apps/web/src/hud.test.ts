import { createInitialState, Phase, Result, ROUND_FRAMES } from "@hitstop/sim";
import { describe, expect, it } from "vitest";
import { announcement, timerSeconds } from "./hud.ts";

describe("hud", () => {
  it("shows 99 at the start and rounds the timer up", () => {
    const state = createInitialState();
    expect(timerSeconds(state)).toBe(99);
    state.timer = 1;
    expect(timerSeconds(state)).toBe(1);
    state.timer = 0;
    expect(timerSeconds(state)).toBe(0);
    expect(ROUND_FRAMES).toBe(99 * 60);
  });

  it("announces the round, the end of the round and the winner", () => {
    const state = createInitialState();
    expect(announcement(state).title).toBe("Manche 1");
    state.phase = Phase.Fight;
    expect(announcement(state).title).toBe("");
    state.phase = Phase.RoundOver;
    state.fighters[1].health = 0;
    expect(announcement(state).title).toBe("KO");
    state.fighters[1].health = 10;
    expect(announcement(state).title).toBe("Temps écoulé");
    state.phase = Phase.MatchOver;
    state.result = Result.Player2Wins;
    expect(announcement(state)).toEqual({ title: "Victoire J2", subtitle: "Entrée pour rejouer" });
  });
});
