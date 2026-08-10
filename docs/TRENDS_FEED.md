# Feed Trends

Le feed public est un snapshot horodaté dans `data/trends/feed.json`. Il rassemble uniquement des signaux observés et conserve, pour chaque trend, la plateforme, la source, l’URL et la date du relevé. Une métrique absente reste `null` ; elle ne vaut jamais zéro.

## Niveaux de preuve

- `exact` : valeur renvoyée par une API officielle ou compteur public non abrégé.
- `platform-estimate` : valeur arrondie ou agrégée affichée par la plateforme ; le texte source reste conservé.
- `editorial-observation` : format, phrase ou mécanique constatée sur une page publique sans volume certifiable.
- Les scores de momentum et de pertinence sont des classements internes dérivés de ces observations. Ils ne constituent ni une audience mesurée, ni une prédiction de viralité.

Une trend sans observation sourcée est refusée. La maquette embarque le dernier snapshot validé, puis tente une actualisation directe depuis le dépôt source avec `cache: no-store`. Une panne réseau ne remplace jamais ce fallback par un feed vide.

## Limites des plateformes

- **X** : l’API Trends et les compteurs de recherches peuvent fournir des signaux géographiques et temporels officiels. Ils restent payants et doivent être plafonnés.
- **TikTok** : Creative Center expose publiquement des hashtags, sons et vidéos en tendance, mais TikTok ne documente pas d’API commerciale générale pour ce feed. Display API couvre les vidéos autorisées d’un créateur, pas les trends globales. Research API n’est pas une source commerciale pour Lofi Girl.
- **Instagram** : l’API Meta peut suivre une liste limitée de hashtags avec des médias récents ou populaires pour un compte professionnel autorisé. Elle ne fournit ni feed global natif de trends Reels, ni compteur général d’utilisation des audios.
- **YouTube** : Data API expose des charts et des recherches de vidéos courtes, mais ne certifie pas qu’une vidéo de moins de quatre minutes est un Short. Depuis juillet 2025, `mostPopular` ne représente plus un classement général de tout YouTube et aucun compteur global d’utilisation d’un son Shorts n’est exposé.

Le produit doit donc nommer clairement les signaux : **trend officielle**, **signal de watchlist**, **observation éditoriale** ou **proxy short-form**. Il ne doit pas présenter Instagram ou YouTube comme un scan global natif.

## Architecture cible

À terme, un collecteur indépendant par fournisseur écrit des observations immuables. Un agrégateur déduplique les aliases, calcule le cycle de vie à partir de plusieurs relevés comparables et produit le snapshot public. Chaque source échoue de façon isolée : son dernier relevé valide est conservé avec un statut de fraîcheur, sans transformer une panne en déclin.

La publication GitHub Pages copie seulement `data/trends/feed.json` vers `data/trends/feed.json` dans le build public. L’API `GET /api/trends` renvoie le même contrat validé. `POST /api/trends` refuse les ajouts isolés : une tendance n’entre dans le feed qu’avec son snapshot complet, ses sources et ses trois propositions validées.

Sources de référence : [X Trends](https://docs.x.com/x-api/trends/get-trends-by-woeid), [TikTok Creative Center](https://ads.tiktok.com/help/article/how-to-use-trends), [Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [YouTube Data API](https://developers.google.com/youtube/v3/docs/videos/list).
