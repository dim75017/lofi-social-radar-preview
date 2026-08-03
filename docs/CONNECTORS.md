# Connecteurs V1 et limites

État vérifié le 4 août 2026. Chaque intégration doit être revalidée contre la documentation officielle au moment de son branchement.

| Source | V1 | Limite structurante |
|---|---|---|
| YouTube | OAuth + import | Les données Analytics propriétaires exigent l’autorisation de la chaîne. Les quotas Data API restent suivis par opération. |
| Instagram | Import manuel | Comptes professionnels, permissions Meta et App Review ; pas d’accès global aux tendances. |
| TikTok | Import manuel | Display API limitée aux comptes autorisés. Research API non adaptée à un radar commercial. |
| X | Désactivé par défaut | API facturée à l’usage et limites par endpoint ; budget explicite requis. |
| Reddit | Import manuel | Usage commercial soumis aux conditions et accords applicables ; aucun scraping de contournement. |
| Discord | Bot autorisé | Uniquement les serveurs où le bot est installé ; intent privilégié pour le contenu des messages. |
| Google Trends | Import manuel | API officielle encore en accès alpha limité. |
| Pinterest, newsletters, paid, site, calendriers | Import normalisé | Connecteurs à définir ; l’interface ne simule pas leur présence. |

Références officielles :

- YouTube Data API : <https://developers.google.com/youtube/v3/getting-started>
- YouTube Analytics API : <https://developers.google.com/youtube/analytics/reference/>
- Instagram API : <https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api>
- TikTok Display API : <https://developers.tiktok.com/doc/display-api-overview/>
- TikTok Research API : <https://developers.tiktok.com/doc/research-api-faq>
- X API : <https://docs.x.com/x-api/getting-started/pricing>
- Reddit Data API Terms : <https://redditinc.com/policies/data-api-terms>
- Discord Gateway : <https://docs.discord.com/developers/events/gateway>
- Google Trends API : <https://developers.google.com/search/apis/trends>
