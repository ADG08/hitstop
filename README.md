# Hitstop

Jeu de combat 2D en ligne, jouable dans le navigateur, avec une IA entraînée par auto-jeu.

**Statut :** en développement. Fondations du dépôt en place (M0).

## Prérequis

- Node.js 22 (≥ 22.12)
- pnpm 12
- Docker (pour PostgreSQL et Redis)

## Démarrer

```bash
pnpm install
pnpm test          # tests
pnpm typecheck     # vérification des types
pnpm check         # lint et formatage (Biome)
pnpm db:up         # PostgreSQL + pgvector et Redis en local
pnpm db:down       # arrêt
```

## Structure

```
packages/sim       simulation déterministe, partagée par le client, le serveur et l'entraînement
packages/protocol  types partagés (messages réseau)
infra/             Docker Compose
```

## Licence

[MIT](LICENSE)
