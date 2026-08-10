# Feed Trends

Le feed public v2 est un snapshot horodaté dans `data/trends/feed.json`. Il rassemble uniquement des signaux observés et conserve, pour chaque trend, la plateforme, la source, l’URL et la date du relevé. Une métrique absente reste `null` ; elle ne vaut jamais zéro.

## Niveaux de preuve

- `exact` : valeur renvoyée par une API officielle ou compteur public non abrégé.
- `platform-estimate` : valeur arrondie ou agrégée affichée par la plateforme ; le texte source reste conservé.
- `editorial-observation` : format, phrase ou mécanique constatée sur une page publique sans volume certifiable.
- Les scores de momentum et de pertinence sont des classements internes dérivés de ces observations. Ils ne constituent ni une audience mesurée, ni une prédiction de viralité.

Une trend sans observation sourcée est refusée. La maquette embarque le dernier snapshot validé, puis tente une actualisation directe depuis le dépôt source avec `cache: no-store`. Une panne réseau ne remplace jamais ce fallback par un feed vide.

## Posts de référence v2

Chaque trend possède un champ `referencePost`. Il contient soit un post public directement vérifiable sur la plateforme, soit `null` quand aucun exemple suffisamment fiable n’a été trouvé. Le snapshot actuel contient **16 références réelles et 2 absences honnêtes** : `eclipse-perseides-12-aout` et `heatwave-tatooine` restent à `null` au lieu de transformer un article éditorial en publication sociale.

Une référence comprend :

- la plateforme, l’auteur quand il est public, la légende et l’URL canonique du post ;
- le type de média, une miniature HTTPS facultative et la date de publication lorsqu’elle est disponible ;
- la date de capture, le motif de sélection, la source et son niveau de preuve ;
- les vues, likes, commentaires et partages, chacun sous forme de nombre positif ou `null`.

L’URL doit correspondre à la plateforme déclarée : post ou Reel Instagram, vidéo TikTok canonique, YouTube Short, ou statut X. La plateforme doit aussi faire partie des plateformes déclarées par la trend. Une référence illustre le mécanisme ; elle ne prouve pas, à elle seule, que le format est globalement en tendance.

Les métriques suivent les mêmes règles de preuve que les observations. Une `editorial-observation` ne peut porter aucune métrique numérique. Une `platform-estimate` conserve les valeurs arrondies rapportées par le tracker et ne doit pas être présentée comme un compteur exact. La date de capture ne peut pas être postérieure au snapshot.

Dans cette v2, les miniatures acceptées sont des URLs HTTPS distantes. Aucun média lourd, vidéo locale ou image encodée en base64 n’est embarqué dans le JSON public ; cela garde le fallback et le chargement GitHub Pages légers. Une future prise en charge de fichiers locaux devra ajouter une copie d’assets dédiée et une résolution compatible avec le sous-répertoire Pages.

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
