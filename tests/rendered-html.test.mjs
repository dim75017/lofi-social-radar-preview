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
  assert.match(html, /Données publiques réelles/);
  assert.match(html, /Instagram, X, TikTok et YouTube/);
  assert.doesNotMatch(html, /🧪 Démo|Données de démonstration|codex-preview|react-loading-skeleton/i);
});

test("keeps real social collection, post formats and persistence explicit", async () => {
  const [hosting, schema, component, formats, scanner, publicHistory, packageJson] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/SocialOS.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/social-formats.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/social-scanner.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-history.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
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
  assert.match(component, /top-platform-picker/);
  assert.match(component, /Toutes les plateformes/);
  assert.match(component, /posts classés · tous affichés/);
  assert.match(component, /topFilteredPosts\.map/);
  assert.doesNotMatch(component, /slice\(0,\s*12\)|Top 12 affiché/);
  assert.match(formats, /Commentaires/);
  assert.match(component, /commentaires écrits par @LofiGirl/i);
  assert.match(publicHistory, /isInScopeSocialPost/);
  assert.match(publicHistory, /seuls les Shorts et posts Communauté sont inclus/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
