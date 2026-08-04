# Lofi Social Radar

Le **Social & Community Intelligence OS** de Lofi Girl analyse les contenus publics des comptes officiels, classe les posts qui surperforment et transforme leurs signaux en idées éditoriales testables.

**Maquette publique :** https://dim75017.github.io/lofi-social-radar-preview/

## Fonctionnalités

- Navigation interactive : Command Center, meilleurs posts, idées à produire, tous les contenus et état des sources.
- Catalogue public de **910 contenus visibles** au 4 août 2026 : 519 YouTube (319 Shorts + 200 posts Communauté), 386 TikTok et 5 X.
- « Meilleurs posts » affiche tout le classement dans un flux continu, avec un seul sélecteur dépliant pour Toutes les plateformes, YouTube, Instagram, TikTok ou X, puis les filtres natifs de la plateforme choisie.
- Classement normalisé à l’intérieur de chaque plateforme, sans remplacer les métriques absentes par des zéros.
- Moteur d’idées explicable : chaque proposition cite les posts sources, le signal observé, le hook, le format et les déclinaisons YouTube, Instagram, TikTok et X.
- Décisions éditoriales locales : « À produire », « À retravailler » ou « Écarter ».
- Recherche, filtres de formats, sélecteur de plateforme et cartes entièrement cliquables ; le classement Meilleurs posts n’est ni tronqué ni paginé.
- Interface responsive alignée sur les Radars YouTube et Spotify, avec assets officiels Lofi Girl uniquement.

## Couverture des données publiques

- **YouTube** : uniquement les Shorts et les posts Communauté publics (image, texte et sondage). Les vidéos longues et les lives sont entièrement exclus. L’onglet public livre actuellement 200 posts Communauté avant d’arrêter sa pagination ; cela ne garantit pas l’absence de posts plus anciens.
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
python scripts/collect_public_history.py
```

## Étape suivante

Connecter les accès propriétaires Meta, TikTok, X et YouTube Analytics afin d’ajouter portée, watch time, rétention, partages et sauvegardes, puis automatiser les relevés à 1 h, 6 h, 24 h, 72 h et 7 jours.
