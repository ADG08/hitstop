import { Phase } from "@hitstop/sim";
import { useEffect, useRef, useState } from "react";
import type { Game } from "../game.ts";
import { LocalMatch } from "../local-match.ts";
import { OnlineMatch, type OnlineStatus } from "../online-match.ts";
import { roomLink, type Settings } from "../settings.ts";

type Screen = "home" | "local" | "online";

const ERRORS: Record<string, string> = {
  "room-not-found": "Ce salon n'existe pas (ou plus).",
  "room-full": "Ce salon est déjà complet.",
  "version-mismatch": "Version du jeu différente de celle du serveur : recharge la page.",
  "bad-token": "Impossible de reprendre cette partie.",
  "opponent-left": "L'adversaire n'est pas revenu : partie terminée.",
  "bad-message": "Erreur de communication avec le serveur.",
};

function serverUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/ws`;
}

export function App({ game, settings }: { game: Game; settings: Settings }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [status, setStatus] = useState<OnlineStatus>();
  const [code, setCode] = useState("");
  const online = useRef<OnlineMatch | undefined>(undefined);

  const goOnline = (start: (match: OnlineMatch) => void) => {
    const match = new OnlineMatch(serverUrl(), settings.link, () => setStatus(match.status()));
    online.current = match;
    game.source = match;
    window.hitstop = game.debugApi({
      online: () => match.status(),
      dropConnection: () => match.dropConnection(),
    });
    setScreen("online");
    start(match);
    setStatus(match.status());
  };

  const goLocal = () => {
    game.source = new LocalMatch();
    setScreen("local");
  };

  const goHome = () => {
    online.current?.leave();
    online.current = undefined;
    game.source = undefined;
    setStatus(undefined);
    setScreen("home");
  };

  // A shared link opens the room directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once, on arrival
  useEffect(() => {
    window.hitstop = game.debugApi({ online: () => undefined, dropConnection: () => {} });
    if (settings.room) goOnline((match) => match.join(settings.room as string));
  }, []);

  // In a local match, Enter starts a new one once it is over.
  useEffect(() => {
    if (screen !== "local") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Enter" && game.source?.state.phase === Phase.MatchOver)
        game.source = new LocalMatch();
      if (event.code === "Escape") goHome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (screen === "home") {
    return (
      <div className="menu">
        <h1>Hitstop</h1>
        <button type="button" onClick={goLocal}>
          Jouer à deux sur ce clavier
        </button>
        <button type="button" onClick={() => goOnline((match) => match.create())}>
          Créer un salon en ligne
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length === 4) goOnline((match) => match.join(code));
          }}
        >
          <input
            aria-label="Code du salon"
            placeholder="CODE"
            maxLength={4}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button type="submit" disabled={code.length !== 4}>
            Rejoindre
          </button>
        </form>
      </div>
    );
  }

  if (screen === "local") {
    return <div className="hint">Échap : menu</div>;
  }

  return <OnlinePanel status={status} onLeave={goHome} />;
}

function OnlinePanel({
  status,
  onLeave,
}: {
  status: OnlineStatus | undefined;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!status) return null;

  if (status.error) {
    return (
      <div className="menu">
        <p className="error">{ERRORS[status.error] ?? status.error}</p>
        <button type="button" onClick={onLeave}>
          Retour au menu
        </button>
      </div>
    );
  }

  if (!status.started) {
    const link = status.room ? roomLink(location, status.room) : "";
    return (
      <div className="menu">
        {status.room ? (
          <>
            <p>Code du salon</p>
            <p className="code" data-testid="room-code">
              {status.room}
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? "Lien copié" : "Copier le lien d'invitation"}
            </button>
            <p className="muted">En attente d'un adversaire…</p>
          </>
        ) : (
          <p className="muted">Connexion au serveur…</p>
        )}
        <button type="button" onClick={onLeave}>
          Annuler
        </button>
      </div>
    );
  }

  const banner =
    status.connection === "reconnecting"
      ? "Connexion perdue, reconnexion…"
      : status.connection === "closed"
        ? "Déconnecté du serveur."
        : !status.opponentConnected
          ? "L'adversaire s'est déconnecté, en attente de son retour…"
          : undefined;

  return (
    <>
      {banner && <div className="banner">{banner}</div>}
      {status.end && (
        <div className="result">
          <p data-testid="match-check">
            {status.end.verified
              ? "Partie vérifiée : état identique au serveur"
              : "Écart détecté avec le serveur !"}
          </p>
          <button type="button" onClick={onLeave}>
            Retour au menu
          </button>
        </div>
      )}
    </>
  );
}
