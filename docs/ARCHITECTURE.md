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
- `data/comment-opportunities/feed.json` : file publique de vidéos à commenter, URLs natives, relevés métriques sourcés, score éditorial et trois réactions courtes par vidéo. Une valeur absente reste `null` et le statut « Accélère » exige au moins deux observations comparables.
- `data/audience-history.json` : relevés horodatés des followers des quatre comptes, précision de chaque compteur et taux d’engagement dérivé. Les jalons historiques et relevés quotidiens sont conservés sans interpolation.
- `data/audio-trends/feed.json` : watchlist d’au moins 50 sons distincts, actuellement structurée pour 41 TikTok, 6 Instagram et 3 YouTube. Chaque entrée conserve sa page audio native, une vidéo de référence distincte et son angle Lofi Girl. Le refresh tourne deux fois par jour et publie uniquement si les 50 identités, les 50 URLs audio, les 50 vidéos de référence, toutes les miniatures TikTok et toutes les lectures Instagram sont vérifiées. Un compteur public indisponible — notamment le volume global des reprises YouTube — reste vide : la croissance est toujours dérivée de deux relevés comparables et n’est jamais inventée.

Les anciennes tables `trends`, `ideas`, `briefs` et `decision_events` restent disponibles pour la phase d’idéation, mais aucune donnée de démonstration n’est plus injectée ou affichée.

## Score de performance

Le score ne compare jamais les volumes bruts de deux plateformes différentes. Il classe un post dans sa cohorte de plateforme à partir des dimensions réellement présentes :

- niveau de vues ajusté à l’âge du post quand sa date est publique ;
- interactions rapportées aux vues lorsqu’elles coexistent ;
- interactions ajustées à l’âge quand les vues manquent mais que la date existe ;
- conversation et partages lorsque disponibles.

Une métrique absente est retirée du calcul et les poids restants sont renormalisés. Elle ne vaut jamais zéro. L’explication conserve la taille de l’échantillon, les métriques disponibles et leurs percentiles.

## Audience et engagement

Le Tableau de bord applique un filtre commun à l’évolution des followers et au taux d’engagement sur YouTube, Instagram, TikTok et X. Les périodes proposées sont 30 jours (vue par défaut), 3 mois, 6 mois, 1 an et All time.

Pour chaque période, le taux d’engagement correspond à la moyenne des likes et commentaires de tous les posts mesurables publiés dans la fenêtre, divisée par le dernier nombre de followers réellement observé. Les commentaires YouTube publiés par Lofi Girl sont exclus de l’échantillon. Les partages et sauvegardes ne sont pas mélangés au calcul, car ils ne sont pas disponibles de façon comparable sur les quatre plateformes. L’évolution des followers s’appuie exclusivement sur les observations réelles disponibles dans la période sélectionnée, sans interpolation ni repli artificiel vers une autre période.

Un relevé quotidien ajoute uniquement les compteurs réellement récupérés. Si une source échoue, son dernier point valide est conservé ; aucune valeur n’est inventée. Les compteurs arrondis par une plateforme restent explicitement marqués comme tels. Le snapshot validé est copié dans le dépôt public de la maquette ; la preview le recharge depuis son propre dossier `data` au démarrage, chaque heure et au retour sur l’onglet.

## Analyse éditoriale

Le moteur rapproche les accroches normalisées afin de repérer le même créatif sur plusieurs plateformes. Les enseignements restent descriptifs : type de contenu dominant dans le top, réseau porteur, écart entre déclinaisons et taille de l’échantillon. Aucune causalité n’est inventée.

## Veille de commentaires

La file « Commentaires » est séparée du feed Trends : elle classe des posts individuels sur lesquels une intervention rapide peut créer de la notoriété. Le classement combine fraîcheur, adéquation à l’univers Lofi et potentiel de réaction ; il ne compare jamais directement les volumes bruts de plateformes différentes. Les commentaires proposés doivent viser un détail précis de la vidéo, tenir en une seule idée, éviter liens, hashtags, appels à l’action et autopromotion, et rester hors des sujets sensibles.

La veille est programmée toutes les six heures. La preview embarque le dernier snapshot validé puis recharge son fichier `data/comment-opportunities/feed.json` au démarrage, chaque heure et au retour sur l’onglet. Les boutons « Fait » et « Passer » ne stockent qu’un état local au navigateur. Copier ou ouvrir un post ne déclenche aucune publication : la décision et l’envoi restent humains.

## Suite

1. Accès propriétaires Instagram et TikTok pour la portée, les partages, les sauvegardes et le watch time.
2. YouTube Analytics pour rétention, durée moyenne, sources de trafic et abonnés gagnés.
3. X API avec plafond de dépense explicite pour une chronologie plus profonde.
4. Relevés rapprochés à 1 h, 6 h, 24 h, 72 h et 7 jours.
5. Transformation manuelle d’un enseignement validé en idée puis en brief.
