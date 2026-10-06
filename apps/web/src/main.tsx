import { createRoot } from "react-dom/client";
import { Game } from "./game.ts";
import { readSettings } from "./settings.ts";
import { App } from "./ui/App.tsx";
import "./debug-api.ts";

const settings = readSettings(location.search);
const canvasHost = document.querySelector<HTMLElement>("#game");
const debugPanel = document.querySelector<HTMLPreElement>("#debug");
const uiRoot = document.querySelector<HTMLElement>("#ui");
if (!canvasHost || !debugPanel || !uiRoot) throw new Error("index.html is missing an element");

const game = await Game.create(canvasHost, debugPanel, settings.bot);
createRoot(uiRoot).render(<App game={game} settings={settings} />);
