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
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Lofi Social Radar product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lofi Social Radar<\/title>/i);
  assert.match(html, /Social Radar/);
  assert.match(html, /Vue d’ensemble/);
  assert.match(html, /Community Intelligence/);
  assert.match(html, /🧪 Démo/);
  assert.match(html, /🔥/);
  assert.match(html, /✨/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps persistence and guardrails explicit", async () => {
  const [hosting, schema, component, packageJson] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/SocialOS.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1"\s*:\s*"DB"/);
  assert.match(schema, /predictionSnapshot/);
  assert.match(schema, /decisionEvents/);
  assert.match(component, /aucune publication automatique/i);
  assert.match(component, /n’ajoute pas automatiquement l’idée à la Roadmap/i);
  assert.match(component, /Données de démonstration|Données démo|🧪/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
