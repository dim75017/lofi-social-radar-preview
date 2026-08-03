# Lofi Social Radar

Fondation du **Lofi Social & Community Intelligence OS**. Cette première tranche relie une tendance sourcée à une idée, un score explicable figé, une décision humaine et un brief créatif.

## Opérationnel

- Radar de tendances avec filtre, recherche et import manuel sourcé.
- Transformation d’une tendance en idée éditable.
- Score éditorial V1 explicable, versionné et conservé avant décision.
- Validation, refus motivé et restauration avec journal append-only.
- Brief créatif généré après validation, sans ajout automatique à la Roadmap.
- Persistance Cloudflare D1 et séparation visible des données de démonstration.
- Interface responsive calée sur le design des Radars YouTube et Spotify.

## Commandes

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm db:generate
```

## Garde-fous

- Aucun post, commentaire ou message officiel n’est publié automatiquement.
- Une donnée absente reste absente ; aucun chiffre n’est inventé pour remplir l’interface.
- Le score est une priorité éditoriale, pas une promesse de performance.
- Les exemples portent l’origine `demo` et restent identifiables dans toute l’interface.

La suite fonctionnelle et le modèle cible sont documentés dans `docs/ARCHITECTURE.md`. Les limites des connecteurs V1 figurent dans `docs/CONNECTORS.md`.
