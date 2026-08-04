import type { NormalizedPost, SocialPlatform } from "./social-scanner.ts";
import {
  rankPosts,
  type RankedPost,
  type ScoreConfidence,
} from "./social-score.ts";

export type EditorialPattern =
  | "cross_platform_echo"
  | "suspense_reveal"
  | "music_and_usage"
  | "character_and_lore"
  | "community_conversation"
  | "activation"
  | "relatable_humour";

export type IdeaConfidence = "high" | "medium" | "low";

export type SocialIdeaSeed = {
  platform: SocialPlatform;
  externalId: string;
  url: string;
  label: string;
  performanceScore: number;
  scoreConfidence: ScoreConfidence;
  platformRank: number | null;
};

export type PlatformIdeaAdaptation = {
  format: string;
  execution: string;
};

export type SocialIdea = {
  id: string;
  title: string;
  pattern: EditorialPattern;
  seedPosts: SocialIdeaSeed[];
  observedSignal: {
    summary: string;
    evidence: string[];
  };
  proposedFormat: string;
  hook: string;
  platformAdaptations: Record<SocialPlatform, PlatformIdeaAdaptation>;
  confidence: IdeaConfidence;
  confidenceScore: number;
  confidenceRationale: string;
  limits: string[];
  assetPolicy: "official-assets-only";
};

export type SocialIdeaPlan = {
  generatedAt: string;
  eligiblePostCount: number;
  winnerCount: number;
  ideas: SocialIdea[];
  caveats: string[];
};

export type GenerateSocialIdeasOptions = {
  now?: Date | string | number;
  maxIdeas?: number;
  winnersPerPlatform?: number;
};

type Candidate = {
  key: string;
  pattern: EditorialPattern;
  posts: RankedPost[];
  repeatedCreative: boolean;
};

type IdeaTemplate = {
  title: string;
  proposedFormat: string;
  hook: string;
};

const PLATFORM_ORDER: SocialPlatform[] = [
  "youtube",
  "instagram",
  "tiktok",
  "x",
];

const PATTERN_ORDER: EditorialPattern[] = [
  "cross_platform_echo",
  "suspense_reveal",
  "character_and_lore",
  "community_conversation",
  "music_and_usage",
  "activation",
  "relatable_humour",
];

const PATTERN_LABELS: Record<EditorialPattern, string> = {
  cross_platform_echo: "accroche reprise sur plusieurs plateformes",
  suspense_reveal: "suspense et révélation",
  music_and_usage: "musique et contexte d’usage",
  character_and_lore: "personnages et continuité narrative",
  community_conversation: "conversation avec la communauté",
  activation: "sortie ou activation",
  relatable_humour: "situation relatable et humour",
};

/**
 * Produit des pistes éditoriales reproductibles à partir des posts les mieux
 * classés de chaque plateforme. Les sorties sont des hypothèses de test : elles
 * ne transforment jamais une corrélation observée en causalité créative.
 */
export function generateSocialIdeas(
  posts: readonly NormalizedPost[],
  options: GenerateSocialIdeasOptions = {},
): SocialIdeaPlan {
  const referenceTime = ideaReferenceTime(posts, options.now);
  const winnersPerPlatform = boundedInteger(options.winnersPerPlatform, 3, 1, 10);
  const maxIdeas = boundedInteger(options.maxIdeas, 4, 1, 10);
  const ranked = rankPosts(posts, referenceTime);
  const eligible = ranked.filter(
    (post): post is RankedPost & { performanceScore: number } =>
      post.performanceScore !== null && post.confidence !== "insufficient",
  );
  const winners = eligible.filter(
    (post) =>
      post.platformRank !== null && post.platformRank <= winnersPerPlatform,
  );
  const candidates = buildCandidates(winners).sort(compareCandidates);
  const ideas = candidates
    .slice(0, maxIdeas)
    .map((candidate) => materializeIdea(candidate));

  return {
    generatedAt: referenceTime.toISOString(),
    eligiblePostCount: eligible.length,
    winnerCount: winners.length,
    ideas,
    caveats: [
      "Les idées sont des hypothèses éditoriales issues de signaux descriptifs ; elles ne prédisent pas la performance et ne démontrent aucune causalité.",
      "Les scores restent normalisés à l’intérieur de chaque plateforme : les volumes bruts ne sont pas comparés entre réseaux.",
      "Aucun visuel généré par IA : utiliser uniquement les assets officiels Lofi Girl et les créations validées par l’équipe.",
    ],
  };
}

export const generateEditorialIdeas = generateSocialIdeas;

function buildCandidates(winners: readonly RankedPost[]): Candidate[] {
  const candidates: Candidate[] = [];
  const creativeGroups = groupBy(winners, creativeKey);

  for (const [key, group] of creativeGroups) {
    if (!key || key.split(" ").length < 4) continue;
    if (new Set(group.map((post) => post.platform)).size < 2) continue;
    candidates.push({
      key: `cross:${key}`,
      pattern: "cross_platform_echo",
      posts: [...group].sort(compareSeedPosts),
      repeatedCreative: true,
    });
  }

  const patternGroups = groupBy(winners, detectPattern);
  for (const [pattern, group] of patternGroups) {
    candidates.push({
      key: `pattern:${pattern}`,
      pattern,
      posts: [...group].sort(compareSeedPosts),
      repeatedCreative: false,
    });
  }

  return candidates;
}

function materializeIdea(candidate: Candidate): SocialIdea {
  const seeds = selectSeeds(candidate.posts, 5);
  const platforms = orderedPlatforms(seeds.map((post) => post.platform));
  const scores = seeds.map((post) => post.performanceScore ?? 0);
  const averageScore = Math.round(average(scores));
  const confidenceScore = ideaConfidenceScore(
    seeds,
    platforms.length,
    candidate.repeatedCreative,
  );
  const template = ideaTemplate(candidate.pattern, dominantPattern(seeds));
  const evidence = seeds.map(
    (post) =>
      `${platformLabel(post.platform)} · ${post.performanceScore}/100 · « ${postLabel(post, 80)} » · ${post.url}`,
  );
  const observedSignal = candidate.repeatedCreative
    ? `Une accroche quasi identique apparaît parmi les gagnants de ${joinFrench(
        platforms.map(platformLabel),
      )}, avec un score normalisé moyen de ${averageScore}/100.`
    : `${seeds.length} post${seeds.length > 1 ? "s" : ""} gagnant${
        seeds.length > 1 ? "s" : ""
      } relève${seeds.length > 1 ? "nt" : ""} du signal « ${
        PATTERN_LABELS[candidate.pattern]
      } » sur ${joinFrench(platforms.map(platformLabel))}, avec un score normalisé moyen de ${averageScore}/100.`;

  return {
    id: `idea-${candidate.pattern}-${stableHash(
      seeds.map((post) => `${post.platform}:${post.externalId}`).join("|"),
    )}`,
    title: template.title,
    pattern: candidate.pattern,
    seedPosts: seeds.map((post) => ({
      platform: post.platform,
      externalId: post.externalId,
      url: post.url,
      label: postLabel(post, 120),
      performanceScore: post.performanceScore ?? 0,
      scoreConfidence: post.confidence,
      platformRank: post.platformRank,
    })),
    observedSignal: {
      summary: observedSignal,
      evidence,
    },
    proposedFormat: template.proposedFormat,
    hook: template.hook,
    platformAdaptations: adaptationsFor(candidate.pattern),
    confidence: confidenceLevel(confidenceScore),
    confidenceScore,
    confidenceRationale: `${seeds.length} seed${seeds.length > 1 ? "s" : ""} sur ${
      platforms.length
    } plateforme${platforms.length > 1 ? "s" : ""}, score moyen ${averageScore}/100 et qualité de cohorte ${seedConfidenceSummary(
      seeds,
    )}. Ce niveau sert uniquement à prioriser un test.`,
    limits: buildLimits(seeds, platforms, candidate.repeatedCreative),
    assetPolicy: "official-assets-only",
  };
}

function ideaTemplate(
  pattern: EditorialPattern,
  underlyingPattern: EditorialPattern,
): IdeaTemplate {
  if (pattern === "cross_platform_echo") {
    const base = ideaTemplate(underlyingPattern, "relatable_humour");
    return {
      title: "Un même moment, quatre exécutions natives",
      proposedFormat:
        "Mini-campagne en quatre publications : conserver le même noyau éditorial, puis changer rythme, cadrage et appel à l’action selon le réseau.",
      hook: base.hook,
    };
  }
  if (pattern === "suspense_reveal") {
    return {
      title: "Le détail qui annonce la suite",
      proposedFormat:
        "Teaser en deux temps : un détail tiré d’un asset officiel, puis une révélation courte dans la publication suivante.",
      hook: "Something is changing in the Lofi universe… did you spot it? 👀",
    };
  }
  if (pattern === "music_and_usage") {
    return {
      title: "Choisis ton mode de concentration",
      proposedFormat:
        "Série récurrente « un moment, une ambiance » qui associe un usage précis à un morceau ou une radio existante.",
      hook: "Pick your focus mode: rainy night, cosy café or deep space? 🎧",
    };
  }
  if (pattern === "character_and_lore") {
    return {
      title: "Le micro-épisode caché dans le décor",
      proposedFormat:
        "Micro-épisode sans dialogue, construit avec les personnages et décors officiels, puis question d’observation à la communauté.",
      hook: "You noticed this detail in Lofi Girl’s room, right? 👀",
    };
  }
  if (pattern === "community_conversation") {
    return {
      title: "La question que tout le monde peut compléter",
      proposedFormat:
        "Post participatif à réponse très courte, suivi d’un second contenu qui met en avant une sélection de réponses.",
      hook: "Complete the sentence: today I need lofi to help me ___ ✍️",
    };
  }
  if (pattern === "activation") {
    return {
      title: "Le compte à rebours en trois indices",
      proposedFormat:
        "Séquence de trois contenus courts : indice visuel officiel, indice sonore existant, puis révélation avec une action unique.",
      hook: "Three clues. One reveal. First clue drops now. ⏳",
    };
  }
  return {
    title: "Le moment trop réel pour ne pas le partager",
    proposedFormat:
      "Capsule POV très courte : situation quotidienne reconnaissable, pause comique, puis boucle visuelle réalisée avec les assets officiels.",
    hook: "POV: you opened your notes and forgot everything you studied 😶",
  };
}

function adaptationsFor(
  pattern: EditorialPattern,
): Record<SocialPlatform, PlatformIdeaAdaptation> {
  const callToAction =
    pattern === "community_conversation"
      ? "Terminer par une réponse en un mot."
      : pattern === "suspense_reveal" || pattern === "activation"
        ? "Terminer sur un indice, sans promettre un résultat non confirmé."
        : "Terminer par une invitation légère à réagir.";

  return {
    youtube: {
      format: "Short ou post Communauté natif",
      execution: `Choisir un Short si le signal gagnant repose sur le rythme, ou un post Communauté (texte, image ou sondage) si l’idée appelle une réponse directe. ${callToAction}`,
    },
    instagram: {
      format: "Reel 9:16 ou post statique",
      execution: `Utiliser un Reel pour une scène rythmée, ou un post statique lorsque l’accroche doit être comprise et enregistrée d’un coup d’œil. ${callToAction}`,
    },
    tiktok: {
      format: "Vidéo verticale de 9 à 18 secondes",
      execution: `Commencer directement dans la scène, utiliser un montage plus vif et une légende très courte. ${callToAction}`,
    },
    x: {
      format: "Texte, visuel statique ou clip court",
      execution: `Formuler l’idée en une phrase autonome, puis choisir texte seul, asset officiel statique ou clip selon le signal observé. ${callToAction}`,
    },
  };
}

function buildLimits(
  seeds: readonly RankedPost[],
  platforms: readonly SocialPlatform[],
  repeatedCreative: boolean,
): string[] {
  const limits = [
    "Signal descriptif basé sur les métriques publiques disponibles : il ne prouve pas que le pattern cause la performance.",
    "Aucun visuel généré par IA : utiliser exclusivement les assets officiels Lofi Girl et les créations validées par l’équipe.",
  ];
  if (platforms.length === 1) {
    limits.push(
      `Signal observé uniquement sur ${platformLabel(platforms[0])} ; valider l’idée séparément avant toute généralisation cross-platform.`,
    );
  }
  if (seeds.some((post) => post.confidence === "low")) {
    limits.push(
      "Au moins une seed repose sur une petite cohorte ou peu de métriques ; interpréter la priorité avec prudence.",
    );
  }
  if (seeds.some((post) => post.metricCoverage.length < 3)) {
    limits.push(
      "Certaines métriques publiques sont absentes ; elles n’ont été ni estimées ni remplacées par zéro.",
    );
  }
  if (repeatedCreative) {
    limits.push(
      "La répétition cross-platform peut refléter la campagne, l’audience ou le timing ; seule une variation contrôlée permettra de tester l’hypothèse créative.",
    );
  }
  return limits;
}

function ideaConfidenceScore(
  seeds: readonly RankedPost[],
  platformCount: number,
  repeatedCreative: boolean,
): number {
  const meanPerformance = average(
    seeds.map((post) => post.performanceScore ?? 0),
  );
  const evidenceQuality = average(
    seeds.map((post) => confidenceWeight(post.confidence)),
  );
  const score =
    5 +
    meanPerformance * 0.22 +
    evidenceQuality * 28 +
    Math.min(3, platformCount) * 7 +
    Math.min(4, seeds.length) * 3 +
    (repeatedCreative ? 12 : 0);
  return clamp(Math.round(score), 1, 95);
}

function confidenceLevel(score: number): IdeaConfidence {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function confidenceWeight(confidence: ScoreConfidence): number {
  if (confidence === "high") return 0.95;
  if (confidence === "medium") return 0.7;
  if (confidence === "low") return 0.4;
  return 0;
}

function seedConfidenceSummary(seeds: readonly RankedPost[]): string {
  const counts = new Map<ScoreConfidence, number>();
  for (const seed of seeds) {
    counts.set(seed.confidence, (counts.get(seed.confidence) ?? 0) + 1);
  }
  return (["high", "medium", "low"] as ScoreConfidence[])
    .filter((level) => counts.has(level))
    .map((level) => `${counts.get(level)} ${confidenceLabel(level)}`)
    .join(", ");
}

function confidenceLabel(confidence: ScoreConfidence): string {
  if (confidence === "high") return "forte";
  if (confidence === "medium") return "moyenne";
  if (confidence === "low") return "limitée";
  return "insuffisante";
}

function detectPattern(post: RankedPost): EditorialPattern {
  const value = `${post.title ?? ""} ${post.text ?? ""}`.toLowerCase();
  if (/be ready|coming|soon|tomorrow|wait for|secret|reveal|surprise|👀/.test(value)) {
    return "suspense_reveal";
  }
  if (/maya|lofi girl|lofi boy|character|lore|story|room|cat|pocky/.test(value)) {
    return "character_and_lore";
  }
  if (/release|out now|album|merch|drop|launch|listen now|collab|concert|event|game|fortnite/.test(value)) {
    return "activation";
  }
  if (/tell me|comment|what do you|which|choose|pick|your favourite|your favorite|\?/.test(value)) {
    return "community_conversation";
  }
  if (/radio|beats|music|mix|sleep|study|focus|relax|playlist|lofi/.test(value)) {
    return "music_and_usage";
  }
  return "relatable_humour";
}

function dominantPattern(posts: readonly RankedPost[]): EditorialPattern {
  const counts = new Map<EditorialPattern, number>();
  for (const post of posts) {
    const pattern = detectPattern(post);
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return PATTERN_ORDER.indexOf(left[0]) - PATTERN_ORDER.indexOf(right[0]);
  })[0]?.[0] ?? "relatable_humour";
}

function creativeKey(post: RankedPost): string {
  return `${post.title ?? ""} ${post.text ?? ""}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[\w.]+/g, "")
    .replace(/#[\w-]+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 9)
    .join(" ");
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.repeatedCreative !== right.repeatedCreative) {
    return left.repeatedCreative ? -1 : 1;
  }
  const platformDifference =
    new Set(right.posts.map((post) => post.platform)).size -
    new Set(left.posts.map((post) => post.platform)).size;
  if (platformDifference !== 0) return platformDifference;
  const scoreDifference =
    average(right.posts.map((post) => post.performanceScore ?? 0)) -
    average(left.posts.map((post) => post.performanceScore ?? 0));
  if (scoreDifference !== 0) return scoreDifference;
  if (right.posts.length !== left.posts.length) {
    return right.posts.length - left.posts.length;
  }
  const patternDifference =
    PATTERN_ORDER.indexOf(left.pattern) - PATTERN_ORDER.indexOf(right.pattern);
  return patternDifference || left.key.localeCompare(right.key);
}

function compareSeedPosts(left: RankedPost, right: RankedPost): number {
  if (left.performanceScore !== right.performanceScore) {
    return (right.performanceScore ?? -1) - (left.performanceScore ?? -1);
  }
  const confidenceDifference =
    confidenceWeight(right.confidence) - confidenceWeight(left.confidence);
  if (confidenceDifference !== 0) return confidenceDifference;
  const platformDifference =
    PLATFORM_ORDER.indexOf(left.platform) - PLATFORM_ORDER.indexOf(right.platform);
  if (platformDifference !== 0) return platformDifference;
  return left.externalId.localeCompare(right.externalId);
}

function selectSeeds(posts: readonly RankedPost[], limit: number): RankedPost[] {
  const selected: RankedPost[] = [];
  const seen = new Set<string>();
  for (const platform of PLATFORM_ORDER) {
    const seed = posts.find((post) => post.platform === platform);
    if (!seed) continue;
    selected.push(seed);
    seen.add(`${seed.platform}:${seed.externalId}`);
  }
  for (const post of posts) {
    if (selected.length >= limit) break;
    const key = `${post.platform}:${post.externalId}`;
    if (seen.has(key)) continue;
    selected.push(post);
    seen.add(key);
  }
  return selected.sort(compareSeedPosts).slice(0, limit);
}

function orderedPlatforms(values: readonly SocialPlatform[]): SocialPlatform[] {
  const present = new Set(values);
  return PLATFORM_ORDER.filter((platform) => present.has(platform));
}

function postLabel(post: RankedPost, maxLength: number): string {
  const value = post.title?.trim() || post.text?.trim() || post.externalId;
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function platformLabel(platform: SocialPlatform): string {
  if (platform === "youtube") return "YouTube";
  if (platform === "instagram") return "Instagram";
  if (platform === "tiktok") return "TikTok";
  return "X";
}

function joinFrench(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} et ${values.at(-1)}`;
}

function groupBy<T, K>(values: readonly T[], keyFor: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const current = groups.get(key);
    if (current) current.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return clamp(Math.trunc(value as number), minimum, maximum);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function ideaReferenceTime(
  posts: readonly NormalizedPost[],
  value: Date | string | number | undefined,
): Date {
  if (value !== undefined) {
    const explicit = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isFinite(explicit.getTime())) return explicit;
  }
  const latestPublication = posts.reduce((latest, post) => {
    const timestamp = post.publishedAt ? Date.parse(post.publishedAt) : Number.NaN;
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  return new Date(latestPublication > 0 ? latestPublication + 86_400_000 : 0);
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
