import type { NormalizedPost, SocialPlatform } from "./social-scanner.ts";
import {
  buildEditorialAnalysisMapForTargets,
  editorialPostKey,
  type EditorialWhy,
} from "./social-editorial-analysis.ts";
import {
  rankPostsByPublicMetric,
  type PublicRankingMetric,
} from "./social-ranking.ts";
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

type IdeaRankedPost = RankedPost & {
  publicCohortKey: string;
  publicCohortRank: number;
  publicRankingMetric: Exclude<PublicRankingMetric, null>;
};

type Candidate = {
  key: string;
  pattern: EditorialPattern;
  posts: IdeaRankedPost[];
  repeatedCreative: boolean;
};

type PublicWinnerSelection = {
  eligible: IdeaRankedPost[];
  winners: IdeaRankedPost[];
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
  const winnersPerCohort = boundedInteger(options.winnersPerPlatform, 3, 1, 10);
  const maxIdeas = boundedInteger(options.maxIdeas, 4, 1, 10);
  const ranked = rankPosts(posts, referenceTime);
  const selection = selectPublicWinners(ranked, winnersPerCohort);
  const editorialAnalyses = buildEditorialAnalysisMapForTargets(
    ranked,
    selection.winners.map(editorialPostKey),
  );
  const candidates = buildCandidates(selection.winners, editorialAnalyses).sort(
    (left, right) => compareCandidates(left, right, editorialAnalyses),
  );
  const ideas = candidates
    .slice(0, maxIdeas)
    .map((candidate) => materializeIdea(candidate, editorialAnalyses));

  return {
    generatedAt: referenceTime.toISOString(),
    eligiblePostCount: selection.eligible.length,
    winnerCount: selection.winners.length,
    ideas,
    caveats: [
      "Les idées sont des hypothèses éditoriales issues de signaux descriptifs ; elles ne prédisent pas la performance et ne démontrent aucune causalité.",
      "Les références sont choisies séparément dans chaque combinaison plateforme-format à partir de la métrique publique disponible ; les volumes ne sont jamais comparés entre réseaux.",
      "Aucun visuel généré par IA : utiliser uniquement les assets officiels Lofi Girl et les créations validées par l’équipe.",
    ],
  };
}

export const generateEditorialIdeas = generateSocialIdeas;

function selectPublicWinners(
  posts: readonly RankedPost[],
  winnersPerCohort: number,
): PublicWinnerSelection {
  const cohorts = groupBy(posts, publicCohortKey);
  const eligible: IdeaRankedPost[] = [];
  const winners: IdeaRankedPost[] = [];

  for (const cohortKey of [...cohorts.keys()].sort()) {
    const cohort = cohorts.get(cohortKey) ?? [];
    const ranking = rankPostsByPublicMetric(
      cohort.map((post) => ({
        post,
        external_post_id: post.externalId,
        format: post.format ?? "unknown",
        likes: publicMetric(post.likes),
        views: publicMetric(post.views),
        comments: publicMetric(post.comments),
        shares: publicMetric(post.shares),
        saves: publicMetric(post.saves),
        poll_votes: pollVotes(post),
      })),
    );
    if (ranking.metric === null) continue;

    const rankable = ranking.posts.filter(
      (entry) => entry[ranking.metric!] !== null,
    );
    const cohortPosts = rankable.map(
      (entry, index): IdeaRankedPost => ({
        ...entry.post,
        publicCohortKey: cohortKey,
        publicCohortRank: index + 1,
        publicRankingMetric: ranking.metric!,
      }),
    );
    eligible.push(...cohortPosts);
    winners.push(...cohortPosts.slice(0, winnersPerCohort));
  }

  return {
    eligible: eligible.sort(compareSeedPosts),
    winners: winners.sort(compareSeedPosts),
  };
}

function summarizeObservedSignal(
  candidate: Candidate,
  seeds: readonly IdeaRankedPost[],
  analyses: readonly EditorialWhy[],
): string {
  const cohortLabels = uniqueStrings(seeds.map(cohortDisplayLabel));
  const readings = uniqueStrings(
    analyses
      .filter((analysis) => analysis.primarySignal !== "insufficient")
      .map((analysis) => analysis.headline),
  );
  const editorialReading = readings.length
    ? `La lecture commune est : ${joinFrench(
        readings.slice(0, 2).map((reading) => `« ${reading} »`),
      )}.`
    : "Le texte public reste trop pauvre pour préciser davantage le mécanisme sans inventer.";

  if (candidate.repeatedCreative) {
    return `Une accroche quasi identique réapparaît dans ${joinFrench(
      cohortLabels,
    )}. ${editorialReading}`;
  }
  return `${seeds.length} publication${seeds.length > 1 ? "s" : ""} de ${joinFrench(
    cohortLabels,
  )} partage${seeds.length > 1 ? "nt" : ""} le ressort « ${
    PATTERN_LABELS[candidate.pattern]
  } ». ${editorialReading}`;
}

function confidenceRationale(
  seeds: readonly IdeaRankedPost[],
  analyses: readonly EditorialWhy[],
  repeatedCreative: boolean,
): string {
  const platformCount = new Set(seeds.map((post) => post.platform)).size;
  const cohortCount = new Set(seeds.map((post) => post.publicCohortKey)).size;
  const comparativeCount = analyses.filter(
    (analysis) => analysis.status === "comparative",
  ).length;
  const comparisonCopy = comparativeCount
    ? `${comparativeCount} lecture${comparativeCount > 1 ? "s" : ""} dispose${
        comparativeCount > 1 ? "nt" : ""
      } d’un contre-exemple éditorial dans la même catégorie.`
    : "Les lectures reposent surtout sur le contenu lui-même, faute de contre-exemple assez proche.";
  const echoCopy = repeatedCreative
    ? "La répétition de l’accroche sur plusieurs réseaux renforce la piste, sans prouver sa causalité."
    : "Le signal doit encore être validé par une variation éditoriale contrôlée.";

  return `${seeds.length} exemple${seeds.length > 1 ? "s" : ""} issu${
    seeds.length > 1 ? "s" : ""
  } de ${cohortCount} catégorie${cohortCount > 1 ? "s" : ""} exacte${
    cohortCount > 1 ? "s" : ""
  } sur ${platformCount} plateforme${platformCount > 1 ? "s" : ""}. ${comparisonCopy} ${echoCopy} Ce niveau sert uniquement à prioriser un test.`;
}

function buildCandidates(
  winners: readonly IdeaRankedPost[],
  analyses: ReadonlyMap<string, EditorialWhy>,
): Candidate[] {
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

  const patternGroups = groupBy(winners, (post) =>
    patternForAnalysis(post, analyses.get(editorialPostKey(post))),
  );
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

function materializeIdea(
  candidate: Candidate,
  analyses: ReadonlyMap<string, EditorialWhy>,
): SocialIdea {
  const seeds = selectSeeds(candidate.posts, 5);
  const platforms = orderedPlatforms(seeds.map((post) => post.platform));
  const seedAnalyses = seeds
    .map((post) => analyses.get(editorialPostKey(post)))
    .filter((analysis): analysis is EditorialWhy => analysis !== undefined);
  const confidenceScore = ideaConfidenceScore(
    seeds,
    seedAnalyses,
    candidate.repeatedCreative,
  );
  const template = ideaTemplate(
    candidate.pattern,
    dominantPattern(seeds, analyses),
  );
  const evidence = seeds.map((post) => {
    const analysis = analyses.get(editorialPostKey(post));
    const reading = analysis?.headline ?? "Lecture éditoriale à compléter";
    return `${cohortDisplayLabel(post)} · « ${postLabel(post, 80)} » · ${reading} · ${post.url}`;
  });
  const observedSignal = summarizeObservedSignal(
    candidate,
    seeds,
    seedAnalyses,
  );

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
    confidenceRationale: confidenceRationale(
      seeds,
      seedAnalyses,
      candidate.repeatedCreative,
    ),
    limits: buildLimits(
      seeds,
      platforms,
      seedAnalyses,
      candidate.repeatedCreative,
    ),
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
  seeds: readonly IdeaRankedPost[],
  platforms: readonly SocialPlatform[],
  analyses: readonly EditorialWhy[],
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
  if (analyses.some((analysis) => analysis.confidence === "low")) {
    limits.push(
      "Au moins une lecture repose sur une petite cohorte ou sur une matière éditoriale limitée ; interpréter la priorité avec prudence.",
    );
  }
  for (const limitation of uniqueStrings(
    analyses.flatMap((analysis) => analysis.limitations),
  ).slice(0, 2)) {
    limits.push(limitation);
  }
  if (repeatedCreative) {
    limits.push(
      "La répétition cross-platform peut refléter la campagne, l’audience ou le timing ; seule une variation contrôlée permettra de tester l’hypothèse créative.",
    );
  }
  return limits;
}

function ideaConfidenceScore(
  seeds: readonly IdeaRankedPost[],
  analyses: readonly EditorialWhy[],
  repeatedCreative: boolean,
): number {
  const platformCount = new Set(seeds.map((post) => post.platform)).size;
  const cohortCount = new Set(seeds.map((post) => post.publicCohortKey)).size;
  const evidenceQuality = average(analyses.map(editorialConfidenceWeight));
  const comparisonQuality = average(analyses.map(editorialStatusWeight));
  const score =
    10 +
    evidenceQuality * 25 +
    comparisonQuality * 20 +
    Math.min(3, cohortCount) * 6 +
    Math.min(3, platformCount) * 5 +
    Math.min(4, seeds.length) * 3 +
    (repeatedCreative ? 12 : 0);
  return clamp(Math.round(score), 1, 95);
}

function confidenceLevel(score: number): IdeaConfidence {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function editorialConfidenceWeight(analysis: EditorialWhy): number {
  return analysis.confidence === "medium" ? 0.8 : 0.4;
}

function editorialStatusWeight(analysis: EditorialWhy): number {
  if (analysis.status === "comparative") return 1;
  if (analysis.status === "content-only") return 0.65;
  return 0.35;
}

function analysisWeight(analysis: EditorialWhy | undefined): number {
  if (!analysis) return 0;
  return editorialConfidenceWeight(analysis) + editorialStatusWeight(analysis);
}

function patternForAnalysis(
  post: IdeaRankedPost,
  analysis: EditorialWhy | undefined,
): EditorialPattern {
  const signal = analysis?.primarySignal ?? "insufficient";
  if (
    signal === "absurd_poll" ||
    signal === "co_creation" ||
    signal === "identity_choice"
  ) {
    return "community_conversation";
  }
  if (signal === "immersive_activation") return "activation";
  if (signal === "fourth_wall" || signal === "narrative_open_loop") {
    return "suspense_reveal";
  }
  if (signal === "cultural_bridge") return "character_and_lore";
  if (signal === "commercial_copy") {
    return hasExplicitMusicOffer(post) ? "music_and_usage" : "activation";
  }
  return "relatable_humour";
}

function dominantPattern(
  posts: readonly IdeaRankedPost[],
  analyses: ReadonlyMap<string, EditorialWhy>,
): EditorialPattern {
  const counts = new Map<EditorialPattern, number>();
  for (const post of posts) {
    const pattern = patternForAnalysis(
      post,
      analyses.get(editorialPostKey(post)),
    );
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return PATTERN_ORDER.indexOf(left[0]) - PATTERN_ORDER.indexOf(right[0]);
  })[0]?.[0] ?? "relatable_humour";
}

function hasExplicitMusicOffer(post: IdeaRankedPost): boolean {
  const copy = `${post.title ?? ""} ${post.text ?? ""}`
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@[\w.]+/g, " ")
    .replace(/#[\w-]+/g, " ")
    .toLowerCase();
  return /\b(?:radio|beats?|music|mix|playlist|soundtrack|album|ep|tracks?|listen|streaming)\b/.test(
    copy,
  );
}

function creativeKey(post: IdeaRankedPost): string {
  return (post.text?.trim() || post.title?.trim() || "")
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

function compareCandidates(
  left: Candidate,
  right: Candidate,
  analyses: ReadonlyMap<string, EditorialWhy>,
): number {
  if (left.repeatedCreative !== right.repeatedCreative) {
    return left.repeatedCreative ? -1 : 1;
  }
  const platformDifference =
    new Set(right.posts.map((post) => post.platform)).size -
    new Set(left.posts.map((post) => post.platform)).size;
  if (platformDifference !== 0) return platformDifference;
  const cohortDifference =
    new Set(right.posts.map((post) => post.publicCohortKey)).size -
    new Set(left.posts.map((post) => post.publicCohortKey)).size;
  if (cohortDifference !== 0) return cohortDifference;
  const evidenceDifference =
    average(
      right.posts.map((post) =>
        analysisWeight(analyses.get(editorialPostKey(post))),
      ),
    ) -
    average(
      left.posts.map((post) =>
        analysisWeight(analyses.get(editorialPostKey(post))),
      ),
    );
  if (evidenceDifference !== 0) return evidenceDifference;
  if (right.posts.length !== left.posts.length) {
    return right.posts.length - left.posts.length;
  }
  const patternDifference =
    PATTERN_ORDER.indexOf(left.pattern) - PATTERN_ORDER.indexOf(right.pattern);
  return patternDifference || left.key.localeCompare(right.key);
}

function compareSeedPosts(left: IdeaRankedPost, right: IdeaRankedPost): number {
  const platformDifference =
    PLATFORM_ORDER.indexOf(left.platform) - PLATFORM_ORDER.indexOf(right.platform);
  if (platformDifference !== 0) return platformDifference;
  const formatDifference = canonicalFormat(left.format).localeCompare(
    canonicalFormat(right.format),
  );
  if (formatDifference !== 0) return formatDifference;
  if (left.publicCohortRank !== right.publicCohortRank) {
    return left.publicCohortRank - right.publicCohortRank;
  }
  return left.externalId.localeCompare(right.externalId);
}

function selectSeeds(
  posts: readonly IdeaRankedPost[],
  limit: number,
): IdeaRankedPost[] {
  const selected: IdeaRankedPost[] = [];
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

function publicCohortKey(post: Pick<RankedPost, "platform" | "format">): string {
  return `${post.platform}:${canonicalFormat(post.format)}`;
}

function canonicalFormat(value: string | null): string {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "unknown";
}

function publicMetric(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function pollVotes(post: RankedPost): number | null {
  const raw = post.raw;
  if (!raw) return null;
  const value =
    typeof raw.pollVotes === "number"
      ? raw.pollVotes
      : typeof raw.pollTotalVotes === "number"
        ? raw.pollTotalVotes
        : null;
  return publicMetric(value);
}

function cohortDisplayLabel(post: IdeaRankedPost): string {
  const format = canonicalFormat(post.format)
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
  return `${platformLabel(post.platform)} · ${format || "Format inconnu"}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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
