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
  assert.match(html, /id="top-platform-subnav"/);
  assert.match(html, /Données publiques réelles/);
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
  assert.doesNotMatch(previewEntry, /key=\{`\$\{workspace\.generatedAt\}:\$\{workspace\.posts\.length\}`\}/);
  assert.match(previewEntry, /public-history-summary\.json/);
  assert.match(previewEntry, /public-history-\$\{platform\}\.json/);
  assert.match(previewEntry, /cache: "force-cache"/);
  assert.match(component, /resolvedPlatformCounts/);
  assert.match(component, /Les vrais compteurs sont déjà affichés/);
  assert.match(component, /PostDetailsModal/);
  assert.match(component, /post-visual-trigger/);
  assert.match(component, /inline-video-frame/);
  assert.match(component, /Plus d’informations/);
  assert.match(component, /Mesure au lancement/);
  assert.match(component, /metric_history/);
  assert.match(component, /hasMediaPreview \?/);
  assert.match(component, /text-only/);
  assert.doesNotMatch(component, /Lire ici|post-play-button/);
  assert.doesNotMatch(component, />\s*Tous\s*</);
  assert.match(component, /categoryFilters\(topPlatform\)\.map/);
  assert.match(component, /category-results/);
  assert.doesNotMatch(component, /Historique visible chargé jusqu’au dernier lot/);
  assert.match(component, /TIKTOK_THUMBNAIL_CACHE/);
  assert.match(component, /TIKTOK_THUMBNAIL_REQUESTS/);
  assert.match(component, /sharedTikTokPreviewObserver/);
  assert.match(component, /IntersectionObserver/);
  assert.equal((component.match(/new IntersectionObserver/g) ?? []).length, 1);
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
