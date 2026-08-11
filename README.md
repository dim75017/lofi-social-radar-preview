# Lofi Social Radar

Le **Social & Community Intelligence OS** de Lofi Girl analyse les contenus publics des comptes officiels, classe les posts qui surperforment et transforme leurs signaux en idées éditoriales testables.

**Maquette publique :** https://dim75017.github.io/lofi-social-radar-preview/

## Fonctionnalités

- Navigation interactive : Tableau de bord, meilleurs posts, recommandations, roadmap et tendances.
- Tableau de bord audience : total de followers, évolution issue de relevés réels et taux d’engagement comparable par plateforme. Un filtre commun pilote les deux indicateurs sur 30 jours (vue par défaut), 3 mois, 6 mois, 1 an ou All time. L’engagement utilise tous les posts mesurables publiés dans la fenêtre sélectionnée ; l’évolution des followers repose uniquement sur les observations réellement collectées, sans interpolation ni remplacement des valeurs absentes par zéro.
- Catalogue public de **910 contenus visibles** au 4 août 2026 : 519 YouTube (319 Shorts + 200 posts Communauté), 386 TikTok et 5 X.
- « Meilleurs posts » impose toujours une plateforme et une catégorie actives : aucun filtre « Tous » ne mélange les formats. Les contenus sont triés par likes publics décroissants dans chaque catégorie ; les Shorts utilisent provisoirement les vues, car leurs likes ne sont pas présents dans le snapshot public actuel.
- Le filtre de durée (7 jours, 30 jours, 3 mois, 6 mois, 1 an ou All time) et la recherche restent disponibles. Le score analytique composite demeure réservé aux analyses et aux idées ; il n’ordonne plus la liste visible.
- Moteur d’idées explicable : chaque proposition cite les posts sources, le signal observé, le hook, le format et les déclinaisons YouTube, Instagram, TikTok et X.
- Décisions éditoriales locales : « À produire », « À retravailler » ou « Écarter ».
- Recherche, catégories et sous-catégories de plateformes entièrement interactives. Les aperçus média sont carrés : un clic sur un TikTok ou un Short lance directement le lecteur, un clic sur une image ouvre une grande preview, et les posts texte n’affichent aucune fausse vignette. Le classement Meilleurs posts n’est ni tronqué ni paginé.
- Interface responsive alignée sur les Radars YouTube et Spotify, avec assets officiels Lofi Girl uniquement.

## Couverture des données publiques

- **YouTube** : uniquement les Shorts et les posts Communauté publics. Les nombres visibles sont des contenus **collectés**, pas des totaux historiques : la fenêtre publique livre actuellement 200 posts Communauté (94 images, 17 sondages et 89 textes), puis arrête sa pagination. Le scanner conserve désormais les relevés de façon cumulative et dédupliquée pour ne plus perdre les posts qui sortent de cette fenêtre. Les vidéos longues et les lives sont entièrement exclus.
- **Dates YouTube** : les 319 Shorts dont la date publique n’est pas récupérable restent inclus dans All time et sont exclus des durées bornées, sans leur inventer une date à partir de l’import.
- **TikTok** : catalogue public visible du profil officiel, avec dates et métriques publiques disponibles.
- **X** : cinq publications actuellement accessibles par le scanner public. Un historique plus profond nécessite l’API X appropriée.
- **Instagram** : le profil officiel déclare 1 673 publications, mais l’historique complet et ses insights nécessitent l’autorisation Meta du compte propriétaire. Aucun chiffre n’est inventé en attendant.

La couverture porte sur les contenus encore publics et visibles : les contenus supprimés, privés ou non répertoriés ne peuvent pas être certifiés par un scan public.

Les filtres « Commentaires » désignent les commentaires écrits par le compte Lofi Girl. Leur collecte complète nécessite les exports ou accès propriétaires des plateformes ; le radar affiche cette limite au lieu de fabriquer des résultats.

## Commandes

```bash
pnpm install
pnpm dev
pnpm build
pnpm build:preview
pnpm test
pnpm audience:refresh
python scripts/collect_public_history.py
```

## Étape suivante

Importer l’historique propriétaire YouTube Posts pour récupérer les publications Communauté antérieures à la fenêtre publique, puis connecter YouTube Data API afin d’ajouter les likes et dates exactes des Shorts. Connecter ensuite les accès propriétaires Meta, TikTok et X et automatiser les relevés à 1 h, 6 h, 24 h, 72 h et 7 jours.
