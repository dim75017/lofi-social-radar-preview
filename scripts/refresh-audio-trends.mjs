import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertAudioTrendFeed } from "../lib/audio-trends.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const feedPath = resolve(root, "data", "audio-trends", "feed.json");
const statusPath = resolve(root, "data", "audio-trends", "refresh-status.json");
const now = new Date();
const capturedAt = now.toISOString();

const current = assertAudioTrendFeed(JSON.parse(await readFile(feedPath, "utf8")));
const next = structuredClone(current);
const providerResults = [];

for (const platform of ["instagram", "tiktok"]) {
  const trends = next.trends.filter((trend) => trend.platform === platform);
  let checked = 0;
  let matched = 0;
  let updated = 0;
  const errors = [];

  for (const trend of trends) {
    checked += 1;
    try {
      const response = await fetch(trend.audioUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; LofiSocialRadar/1.0; +https://github.com/dim75017/lofi-social-radar)",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const parsed = parsePublicUsageCounter(html, platform);
      if (!parsed) throw new Error("compteur public introuvable");
      matched += 1;
      const previousUses = [...trend.usageObservations]
        .reverse()
        .find((observation) => observation.uses !== null)?.uses ?? null;
      if (previousUses !== null && parsed.uses < previousUses) {
        throw new Error("compteur incohérent avec le dernier relevé");
      }
      const lastCapturedAt = trend.usageObservations.at(-1)?.capturedAt;
      if (lastCapturedAt && sameParisDay(lastCapturedAt, capturedAt)) continue;

      trend.usageObservations.push({
        capturedAt,
        uses: parsed.uses,
        rank: null,
        rankWindow: null,
        sourceLabel: `${platform === "tiktok" ? "TikTok" : "Instagram"} · compteur public${parsed.exactness === "platform-estimate" ? " abrégé" : ""}`,
        sourceUrl: trend.audioUrl,
        exactness: parsed.exactness,
      });
      trend.usageObservations = trend.usageObservations.slice(-30);
      updated += 1;
    } catch (error) {
      errors.push(`${trend.id}: ${error instanceof Error ? error.message : "erreur inconnue"}`);
    }
  }

  providerResults.push({
    platform,
    checked,
    matched,
    updated,
    status: matched > 0 ? "success" : "failed",
    errors,
  });
}

providerResults.push({
  platform: "youtube",
  checked: 0,
  matched: 0,
  updated: 0,
  status: "limited",
  errors: ["YouTube n’expose pas de compteur global d’utilisations audio comparable."],
});

const successfulProviders = providerResults.filter((result) => result.status === "success");
if (successfulProviders.length > 0) {
  next.capturedAt = capturedAt;
  next.nextRefreshAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString();
  next.sourceChecks = next.sourceChecks.map((check) => {
    const result = providerResults.find((candidate) => candidate.platform === check.platform);
    if (!result) return check;
    return {
      ...check,
      status: result.status,
      checkedAt: capturedAt,
    };
  });
  assertAudioTrendFeed(next);
  await writeJsonAtomic(feedPath, next);
}

await writeJsonAtomic(statusPath, {
  version: 1,
  attemptedAt: capturedAt,
  status: successfulProviders.length > 0 ? "success" : "failed",
  published: successfulProviders.length > 0,
  providers: providerResults,
});

if (successfulProviders.length === 0) {
  throw new Error("Aucun compteur audio public n’a pu être relevé ; le dernier feed validé est conservé.");
}

function parsePublicUsageCounter(html, platform) {
  const normalized = html
    .replaceAll("\\u00e9", "é")
    .replaceAll("\\u00e8", "è")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#x202f;", " ")
    .replaceAll("&#8239;", " ");
  const candidates = [];

  if (platform === "tiktok") {
    for (const pattern of [
      /"videoCount"\s*:\s*"?(\d{1,12})"?/giu,
      /(\d+(?:[.,]\d+)?)\s*([KMB])?\s*(?:vid[ée]os|videos)/giu,
    ]) collectMatches(normalized, pattern, candidates);
  } else {
    for (const pattern of [
      /"(?:reelsCount|clipsCount|mediaCount)"\s*:\s*"?(\d{1,12})"?/giu,
      /(\d+(?:[.,]\d+)?)\s*([KMB])?\s*(?:reels?|vid[ée]os|videos)/giu,
    ]) collectMatches(normalized, pattern, candidates);
  }

  const plausible = candidates
    .map(({ value, suffix }) => ({
      uses: parseCompactNumber(value, suffix),
      exactness: suffix ? "platform-estimate" : "exact",
    }))
    .filter((candidate) => Number.isSafeInteger(candidate.uses) && candidate.uses >= 1)
    .sort((left, right) => right.uses - left.uses);
  return plausible[0] ?? null;
}

function collectMatches(text, pattern, output) {
  for (const match of text.matchAll(pattern)) {
    output.push({ value: match[1], suffix: match[2]?.toUpperCase() ?? "" });
  }
}

function parseCompactNumber(raw, suffix) {
  const value = Number(raw.replace(",", "."));
  const multiplier = suffix === "B"
    ? 1_000_000_000
    : suffix === "M"
      ? 1_000_000
      : suffix === "K"
        ? 1_000
        : 1;
  return Math.round(value * multiplier);
}

function sameParisDay(left, right) {
  const formatter = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(left)) === formatter.format(new Date(right));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
