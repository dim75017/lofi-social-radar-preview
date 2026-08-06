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
  primaryPlatform: SocialPlatform;
  platformRank: number;
  potentialScore: number;
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
  primaryPlatform: SocialPlatform;
  recipe: IdeaTemplate | null;
  patternMatch: boolean;
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

type PlatformRecipe = IdeaTemplate & {
  key: string;
  pattern: EditorialPattern;
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

const PLATFORM_RECIPES = {
  youtube: [
    {
      key: "desk-reset-loop",
      pattern: "relatable_humour",
      title: "Le reset de bureau qui boucle parfaitement",
      proposedFormat: "Short de 12 à 15 secondes : bureau chaotique, geste de reset, puis retour invisible au premier plan.",
      hook: "POV: one tiny desk reset and suddenly the whole night feels possible ✨",
    },
    {
      key: "focus-mode-poll",
      pattern: "community_conversation",
      title: "Le sondage des quatre modes de concentration",
      proposedFormat: "Sondage Communauté avec quatre choix concrets : pluie, café, espace ou nuit calme, puis résultat commenté le lendemain.",
      hook: "Choose tonight’s focus mode — we’ll build the next session around the winner 🎧",
    },
    {
      key: "room-detail-reveal",
      pattern: "character_and_lore",
      title: "Le détail de la chambre révélé en deux posts",
      proposedFormat: "Short macro sur un objet officiel, suivi d’un post Communauté image qui révèle sa place dans le décor.",
      hook: "This has been in her room for years… but did you ever notice it? 👀",
    },
    {
      key: "soundtrack-choice",
      pattern: "music_and_usage",
      title: "Le choix de bande-son pour une scène précise",
      proposedFormat: "Post Communauté avec une scène officielle et trois ambiances existantes à choisir pour l’accompagner.",
      hook: "Which soundtrack belongs to this exact moment: soft piano, rainy beats or night jazz?",
    },
    {
      key: "three-frame-countdown",
      pattern: "activation",
      title: "Le compte à rebours en trois images",
      proposedFormat: "Trois posts Communauté espacés de 24 heures : texture, silhouette, puis révélation et lien unique.",
      hook: "Three days. Three clues. Here is the first one. ⏳",
    },
    {
      key: "study-session-before-after",
      pattern: "relatable_humour",
      title: "L’avant-après d’une session qui devait durer dix minutes",
      proposedFormat: "Short en deux plans horodatés, avec une ellipse comique et une boucle sur la même posture.",
      hook: "I’ll study for ten minutes — cut to three hours later 😶",
    },
    {
      key: "character-night-routine",
      pattern: "character_and_lore",
      title: "La routine nocturne d’un personnage secondaire",
      proposedFormat: "Short sans dialogue en trois gestes, chacun tiré d’assets et de comportements déjà établis.",
      hook: "What happens in the Lofi universe after everyone else goes to sleep? 🌙",
    },
    {
      key: "finish-the-sentence",
      pattern: "community_conversation",
      title: "La phrase que la communauté termine",
      proposedFormat: "Post Communauté texte à réponse courte, puis image récapitulative avec une sélection de réponses créditées.",
      hook: "Finish the sentence: today I need lofi to help me ___.",
    },
    {
      key: "radio-sound-clue",
      pattern: "suspense_reveal",
      title: "L’indice sonore caché dans un Short",
      proposedFormat: "Short de moins de 15 secondes centré sur un son existant, sans révéler immédiatement le projet associé.",
      hook: "You have heard this sound before… just not like this. 🔍",
    },
    {
      key: "study-break-checkin",
      pattern: "community_conversation",
      title: "Le check-in d’étude en un mot",
      proposedFormat: "Post Communauté texte qui demande un seul mot sur l’état du moment, puis réponse humaine de l’équipe à une sélection de commentaires.",
      hook: "One-word study check-in: how is your brain doing right now?",
    },
    {
      key: "release-cover-ab",
      pattern: "activation",
      title: "Le test A/B de couverture avant révélation",
      proposedFormat: "Sondage Communauté entre deux recadrages d’un même asset officiel, sans présenter le vote comme une promesse de sortie.",
      hook: "Same world, two moods — which crop pulls you in first? A or B?",
    },
    {
      key: "ambient-switch",
      pattern: "music_and_usage",
      title: "La transition d’ambiance sans couper le plan",
      proposedFormat: "Short avant-après : le même plan officiel passe progressivement du jour à la nuit pendant que deux extraits existants s’enchaînent, sans vote.",
      hook: "Same desk, one seamless switch from daytime focus to late-night calm.",
    },
    {
      key: "hidden-object-hunt",
      pattern: "suspense_reveal",
      title: "La chasse à l’objet caché dans le décor",
      proposedFormat: "Post Communauté image en haute définition, réponse masquée pendant 24 heures, puis zoom de révélation.",
      hook: "There is one object in this room that should not be here. Can you find it?",
    },
  ],
  instagram: [
    {
      key: "carousel-study-ritual",
      pattern: "music_and_usage",
      title: "Le carrousel d’un rituel d’étude en cinq gestes",
      proposedFormat: "Carrousel 4:5 : préparer la boisson, choisir le morceau, ranger le bureau, lancer le minuteur, commencer.",
      hook: "Save this five-step ritual for the next time starting feels harder than studying.",
    },
    {
      key: "reel-seamless-window",
      pattern: "relatable_humour",
      title: "La fenêtre qui passe du jour à la nuit en une boucle",
      proposedFormat: "Reel 9:16 de 9 secondes avec transition masquée par le personnage et retour au premier photogramme.",
      hook: "You looked away for one second and somehow it is already midnight 🌙",
    },
    {
      key: "character-object-carousel",
      pattern: "character_and_lore",
      title: "Trois objets qui racontent un personnage",
      proposedFormat: "Carrousel de trois détails officiels, chacun accompagné d’une phrase de lore strictement validée.",
      hook: "Three small objects, three clues about a character you already know.",
    },
    {
      key: "story-choice-reel-payoff",
      pattern: "community_conversation",
      title: "Le choix en carrousel qui décide du Reel suivant",
      proposedFormat: "Carrousel statique à deux options, puis Reel montrant les deux pistes avec la gagnante en ouverture.",
      hook: "You choose the next scene: rainy library or late-night train?",
    },
    {
      key: "nine-tile-clue",
      pattern: "suspense_reveal",
      title: "L’indice découpé en grille de neuf cases",
      proposedFormat: "Carrousel carré dont chaque slide révèle une zone supplémentaire d’un asset officiel jusqu’au plan complet.",
      hook: "Nine pieces. One familiar place. How early can you guess it?",
    },
    {
      key: "sound-on-sound-off",
      pattern: "music_and_usage",
      title: "Le Reel qui change de sens avec le son",
      proposedFormat: "Reel court lisible sans audio, enrichi par un morceau existant qui apporte une seconde lecture émotionnelle.",
      hook: "Watch once without sound, then again with headphones. It feels like a different scene.",
    },
    {
      key: "notes-app-confession",
      pattern: "relatable_humour",
      title: "La confession étude en capture de notes",
      proposedFormat: "Post statique typographique intégré à l’univers visuel officiel, avec une phrase très courte et partageable.",
      hook: "Not to flex but I moved one task from ‘to do’ to ‘done’ today.",
    },
    {
      key: "seasonal-room-swap",
      pattern: "character_and_lore",
      title: "Le décor qui change avec la saison",
      proposedFormat: "Carrousel avant/après d’un même cadrage officiel, limité à des variations d’assets validées par l’équipe.",
      hook: "Same room, new season. Which tiny change makes it feel different to you?",
    },
    {
      key: "comment-to-visual",
      pattern: "community_conversation",
      title: "Le commentaire transformé en visuel officiel",
      proposedFormat: "Sélection hebdomadaire d’une réponse, recomposée dans un gabarit maison sans modifier son sens.",
      hook: "Your words, our next little scene — leave one sentence for Lofi Girl.",
    },
    {
      key: "three-second-reveal",
      pattern: "activation",
      title: "La révélation arrêtée à trois secondes",
      proposedFormat: "Reel teaser qui coupe juste avant l’information centrale, suivie d’un post statique daté et explicite.",
      hook: "Pause at exactly 0:03. The clue is already there.",
    },
    {
      key: "outfit-detail-vote",
      pattern: "community_conversation",
      title: "Le vote sur un détail de tenue",
      proposedFormat: "Carrousel de deux détails issus d’assets officiels, avec choix A/B en légende puis résultat dans un commentaire épinglé.",
      hook: "One tiny detail changes the whole mood — A or B?",
    },
    {
      key: "album-mood-board",
      pattern: "activation",
      title: "Le moodboard officiel d’une sortie",
      proposedFormat: "Carrousel de textures, couleurs et détails existants reliés à une sortie confirmée, sans fausse promesse.",
      hook: "The colors, places and quiet moments behind the next chapter.",
    },
    {
      key: "micro-progress-saveable",
      pattern: "relatable_humour",
      title: "La petite victoire à enregistrer pour plus tard",
      proposedFormat: "Post statique 4:5 avec une micro-victoire précise, lisible en une seconde et prolongée par un Reel court.",
      hook: "Small progress still counts — save this for the day you forget.",
    },
  ],
  tiktok: [
    {
      key: "graduation-pov-remix",
      pattern: "relatable_humour",
      title: "Le POV de petite victoire inattendue",
      proposedFormat: "Vidéo 9:16 de 8 à 12 secondes : attente sérieuse, rupture absurde, réaction en boucle avec asset officiel.",
      hook: "POV: you finished the task you have been avoiding for three weeks 🎓",
    },
    {
      key: "one-second-room-cuts",
      pattern: "character_and_lore",
      title: "La chambre racontée en coupes d’une seconde",
      proposedFormat: "Montage de six détails officiels, une seconde chacun, avec le dernier plan qui recontextualise les précédents.",
      hook: "Six details from one room — the last one changes the whole story.",
    },
    {
      key: "choose-the-next-frame",
      pattern: "community_conversation",
      title: "La communauté choisit le plan suivant",
      proposedFormat: "Vidéo arrêtée sur deux directions possibles ; la suite publiée reprend explicitement l’option majoritaire.",
      hook: "What happens next: open the letter or follow the cat? You decide.",
    },
    {
      key: "beat-drop-transition",
      pattern: "music_and_usage",
      title: "La transition de décor calée sur un beat existant",
      proposedFormat: "Vidéo de 9 secondes avec une seule transition sur l’accent musical, sans multiplier les effets.",
      hook: "Wait for the beat — the whole study mood changes in one frame.",
    },
    {
      key: "three-clue-fast-cut",
      pattern: "activation",
      title: "Les trois indices en montage ultra-court",
      proposedFormat: "Trois plans de deux secondes, texte minimal, puis écran final avec date uniquement si elle est confirmée.",
      hook: "Clue one. Clue two. Clue three. What do you think is coming?",
    },
    {
      key: "forgot-the-notes-loop",
      pattern: "relatable_humour",
      title: "Le moment où les notes ne veulent plus rien dire",
      proposedFormat: "Sketch visuel de moins de 10 secondes : confiance, lecture des notes, silence, retour en boucle.",
      hook: "POV: you read your own notes and they look like ancient runes.",
    },
    {
      key: "character-point-of-view",
      pattern: "character_and_lore",
      title: "La scène vue par un autre personnage",
      proposedFormat: "Réutilisation d’une scène officielle avec cadrage subjectif différent et un détail narratif validé.",
      hook: "You have seen this moment before — but never from this side of the room.",
    },
    {
      key: "comment-reply-scene",
      pattern: "community_conversation",
      title: "La réponse vidéo à une question de la communauté",
      proposedFormat: "Réponse native à un commentaire sélectionné, avec la question visible et une scène officielle comme réponse.",
      hook: "You asked what she does during study breaks. Here is the answer.",
    },
    {
      key: "soundtrack-for-task",
      pattern: "music_and_usage",
      title: "Une tâche précise, une ambiance précise",
      proposedFormat: "Série de clips courts associant une tâche concrète à un morceau existant, avec intitulé dès la première frame.",
      hook: "A soundtrack for cleaning your tabs before they become a second desktop.",
    },
    {
      key: "blink-and-miss-clue",
      pattern: "suspense_reveal",
      title: "L’indice visible pendant une seule frame",
      proposedFormat: "Vidéo courte avec un indice officiel furtif, puis replay ralenti publié dans la même vidéo.",
      hook: "Do not blink. The clue is on screen for exactly one frame.",
    },
    {
      key: "study-timer-challenge",
      pattern: "community_conversation",
      title: "Le défi minuteur sans promesse de productivité",
      proposedFormat: "Invitation légère à lancer un minuteur de 15 minutes, puis commentaire épinglé pour partager son état réel.",
      hook: "Fifteen quiet minutes. No perfect routine — just start where you are.",
    },
    {
      key: "portal-transition",
      pattern: "suspense_reveal",
      title: "La transition portail entre deux univers",
      proposedFormat: "Match cut entre deux décors officiels reliés par une forme ou une couleur commune, sans ajouter de lore non validé.",
      hook: "Two rooms, one shape, and a connection we almost missed.",
    },
    {
      key: "release-day-micro-story",
      pattern: "activation",
      title: "La micro-histoire du jour de sortie",
      proposedFormat: "Vidéo de 12 à 18 secondes : préparation, attente, puis information de sortie confirmée en dernière frame.",
      hook: "The quiet moment right before a new chapter goes live.",
    },
  ],
  x: [
    {
      key: "one-line-study-truth",
      pattern: "relatable_humour",
      title: "La vérité d’étude en une seule ligne",
      proposedFormat: "Post texte autonome de moins de 120 caractères, sans hashtag, construit autour d’une observation très précise.",
      hook: "opened the document. that counts as progress.",
    },
    {
      key: "four-option-reply",
      pattern: "community_conversation",
      title: "La question à quatre réponses instantanées",
      proposedFormat: "Post texte avec quatre choix identifiés par emoji et invitation à répondre uniquement avec l’emoji choisi.",
      hook: "your focus weather tonight: 🌧️ rainy / 🌙 late / ☕ cosy / 🚀 deep space",
    },
    {
      key: "cropped-clue-image",
      pattern: "suspense_reveal",
      title: "L’image recadrée qui cache presque tout",
      proposedFormat: "Visuel statique issu d’un asset officiel, recadré sur un détail, puis réponse avec le plan complet 24 heures plus tard.",
      hook: "you know this place. probably. one clue: look at the light.",
    },
    {
      key: "track-for-moment",
      pattern: "music_and_usage",
      title: "Le morceau associé à un moment ultra-précis",
      proposedFormat: "Post texte court qui nomme une situation concrète et renvoie vers un morceau ou une radio existante.",
      hook: "soundtrack for closing every tab except the one you actually need 🎧",
    },
    {
      key: "character-diary-line",
      pattern: "character_and_lore",
      title: "Une ligne de journal d’un personnage",
      proposedFormat: "Post texte écrit uniquement à partir d’un fait de lore validé, accompagné si utile d’un détail officiel.",
      hook: "today the room felt quieter, but the light stayed on a little longer.",
    },
    {
      key: "three-post-clue-thread",
      pattern: "activation",
      title: "La séquence de trois indices sans thread long",
      proposedFormat: "Trois posts autonomes publiés à intervalles fixes, chacun apportant une information vérifiable supplémentaire.",
      hook: "clue 1/3: it has been hiding in plain sight since the beginning.",
    },
    {
      key: "tiny-win-roll-call",
      pattern: "community_conversation",
      title: "L’appel aux petites victoires du jour",
      proposedFormat: "Question texte à réponse libre courte, puis réponse du compte à une sélection sans classement artificiel.",
      hook: "tiny win roll call — what did you manage to do today?",
    },
    {
      key: "before-after-caption",
      pattern: "relatable_humour",
      title: "Le diptyque avant/après avec légende sèche",
      proposedFormat: "Deux images officielles côte à côte et une légende d’une ligne qui porte seule la rupture comique.",
      hook: "me at 8pm: one more task / me at 8:04pm: emotionally offline",
    },
    {
      key: "quote-the-community",
      pattern: "community_conversation",
      title: "La réponse de communauté remise au centre",
      proposedFormat: "Citation d’une réponse avec accord et crédit, suivie d’une question qui prolonge précisément son idée.",
      hook: "this reply described the feeling better than we could — what would you add?",
    },
    {
      key: "same-image-two-captions",
      pattern: "relatable_humour",
      title: "Le même visuel avec deux lectures opposées",
      proposedFormat: "Deux posts espacés utilisant le même asset officiel avec des légendes de contexte différentes, sans dupliquer le message.",
      hook: "same desk, different caption: focused night / avoiding one email",
    },
    {
      key: "lore-fact-or-theory",
      pattern: "character_and_lore",
      title: "Le vrai fait de lore face à une théorie",
      proposedFormat: "Post A/B distinguant explicitement un fait confirmé d’une hypothèse de communauté, puis réponse sourcée.",
      hook: "one is confirmed lore, one is a community theory — which is which?",
    },
    {
      key: "release-reminder-human",
      pattern: "activation",
      title: "Le rappel de sortie sans langage publicitaire",
      proposedFormat: "Post texte factuel avec date, heure et lien, précédé d’une observation humaine liée au projet.",
      hook: "a quiet reminder: the next chapter arrives tomorrow at the time below.",
    },
    {
      key: "night-question-image",
      pattern: "music_and_usage",
      title: "La question de fin de soirée avec un seul visuel",
      proposedFormat: "Visuel nocturne officiel et question sur l’usage réel de la musique, sans demander plusieurs actions.",
      hook: "what are these beats helping you finish tonight?",
    },
  ],
} as const satisfies Record<SocialPlatform, readonly PlatformRecipe[]>;

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
  const maxIdeas = boundedInteger(options.maxIdeas, 4, 1, 50);
  const performancePosts = posts.filter((post) => !isCommentSeed(post));
  const ranked = rankPosts(performancePosts, referenceTime);
  const selection = selectPublicWinners(ranked, winnersPerCohort);
  const editorialAnalyses = buildEditorialAnalysisMapForTargets(
    ranked,
    selection.winners.map(editorialPostKey),
  );
  const candidates = buildCandidates(selection.winners, editorialAnalyses);
  const materializedIdeas = selectBalancedCandidates(
    candidates,
    maxIdeas,
    editorialAnalyses,
  )
    .map((candidate) => materializeIdea(candidate, editorialAnalyses));
  const platformRanks = new Map<string, number>();
  for (const platform of PLATFORM_ORDER) {
    materializedIdeas
      .filter((idea) => idea.primaryPlatform === platform)
      .sort((left, right) =>
        right.potentialScore - left.potentialScore || left.id.localeCompare(right.id),
      )
      .forEach((idea, index) => platformRanks.set(idea.id, index + 1));
  }
  const ideas = materializedIdeas.map((idea) => ({
    ...idea,
    platformRank: platformRanks.get(idea.id) ?? 1,
  }));

  return {
    generatedAt: referenceTime.toISOString(),
    eligiblePostCount: selection.eligible.length,
    winnerCount: selection.winners.length,
    ideas,
    caveats: [
      "Les idées sont des hypothèses éditoriales issues de signaux descriptifs ; elles ne prédisent pas la performance et ne démontrent aucune causalité.",
      "Les références sont choisies séparément dans chaque combinaison plateforme-format à partir de la métrique publique disponible ; les volumes ne sont jamais comparés entre réseaux.",
      "Aucun visuel ni aucune musique générés par IA : utiliser uniquement les assets officiels Lofi Girl, les morceaux existants et les créations humaines validées par l’équipe.",
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

  if (!candidate.patternMatch) {
    return `Aucun post gagnant de ${platformLabel(candidate.primaryPlatform)} ne documente directement le ressort « ${
      PATTERN_LABELS[candidate.pattern]
    } ». Les ${seeds.length} référence${seeds.length > 1 ? "s" : ""} servent uniquement de niveau de comparaison sur la plateforme : cette idée est un test exploratoire, pas la reproduction d’une recette déjà prouvée.`;
  }

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
  patternMatch: boolean,
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

  const matchCopy = patternMatch
    ? "Le ressort proposé apparaît directement dans les références."
    : "Aucun précédent direct du ressort proposé n’a été identifié : conserver cette piste en exploration.";
  return `${matchCopy} ${seeds.length} exemple${seeds.length > 1 ? "s" : ""} issu${
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
      primaryPlatform: primaryPlatformFor(group),
      recipe: null,
      patternMatch: true,
    });
  }

  const winnersByPlatform = groupBy(winners, (post) => post.platform);
  for (const platform of PLATFORM_ORDER) {
    const platformWinners = (winnersByPlatform.get(platform) ?? []).sort(
      compareSeedPosts,
    );
    if (platformWinners.length === 0) continue;
    const postsByPattern = groupBy(platformWinners, (post) =>
      patternForAnalysis(post, analyses.get(editorialPostKey(post))),
    );
    for (const [recipeIndex, recipe] of PLATFORM_RECIPES[platform].entries()) {
      const exactMatches = postsByPattern.get(recipe.pattern) ?? [];
      const source = exactMatches.length > 0 ? exactMatches : platformWinners;
      const rotated = rotate(source, recipeIndex % source.length);
      candidates.push({
        key: `recipe:${platform}:${recipe.key}`,
        pattern: recipe.pattern,
        posts: rotated.slice(0, Math.min(3, rotated.length)),
        repeatedCreative: false,
        primaryPlatform: platform,
        recipe,
        patternMatch: exactMatches.length > 0,
      });
    }
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
  const rawConfidenceScore = ideaConfidenceScore(
    seeds,
    seedAnalyses,
    candidate.repeatedCreative,
  );
  const confidenceScore = candidate.patternMatch
    ? rawConfidenceScore
    : Math.min(rawConfidenceScore, 45);
  const template =
    candidate.recipe ??
    ideaTemplate(candidate.pattern, dominantPattern(seeds, analyses));
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
    // The recipe key remains stable when a newer winning post replaces a seed,
    // so past decisions and planning slots keep training the same concept.
    id: `idea-${candidate.primaryPlatform}-${stableHash(candidate.key)}`,
    title: template.title,
    pattern: candidate.pattern,
    primaryPlatform: candidate.primaryPlatform,
    platformRank: 1,
    potentialScore: ideaPotentialScore(
      seeds,
      confidenceScore,
      candidate.patternMatch,
      candidate.repeatedCreative,
    ),
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
      candidate.patternMatch,
    ),
    limits: buildLimits(
      seeds,
      platforms,
      seedAnalyses,
      candidate.repeatedCreative,
      candidate.patternMatch,
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
  patternMatch: boolean,
): string[] {
  const limits = [
    "Signal descriptif basé sur les métriques publiques disponibles : il ne prouve pas que le pattern cause la performance.",
    "Aucun visuel ni aucune musique générés par IA : utiliser exclusivement les assets officiels Lofi Girl, les morceaux existants et les créations humaines validées par l’équipe.",
  ];
  if (!patternMatch) {
    limits.push(
      "Piste exploratoire sans précédent direct identifié dans les posts gagnants de la plateforme.",
    );
  }
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

function ideaPotentialScore(
  seeds: readonly IdeaRankedPost[],
  confidenceScore: number,
  patternMatch: boolean,
  repeatedCreative: boolean,
): number {
  const rankQuality = average(
    seeds.map((post) => 1 / Math.max(1, post.publicCohortRank)),
  );
  const performanceQuality = average(
    seeds.map((post) => clamp((post.performanceScore ?? 0) / 100, 0, 1)),
  );
  const score =
    confidenceScore * 0.55 +
    rankQuality * 20 +
    performanceQuality * 12 +
    (patternMatch ? 8 : 3) +
    (repeatedCreative ? 5 : 0);
  return clamp(Math.round(score), 1, 100);
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

function selectBalancedCandidates(
  candidates: readonly Candidate[],
  limit: number,
  analyses: ReadonlyMap<string, EditorialWhy>,
): Candidate[] {
  const compare = (left: Candidate, right: Candidate) =>
    compareCandidates(left, right, analyses);
  const crossPlatform = candidates
    .filter((candidate) => candidate.repeatedCreative)
    .sort(compare);
  const queues = new Map(
    PLATFORM_ORDER.map((platform) => [
      platform,
      candidates
        .filter(
          (candidate) =>
            !candidate.repeatedCreative &&
            candidate.primaryPlatform === platform,
        )
        .sort(compare),
    ]),
  );
  const selected: Candidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: Candidate | undefined) => {
    if (!candidate || selected.length >= limit || seen.has(candidate.key)) return;
    selected.push(candidate);
    seen.add(candidate.key);
  };

  // A repeated creative across networks is the strongest cross-platform proof,
  // but keeping only the best one prevents it from crowding out native recipes.
  add(crossPlatform[0]);
  while (selected.length < limit) {
    let added = false;
    for (const platform of PLATFORM_ORDER) {
      const queue = queues.get(platform);
      const candidate = queue?.shift();
      if (!candidate) continue;
      add(candidate);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  for (const candidate of crossPlatform.slice(1)) add(candidate);
  return selected;
}

function compareCandidates(
  left: Candidate,
  right: Candidate,
  analyses: ReadonlyMap<string, EditorialWhy>,
): number {
  if (left.repeatedCreative !== right.repeatedCreative) {
    return left.repeatedCreative ? -1 : 1;
  }
  if (left.patternMatch !== right.patternMatch) {
    return left.patternMatch ? -1 : 1;
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

function primaryPlatformFor(posts: readonly IdeaRankedPost[]): SocialPlatform {
  return [...posts].sort((left, right) => {
    if (left.publicCohortRank !== right.publicCohortRank) {
      return left.publicCohortRank - right.publicCohortRank;
    }
    return compareSeedPosts(left, right);
  })[0]?.platform ?? "youtube";
}

function rotate<T>(values: readonly T[], offset: number): T[] {
  if (values.length === 0) return [];
  const start = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
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

function isCommentSeed(post: Pick<NormalizedPost, "format">): boolean {
  const format = canonicalFormat(post.format);
  return /(?:^|_)(?:comment|comments|reply|replies)(?:_|$)/.test(format);
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
