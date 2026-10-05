import { Action, Phase, replay } from "@hitstop/sim";
import { Application } from "pixi.js";
import { Controls } from "./controls.ts";
import "./debug-api.ts";
import { FixedStepClock } from "./loop.ts";
import { Renderer, SCREEN_HEIGHT, SCREEN_WIDTH } from "./renderer.ts";
import { Session } from "./session.ts";

const ACTION_NAMES = Object.fromEntries(Object.entries(Action).map(([name, id]) => [id, name]));
const PHASE_NAMES = Object.fromEntries(Object.entries(Phase).map(([name, id]) => [id, name]));

const controls = new Controls();
const clock = new FixedStepClock();
const renderer = new Renderer();
let session = new Session();
let showDebug = false;
const debugPanel =
  document.querySelector<HTMLPreElement>("#debug") ?? document.createElement("pre");

window.hitstop = {
  frame: () => session.state.frame,
  drawnFrame: () => renderer.drawnFrame,
  inputs: () => session.inputs.map(([a, b]) => [a, b] as const),
  hashes: () => session.hashes.slice(),
  replay: (inputs) => Array.from(replay(inputs).hashes),
};

window.addEventListener("keydown", (event) => {
  if (event.code === "F2") {
    showDebug = !showDebug;
    debugPanel.hidden = !showDebug;
    event.preventDefault();
  } else if (event.code === "Enter" && session.state.phase === Phase.MatchOver) {
    session = new Session();
  } else if (controls.keyDown(event.code)) {
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => {
  if (controls.keyUp(event.code)) event.preventDefault();
});
window.addEventListener("blur", () => controls.releaseAll());
document.addEventListener("visibilitychange", () => clock.reset());

function updateDebugPanel(): void {
  const { state, hashes } = session;
  const fighter = (p: 0 | 1) => {
    const f = state.fighters[p];
    return `J${p + 1}  ${ACTION_NAMES[f.action]} (${f.actionFrame})  vie ${f.health}  hitstop ${f.hitstop}`;
  };
  debugPanel.textContent = [
    `image ${state.frame}  ${PHASE_NAMES[state.phase]}  manche ${state.round}`,
    `empreinte ${(hashes.at(-1) ?? 0).toString(16).padStart(8, "0")}`,
    fighter(0),
    fighter(1),
  ].join("\n");
}

const app = new Application();
await app.init({
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  background: "#14161c",
  antialias: true,
  autoStart: false,
});
document.querySelector("#app")?.appendChild(app.canvas);
app.stage.addChild(renderer.root);

/** The Gamepad API is missing in some browsers (e.g. WebKit without gamepad support). */
function readGamepads(): readonly (Gamepad | null)[] {
  return typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
}

/** One display frame: run the simulation ticks due, then draw the latest state. */
function frame(now: number): void {
  const ticks = clock.advance(now);
  for (let i = 0; i < ticks; i++) session.tick(controls.sample(readGamepads()));
  renderer.draw(session.state, showDebug);
  if (showDebug) updateDebugPanel();
  app.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
