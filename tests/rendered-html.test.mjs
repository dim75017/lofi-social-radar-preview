import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

const cloudflareStub = "data:text/javascript,export const env = {};";
const loaderSource = `
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { shortCircuit: true, url: ${JSON.stringify(cloudflareStub)} };
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the live Social Radar shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lofi Social Radar<\/title>/i);
  assert.match(html, /Command Center/);
  assert.match(html, /Meilleurs posts/);
  assert.match(html, /Recommandations/);
  assert.match(html, /Roadmap/);
  assert.match(html, /id="top-platform-subnav"/);
  assert.doesNotMatch(html, /Données publiques réelles|Snapshot public interactif|Générer les idées/);
  assert.match(html, /Instagram, X, TikTok et YouTube/);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /🧪 Démo|Données de démonstration|codex-preview|react-loading-skeleton/i);
});

test("keeps real social collection, post formats and persistence explicit", async () => {
  const [hosting, schema, component, formats, durations, scanner, publicHistory, packageJson, styles, socialMedia, socialRanking, previewEntry] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/SocialOS.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/social-formats.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/social-duration.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/social-scanner.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-history.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/social-media.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/social-ranking.ts", import.meta.url), "utf8"),
    readFile(new URL("../preview/main.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1"\s*:\s*"DB"/);
  assert.match(schema, /socialAccounts/);
  assert.match(schema, /socialPosts/);
  assert.match(schema, /postMetricSnapshots/);
  assert.match(schema, /scanRuns/);
  assert.match(scanner, /youtube\.com\/feeds\/videos\.xml/);
  assert.match(scanner, /youtube\.com\/@LofiGirl\/shorts/);
  assert.match(scanner, /youtube\.com\/@LofiGirl\/posts/);
  assert.match(scanner, /vidéos longues et lives exclus/i);
  assert.match(scanner, /instagram\.com/);
  assert.match(scanner, /tiktok\.com/);
  assert.match(scanner, /x\.com/);
  assert.match(component, /Chaque réseau est comparé à lui-même/);
  assert.match(component, /métriques absentes sont retirées/i);
  assert.match(component, /top-platform-subnav/);
  assert.match(component, /Plateformes des meilleurs posts/);
  assert.doesNotMatch(component, /topNavExpanded|setTopNavExpanded|nav-disclosure/);
  assert.match(component, /view === "top" && topPlatform === key/);
  assert.match(component, /onClick=\{\(\) => chooseTopPlatform\(key\)\}/);
  assert.doesNotMatch(component, /top-platform-picker/);
  assert.match(component, /SOCIAL_DURATION_FILTERS/);
  assert.doesNotMatch(component, /Règle de classement/);
  assert.doesNotMatch(component, /Chercher une accroche, un format/);
  assert.doesNotMatch(component, /publicRankingLabel/);
  assert.match(component, /activeInlineVideoId/);
  assert.match(component, /label: "Recommandations"/);
  assert.match(component, /label: "Roadmap"/);
  assert.match(component, /className="reco-status-tabs"/);
  assert.match(component, /🟡 À valider/);
  assert.match(component, /✓ Validées/);
  assert.match(component, /✕ Refusées/);
  assert.match(component, /↻ Nouvelles idées/);
  assert.match(component, /className="reco-grid"/);
  assert.doesNotMatch(component, /reco-platform-tabs|Filtrer les recommandations par plateforme/);
  assert.doesNotMatch(component, /recommendation-platform-grid|Déclinaisons possibles|Exécution commune/);
  assert.match(component, /className="reco-tags"/);
  assert.match(component, /L’idée/);
  assert.match(component, /Texte prêt à poster/);
  assert.match(component, /Inspiré de vos succès/);
  assert.match(component, /Les posts qui le prouvent/);
  assert.match(component, /Ce qu’on reprend/);
  assert.match(component, /Ce qu’on change/);
  assert.doesNotMatch(component, /Un même moment, une publication commune|Source \{index/);
  assert.doesNotMatch(component, /Afficher 10 idées de plus/);
  assert.match(component, /function RoadmapBoard/);
  assert.match(component, /Mois/);
  assert.match(component, /Année/);
  assert.match(component, /aria-label="Liste"/);
  assert.match(component, /aria-label="Calendrier"/);
  assert.match(component, /function RoadmapMiniMonth/);
  assert.match(component, /function RoadmapMonth/);
  assert.match(component, /function RoadmapList/);
  assert.match(component, /function RoadmapDayModal/);
  assert.doesNotMatch(component, /function RoadmapLegend/);
  assert.match(component, /Publication commune/);
  assert.doesNotMatch(previewEntry, /key=\{`\$\{workspace\.generatedAt\}:\$\{workspace\.posts\.length\}`\}/);
  assert.match(previewEntry, /public-history-summary\.json/);
  assert.match(previewEntry, /public-history-\$\{platform\}\.json/);
  assert.match(previewEntry, /publicHistorySummary\.totalPostCount/);
  assert.match(previewEntry, /publicHistorySummary\.formatCounts/);
  assert.match(previewEntry, /cache: "force-cache"/);
  assert.match(previewEntry, /RAW_TREND_FEED_URL/);
  assert.match(previewEntry, /initialTrendFeed=\{trendFeed\}/);
  assert.match(previewEntry, /window\.setInterval\(refreshTrendFeed, 60 \* 60 \* 1_000\)/);
  assert.match(previewEntry, /visibilitychange/);
  assert.match(component, /resolvedPlatformCounts/);
  assert.match(component, /Les vrais compteurs sont déjà affichés/);
  assert.match(component, /PostDetailsModal/);
  assert.match(component, /post-visual-trigger/);
  assert.match(component, /inline-video-frame/);
  assert.match(component, /Plus d’informations/);
  assert.match(component, /Mesure au lancement/);
  assert.match(component, /metric_history/);
  assert.match(component, /label: "Trends"/);
  assert.match(component, /TrendFeedView/);
  assert.match(component, /TrendReferenceMedia/);
  assert.match(component, /TrendDetailsModal/);
  assert.match(component, /trend-reference-card/);
  assert.match(component, /50\+ trends vraiment exploitables/);
  assert.match(component, /Mise à jour quotidienne · focus Lofi Girl/);
  assert.match(component, /isActionableSocialTrend/);
  assert.match(component, /selectGirlFirstSocialTrends/);
  assert.match(component, /feed\.refresh\.counts\.lofiGirl/);
  assert.match(component, /trend-card-source-title/);
  assert.match(component, /TREND_CHARACTER_FILTERS/);
  assert.match(component, /TREND_CHARACTER_META/);
  assert.match(component, /characterFilter/);
  assert.match(component, /aria-label="Filtrer par univers"/);
  assert.match(component, /label: "Lofi Girl"/);
  assert.match(component, /label: "Lofi Boy"/);
  assert.match(component, /Lofi Boy \/ Synthwave Boy/);
  assert.match(component, /character\.emoji.*character\.label.*trend\.territory/);
  assert.doesNotMatch(component, /Potentiel Lofi Girl|Adaptation Lofi Girl|Pourquoi Lofi Girl/);
  assert.match(component, /trend-duration-badge/);
  assert.match(component, /post-grid top-ranking-grid trend-shorts-grid/);
  assert.match(component, /loading="lazy"/);
  assert.match(component, /Voir le post original/);
  assert.match(component, /hasMediaPreview \?/);
  assert.match(component, /text-only/);
  assert.doesNotMatch(component, /Lire ici|post-play-button/);
  assert.doesNotMatch(component, /Social & Community Intelligence OS|Snapshot public interactif|Générer les idées|VIEW_COPY/);
  assert.doesNotMatch(component, />\s*Tous\s*</);
  assert.match(component, /categoryFilters\(topPlatform\)\.map/);
  assert.match(component, /category-results/);
  assert.match(component, /choices\.length \? "poll-card" : ""/);
  assert.doesNotMatch(component, /Historique visible chargé jusqu’au dernier lot/);
  assert.match(component, /TIKTOK_THUMBNAIL_CACHE/);
  assert.match(component, /TIKTOK_THUMBNAIL_REQUESTS/);
  assert.match(component, /sharedTikTokPreviewObserver/);
  assert.match(component, /IntersectionObserver/);
  assert.equal((component.match(/new IntersectionObserver/g) ?? []).length, 2);
  assert.match(component, /role="dialog"/);
  assert.match(component, /event\.key !== "Tab"/);
  const postCard = component.slice(
    component.indexOf("function PostCard"),
    component.indexOf("function PostMediaPreview"),
  );
  assert.doesNotMatch(postCard, /Pourquoi ça ressort/);
  assert.doesNotMatch(postCard, /score_explanation|performance_score|\/100/);
  const detailsModal = component.slice(component.indexOf("function PostDetailsModal"));
  assert.match(detailsModal, /Pourquoi ça ressort/);
  assert.match(detailsModal, /aria-labelledby=\{editorialAnalysisId\}/);
  assert.match(detailsModal, /editorialAnalysis\.mechanism/);
  assert.match(detailsModal, /editorialAnalysis\.comparison/);
  assert.match(detailsModal, /editorialAnalysis\.transferableLesson/);
  assert.match(component, /parsePostRaw\(post\.raw_json\)/);
  assert.match(component, /raw\.pollVotes = post\.poll_votes/);
  assert.match(socialMedia, /youtube-nocookie\.com\/embed/);
  assert.match(socialMedia, /tiktok\.com\/player\/v1/);
  assert.match(socialMedia, /format === "short"/);
  assert.match(socialRanking, /Likes décroissants/);
  assert.match(socialRanking, /Vues décroissantes · likes indisponibles/);
  assert.doesNotMatch(socialRanking, /published_at|performance_score/);
  assert.doesNotMatch(styles, /nav-disclosure|nav-meta/);
  assert.match(styles, /\.post-visual\s*\{[\s\S]*?aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(styles, /\.inline-video-frame/);
  assert.match(styles, /\.post-details-modal/);
  assert.match(styles, /\.reco-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(380px,\s*100%\),\s*1fr\)\)/);
  assert.match(styles, /\.reco-card\s*\{[\s\S]*?content-visibility:\s*auto/);
  assert.match(styles, /\.reco-card-main\s*>\s*h3\s*\{[\s\S]*?font-size:\s*18px/);
  assert.match(styles, /\.reco-proof-preview\s*\{/);
  assert.match(styles, /\.trend-feed-view\s*\{/);
  assert.match(styles, /\.trend-shorts-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*1fr\)\)/);
  assert.match(styles, /\.trend-shorts-grid \.trend-reference-visual\s*\{[\s\S]*?aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(styles, /\.trend-card-source-title\s*\{/);
  assert.match(styles, /\.trend-feed-heading\s*\{/);
  assert.match(styles, /\.trend-snapshot-pill\.is-late\s*\{/);
  assert.match(styles, /\.trend-duration-badge\s*\{/);
  assert.match(styles, /\.trend-details-modal\s*\{/);
  assert.match(styles, /\.recommendation-source-links a > img/);
  assert.match(styles, /\.recommendation-mechanic-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.reco-quick-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.roadmap-year-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(150px,\s*1fr\)\)/);
  assert.match(styles, /\.roadmap-calendar-shell\.platform-neutral\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.roadmap-month-days\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.social-post-card\s*\{[\s\S]*?display:\s*flex;[\s\S]*?height:\s*100%;[\s\S]*?flex-direction:\s*column;/);
  assert.match(styles, /\.social-post-card\.poll-card \.poll-choice-list\s*\{[\s\S]*?grid-auto-rows:\s*minmax\(36px, auto\)/);
  assert.match(styles, /\.poll-choice-list li\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal/);
  assert.doesNotMatch(styles, /\.social-post-card\.poll-card \.poll-choice-list\s*\{[\s\S]*?grid-template-rows:\s*repeat\(5, 36px\)/);
  assert.match(styles, /\.social-post-card footer\s*\{[\s\S]*?grid-template-columns:\s*max-content minmax\(0, 1fr\);/);
  assert.match(styles, /\.post-published-date\s*\{[\s\S]*?min-width:\s*max-content;[\s\S]*?justify-self:\s*start;[\s\S]*?width:\s*max-content;[\s\S]*?padding:\s*4px 12px 4px 10px;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(styles, /@media[\s\S]*?\.social-post-card\.compact\s*\{\s*display:\s*flex;[\s\S]*?\.social-post-card footer\s*\{\s*grid-template-columns:\s*max-content minmax\(0, 1fr\);/);
  assert.match(styles, /platform-youtube[\s\S]*?scale\(1\.8\)/);
  const explicitFontSizes = [...styles.matchAll(/font-size:\s*([0-9.]+)px/g)].map(
    (match) => Number(match[1]),
  );
  assert.ok(explicitFontSizes.length > 100);
  assert.ok(explicitFontSizes.every((size) => size >= 11));
  assert.doesNotMatch(component, /tous affichés/i);
  assert.match(durations, /All time/);
  assert.match(durations, /180d/);
  assert.match(component, /topFilteredPosts\.map/);
  assert.doesNotMatch(component, /slice\(0,\s*12\)|Top 12 affiché/);
  assert.match(formats, /Commentaires/);
  assert.match(formats, /Communauté · image/);
  assert.match(component, /commentaires écrits par @LofiGirl/i);
  assert.match(publicHistory, /isInScopeSocialPost/);
  assert.match(publicHistory, /seuls les Shorts et posts Communauté sont inclus/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
