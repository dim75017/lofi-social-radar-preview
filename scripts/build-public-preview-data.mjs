import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "work", "pages-dist", "data");
const platforms = ["youtube", "instagram", "tiktok", "x"];

const [snapshot, summary] = await Promise.all([
  readJson(resolve(root, "data", "public-history.json")),
  readJson(resolve(root, "data", "public-history-summary.json")),
]);

if (snapshot.generatedAt !== summary.generatedAt) {
  throw new Error("Le résumé public ne correspond pas à la version de l’historique.");
}
if (snapshot.posts.length !== summary.totalPostCount) {
  throw new Error("Le total du résumé public ne correspond pas à l’historique.");
}

await mkdir(output, { recursive: true });
await writeJson(resolve(output, "public-history-summary.json"), summary);
await writeJson(resolve(output, "public-history.json"), snapshot);

for (const platform of platforms) {
  const posts = snapshot.posts.filter((post) => post.platform === platform);
  if (posts.length !== summary.platformCounts[platform]) {
    throw new Error(`Le compteur ${platform} du résumé public est incohérent.`);
  }
  await writeJson(resolve(output, `public-history-${platform}.json`), {
    generatedAt: snapshot.generatedAt,
    coverage: snapshot.coverage.filter((item) => item.platform === platform),
    posts,
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}
