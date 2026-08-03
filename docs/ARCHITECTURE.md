# Architecture fonctionnelle

## Tranche V1 livrée

```text
4 comptes officiels Lofi Girl
  → collecte publique par plateforme
  → normalisation des posts et métriques
  → upsert du contenu + nouveau snapshot horodaté
  → score relatif dans la plateforme
  → top posts + rapprochement cross-platform
  → enseignements éditoriaux descriptifs
```

Le premier écran ne part plus de tendances fictives. Il interroge Instagram, X, TikTok et YouTube, puis affiche les publications réellement exposées par chaque source publique et les limites de couverture éventuelles.

## Données persistées

- `social_accounts` : compte officiel, URL, couverture, statut, abonnés visibles et fraîcheur.
- `social_posts` : contenu normalisé, format, date, miniature, dernières métriques, score et explication.
- `post_metric_snapshots` : relevés successifs immuables des vues et interactions.
- `scan_runs` : tentative par source, durée, résultat, compteurs et erreur éventuelle.

Les anciennes tables `trends`, `ideas`, `briefs` et `decision_events` restent disponibles pour la phase d’idéation, mais aucune donnée de démonstration n’est plus injectée ou affichée.

## Score de performance

Le score ne compare jamais les volumes bruts de deux plateformes différentes. Il classe un post dans sa cohorte de plateforme à partir des dimensions réellement présentes :

- niveau de vues ajusté à l’âge du post quand sa date est publique ;
- interactions rapportées aux vues lorsqu’elles coexistent ;
- interactions ajustées à l’âge quand les vues manquent mais que la date existe ;
- conversation et partages lorsque disponibles.

Une métrique absente est retirée du calcul et les poids restants sont renormalisés. Elle ne vaut jamais zéro. L’explication conserve la taille de l’échantillon, les métriques disponibles et leurs percentiles.

## Analyse éditoriale

Le moteur rapproche les accroches normalisées afin de repérer le même créatif sur plusieurs plateformes. Les enseignements restent descriptifs : type de contenu dominant dans le top, réseau porteur, écart entre déclinaisons et taille de l’échantillon. Aucune causalité n’est inventée.

## Suite

1. Accès propriétaires Instagram et TikTok pour la portée, les partages, les sauvegardes et le watch time.
2. YouTube Analytics pour rétention, durée moyenne, sources de trafic et abonnés gagnés.
3. X API avec plafond de dépense explicite pour une chronologie plus profonde.
4. Relevés rapprochés à 1 h, 6 h, 24 h, 72 h et 7 jours.
5. Transformation manuelle d’un enseignement validé en idée puis en brief.
