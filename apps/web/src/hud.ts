import { Phase, Result, ROUND_INTRO_FRAMES, type State, TICK_RATE } from "@hitstop/sim";

/** Last part of the round intro, when "Combat !" replaces the round number. */
const FIGHT_CALL_FRAMES = 30;

export interface Announcement {
  title: string;
  subtitle: string;
}

/** Seconds shown on the timer: rounded up, so 0 only appears when time is really over. */
export function timerSeconds(state: State): number {
  return Math.ceil(state.timer / TICK_RATE);
}

/** Big centered text for the current phase of the match. */
export function announcement(state: State): Announcement {
  switch (state.phase) {
    case Phase.Intro:
      return state.phaseFrame < ROUND_INTRO_FRAMES - FIGHT_CALL_FRAMES
        ? { title: `Manche ${state.round}`, subtitle: "" }
        : { title: "Combat !", subtitle: "" };
    case Phase.Fight:
      return { title: "", subtitle: "" };
    case Phase.RoundOver: {
      const [f0, f1] = state.fighters;
      if (f0.health === 0 && f1.health === 0) return { title: "Double KO", subtitle: "" };
      if (f0.health === 0 || f1.health === 0) return { title: "KO", subtitle: "" };
      return { title: "Temps écoulé", subtitle: "" };
    }
    case Phase.MatchOver: {
      const title =
        state.result === Result.Player1Wins
          ? "Victoire J1"
          : state.result === Result.Player2Wins
            ? "Victoire J2"
            : "Match nul";
      return { title, subtitle: "Entrée pour rejouer" };
    }
  }
}
