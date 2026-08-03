# Lofi Social Radar

Première base fonctionnelle du **Social & Community Intelligence OS** de Lofi Girl : le radar collecte les publications visibles sur les comptes officiels Instagram, X, TikTok et YouTube, conserve leurs relevés et met en avant les contenus qui surperforment.

## Opérationnel

- Comptes officiels `@lofigirl` préconfigurés, dont la chaîne YouTube stable `UCSJ4gkVC6NrvII8umztf0Ow`.
- Collecte publique réelle : flux YouTube, intégrations publiques Instagram et TikTok, page publique X.
- Historique D1 des posts, métriques, scans et erreurs par source.
- Upsert idempotent : rescanner met à jour le post et ajoute un nouveau relevé sans le dupliquer.
- Classement normalisé à l’intérieur de chaque plateforme, ajusté à l’âge du contenu quand la date est publique.
- Analyse descriptive des meilleurs formats et détection des mêmes créatifs sur plusieurs réseaux.
- Interface responsive alignée sur le design des Radars YouTube et Spotify.

## Couverture V1

- **YouTube** : publications récentes, dates, miniatures et vues exposées par le flux public ; les likes ne sont pas relabellisés depuis l’ancien champ de notation.
- **Instagram** : jusqu’à six publications, dates, likes et commentaires quand Meta expose le bloc riche de l’intégration ; sinon la source reste explicitement limitée, sans métrique inventée.
- **X** : cinq publications publiques récentes, vues, likes, réponses, reposts, citations et favoris lorsque visibles.
- **TikTok** : sélection de vidéos exposée par l’intégration publique, avec vues ; la chronologie et les interactions complètes nécessitent ensuite la connexion officielle du compte.

Chaque source affiche sa couverture et ses limites. Une métrique absente reste `null` et n’est jamais remplacée par zéro.

## Commandes

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm db:generate
```

## Étape suivante

Brancher les accès propriétaires Meta, TikTok, X et YouTube Analytics afin d’ajouter portée, watch time, rétention, partages et sauvegardes, puis automatiser les relevés rapprochés à 1 h, 6 h, 24 h, 72 h et 7 jours.
