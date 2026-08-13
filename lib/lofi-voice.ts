/**
 * Lofi Girl comment voice.
 *
 * The comments that worked were never "nice comments under a big video". They
 * worked because the character reacted in character: under the GTA VI trailer,
 * the girl who has been studying at the same desk for years said she would put
 * her pen down. The joke only exists because everyone knows she never stops.
 *
 * This module encodes that: the canon a line may draw from, the archetypes
 * that reliably land, and the hard rules a proposal must satisfy before a
 * community manager ever sees it. Nothing here posts anything.
 */

import {
  COMMENT_OPPORTUNITY_MAX_COMMENT_LENGTH,
  isPromotionalComment,
  type CommentOpportunity,
  type CommentOpportunityCategory,
  type CommentOpportunityTone,
  type CommentSuggestion,
} from "./comment-opportunities.ts";

export const LOFI_VOICE_MODEL = "claude-sonnet-5";

/** Canon a line may lean on. Everything else has to be invented, so it is not. */
export const LOFI_VOICE_CANON = `Lofi Girl is a character, not a logo.

Who she is:
- A girl named Jade, studying at a desk by a window, headphones on, one lamp,
  one notebook, one pen, a mug. She has been there since 2017.
- Pocky, her cat, sits on the windowsill. Pocky judges. Pocky never studies.
- Outside the window: a city, rain more often than not, sometimes snow, once a
  summer river. The scene loops forever.
- The stream never stops. Millions of people study to it at the same time,
  silently, alone together. That shared solitude is the whole brand.
- Her tagline is "beats to relax/study to". She has never shouted once.

How she speaks:
- English, lowercase, calm, understated, a little deadpan.
- One idea per comment. No lists, no build-up, no punchline explained.
- Dry humour, never mean, never edgy, never ironic about other people's work.
- She is the smallest voice in a loud comment section, which is why she is read.

What makes a comment work:
- It reacts *in character*. The value is the contrast between a girl who never
  stops studying and an event big enough to interrupt her.
- It is specific to what is actually in this video, not a compliment that would
  fit any video.
- It reads like a person, not like a brand account doing outreach.`;

export type LofiCommentArchetype = {
  id: string;
  label: string;
  when: string;
  example: string;
};

/**
 * Reusable shapes, not templates to fill. They are handed to the model as
 * angles of attack so the three proposals do not collapse into one joke.
 */
export const LOFI_COMMENT_ARCHETYPES: readonly LofiCommentArchetype[] = [
  {
    id: "pen-down",
    label: "Le stylo qu'on pose",
    when: "Un drop assez énorme pour interrompre une routine de huit ans.",
    example: "ok i will put my pen down for this one",
  },
  {
    id: "study-playlist",
    label: "Ça part dans la session",
    when: "Un contenu musical, ou une ambiance qui colle à une session de travail.",
    example: "this is going straight into the 2am session",
  },
  {
    id: "pocky",
    label: "Le chat",
    when: "Un contenu avec un animal, du chaos, ou quelque chose d'ostensiblement confortable.",
    example: "pocky watched this twice and still refuses to help me revise",
  },
  {
    id: "window",
    label: "La fenêtre",
    when: "Un contenu très visuel, une météo, un paysage, une atmosphère.",
    example: "my window has been showing the same rain for six years, jealous",
  },
  {
    id: "the-loop",
    label: "La boucle",
    when: "Une nostalgie, un anniversaire, un retour de franchise.",
    example: "i was already at this desk when the first one came out",
  },
  {
    id: "deadline",
    label: "Le devoir à rendre",
    when: "Une distraction irrésistible, un truc qu'on va regarder au lieu de bosser.",
    example: "i have an essay due tomorrow and now i have plans",
  },
  {
    id: "volume",
    label: "Le volume",
    when: "Un son, un score, une bande-annonce dont la musique porte tout.",
    example: "turning my own beats down for this, that never happens",
  },
  {
    id: "same-desk",
    label: "Le temps qui passe",
    when: "Un événement qui marque une époque, un retour attendu depuis des années.",
    example: "same desk, same chair, entirely different decade",
  },
];

/** Real lines that landed. Few-shot ground truth beats any amount of adjectives. */
export const LOFI_VOICE_HALL_OF_FAME: readonly {
  context: string;
  comment: string;
  why: string;
}[] = [
  {
    context: "Bande-annonce GTA VI, sortie Rockstar Games, des dizaines de millions de vues en quelques heures.",
    comment: "ok i will put my pen down for this one",
    why: "Elle ne parle pas du jeu, elle parle d'elle. Tout le monde sait qu'elle n'arrête jamais : l'aveu vaut plus qu'un compliment.",
  },
];

export const LOFI_TONE_BRIEFS: Record<
  CommentOpportunityTone,
  { label: string; brief: string }
> = {
  funny: {
    label: "Drôle",
    brief:
      "Une vanne sèche, en une phrase, dont la chute est la routine d'étude. Jamais un jeu de mots forcé.",
  },
  smart: {
    label: "Smart",
    brief:
      "Une observation qui recadre le contenu en une idée propre. Elle doit donner envie de répondre, pas d'applaudir.",
  },
  complice: {
    label: "Complice",
    brief:
      "Un clin d'œil à ceux qui reconnaîtront : la communauté qui révise, ou le créateur du post. Chaleureux, jamais flagorneur.",
  },
};

const CATEGORY_BRIEFS: Record<CommentOpportunityCategory, string> = {
  gaming: "Gaming : la sortie interrompt la session de révision, ou la remplace.",
  cinema: "Ciné, séries, anime : l'ambiance, la bande-son, l'attente entre deux épisodes.",
  music: "Musique : terrain naturel, mais ne jamais se comparer ni se recommander.",
  tech: "Tech : le bureau, les outils, la promesse de productivité qui ne tient jamais.",
  sport: "Sport : l'intensité contre le calme, un contraste, jamais un pronostic.",
  internet: "Créateurs : parler au créateur comme à quelqu'un qu'on regarde, pas comme à un partenaire.",
  other: "Sans thème dominant : s'accrocher au détail concret visible dans la vidéo.",
};

/** Refused outright: a brand joke next to any of this is a crisis, not a win. */
const SENSITIVE_COMMENT_PATTERN =
  /\b(?:rip|r\.i\.p|death|died|dead|funeral|grief|cancer|suicide|overdose|war|shooting|murder|victim|tragedy|terror|racist|nazi|election|vote|president|politics|lawsuit|arrested|abuse)\b/iu;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;

export type LofiCommentRejection = { ok: false; reason: string };
export type LofiCommentAcceptance = { ok: true };

/**
 * Last gate before a proposal is written to the feed. The model is good; it is
 * not the thing standing between the brand and a bad comment.
 */
export function validateLofiComment(text: unknown): LofiCommentAcceptance | LofiCommentRejection {
  if (typeof text !== "string") return { ok: false, reason: "texte absent" };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "texte vide" };
  if (trimmed.length > COMMENT_OPPORTUNITY_MAX_COMMENT_LENGTH) {
    return { ok: false, reason: `plus de ${COMMENT_OPPORTUNITY_MAX_COMMENT_LENGTH} caractères` };
  }
  if (trimmed !== text) return { ok: false, reason: "espaces en bord de texte" };
  if (/\s{2,}|\n/u.test(trimmed)) return { ok: false, reason: "mise en forme sur plusieurs lignes" };
  if (isPromotionalComment(trimmed)) return { ok: false, reason: "lien, hashtag ou appel à l'action" };
  if (SENSITIVE_COMMENT_PATTERN.test(trimmed)) return { ok: false, reason: "sujet sensible" };
  if ((trimmed.match(EMOJI_PATTERN)?.length ?? 0) > 1) return { ok: false, reason: "plus d'un emoji" };
  if (/["“”]/u.test(trimmed)) return { ok: false, reason: "guillemets parasites" };
  if (/\b(?:as an ai|language model)\b/iu.test(trimmed)) return { ok: false, reason: "fuite de modèle" };
  return { ok: true };
}

export type LofiCommentPrompt = { system: string; user: string };

export function buildLofiCommentPrompt(
  opportunity: Pick<
    CommentOpportunity,
    | "platform"
    | "category"
    | "author"
    | "title"
    | "caption"
    | "momentTier"
    | "metrics"
    | "velocity"
    | "publishedAt"
  >,
): LofiCommentPrompt {
  const archetypes = LOFI_COMMENT_ARCHETYPES.map(
    (archetype) => `- ${archetype.id} — ${archetype.when}\n  ex : "${archetype.example}"`,
  ).join("\n");
  const hallOfFame = LOFI_VOICE_HALL_OF_FAME.map(
    (entry) => `- Contexte : ${entry.context}\n  Commentaire : "${entry.comment}"\n  Pourquoi ça marche : ${entry.why}`,
  ).join("\n");
  const tones = (Object.keys(LOFI_TONE_BRIEFS) as CommentOpportunityTone[])
    .map((tone) => `- ${tone} : ${LOFI_TONE_BRIEFS[tone].brief}`)
    .join("\n");

  const system = `${LOFI_VOICE_CANON}

Archétypes qui fonctionnent (angles d'attaque, pas des gabarits à remplir) :
${archetypes}

Commentaires réels qui ont marché :
${hallOfFame}

Les trois tons demandés :
${tones}

Règles dures, non négociables :
- Anglais, minuscules, une seule idée, ${COMMENT_OPPORTUNITY_MAX_COMMENT_LENGTH} caractères maximum.
- Aucun lien, aucun hashtag, aucune mention @, aucun appel à l'action.
- Ne jamais citer la chaîne, la playlist, la radio ni la marque comme une recommandation. Incarner le personnage est autorisé, se promouvoir ne l'est pas.
- Aucun emoji, sauf si un seul emoji est manifestement la meilleure réponse.
- Zéro affirmation factuelle sur ce que la vidéo contient au-delà de ce qui est fourni ci-dessous.
- Si le sujet touche à un décès, une tragédie, un procès, une maladie, une guerre ou la politique : ne rien proposer et le dire.
- Trois propositions distinctes, chacune sur un archétype différent.

Réponds uniquement par un objet JSON de la forme :
{"usable":true,"comments":[{"tone":"funny","archetype":"pen-down","text":"..."},{"tone":"smart","archetype":"...","text":"..."},{"tone":"complice","archetype":"...","text":"..."}]}
Si le sujet est inadapté : {"usable":false,"reason":"..."}`;

  const facts = [
    `Plateforme : ${opportunity.platform}`,
    `Compte : ${opportunity.author}`,
    `Titre : ${opportunity.title}`,
    opportunity.caption && opportunity.caption !== opportunity.title
      ? `Description : ${opportunity.caption.slice(0, 600)}`
      : null,
    `Thème : ${CATEGORY_BRIEFS[opportunity.category]}`,
    opportunity.publishedAt ? `Publié le : ${opportunity.publishedAt}` : null,
    opportunity.velocity
      ? `Vitesse mesurée : +${opportunity.velocity.perHour.toLocaleString("fr-FR")} ${opportunity.velocity.metric} par heure sur ${opportunity.velocity.windowHours} h`
      : "Vitesse : pas encore mesurée (un seul relevé).",
    opportunity.metrics.views !== null
      ? `Vues publiques au dernier relevé : ${opportunity.metrics.views.toLocaleString("fr-FR")}`
      : null,
    opportunity.momentTier === "s"
      ? "Poids : moment culturel majeur, la section de commentaires va être saturée en une heure."
      : null,
  ].filter(Boolean).join("\n");

  return {
    system,
    user: `Voici la vidéo sur laquelle Lofi Girl peut réagir.\n\n${facts}\n\nPropose les trois commentaires.`,
  };
}

export type LofiVoiceResult =
  | { usable: true; comments: CommentSuggestion[] }
  | { usable: false; reason: string };

/**
 * Parses and gates a model answer. A single unusable line invalidates the whole
 * triplet: publishing two good comments and one broken one is worse than
 * publishing none, because nobody re-reads the third.
 */
export function parseLofiVoiceResponse(raw: string): LofiVoiceResult {
  let payload: unknown;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("aucun objet JSON");
    payload = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    return { usable: false, reason: `réponse illisible : ${error instanceof Error ? error.message : "inconnue"}` };
  }
  if (!payload || typeof payload !== "object") {
    return { usable: false, reason: "réponse vide" };
  }
  const answer = payload as { usable?: unknown; reason?: unknown; comments?: unknown };
  if (answer.usable === false) {
    return {
      usable: false,
      reason: typeof answer.reason === "string" && answer.reason.trim().length > 0
        ? answer.reason.trim()
        : "sujet écarté par le moteur de voix",
    };
  }
  if (!Array.isArray(answer.comments) || answer.comments.length !== 3) {
    return { usable: false, reason: "trois commentaires attendus" };
  }

  const wanted: CommentOpportunityTone[] = ["funny", "smart", "complice"];
  const comments: CommentSuggestion[] = [];
  const seen = new Set<string>();
  for (const tone of wanted) {
    const entry = (answer.comments as Array<{ tone?: unknown; text?: unknown }>).find(
      (candidate) => candidate?.tone === tone,
    );
    if (!entry) return { usable: false, reason: `ton manquant : ${tone}` };
    const verdict = validateLofiComment(entry.text);
    if (!verdict.ok) return { usable: false, reason: `${tone} rejeté (${verdict.reason})` };
    const text = entry.text as string;
    const normalized = text.toLocaleLowerCase("en");
    if (seen.has(normalized)) return { usable: false, reason: "deux propositions identiques" };
    seen.add(normalized);
    comments.push({ tone, label: LOFI_TONE_BRIEFS[tone].label, text });
  }
  return { usable: true, comments };
}

/**
 * Generic lines used only when the voice engine is unavailable. They are
 * deliberately about the act of watching rather than about the video, because
 * a placeholder that pretends to know the content is how a brand embarrasses
 * itself. The card is flagged `fallback` so nobody mistakes them for writing.
 */
const FALLBACK_LINES: Record<CommentOpportunityTone, readonly string[]> = {
  funny: [
    "well there goes the revision plan",
    "i have an essay due and now i have plans",
    "pocky and i have cleared the evening",
    "closing the notebook, purely for research",
  ],
  smart: [
    "the pacing here is doing most of the work",
    "quiet start, and that is exactly why it lands",
    "everyone will remember the last ten seconds",
    "this is going to age into a reference",
  ],
  complice: [
    "whoever is watching this at 2am, same",
    "the comment section is about to be unreadable, in a good way",
    "showing up early for this one",
    "eight years at this desk and still here for these",
  ],
};

function stableIndex(seed: string, length: number) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

export function fallbackLofiComments(seed: string): CommentSuggestion[] {
  return (Object.keys(FALLBACK_LINES) as CommentOpportunityTone[]).map((tone) => {
    const lines = FALLBACK_LINES[tone];
    return {
      tone,
      label: LOFI_TONE_BRIEFS[tone].label,
      text: lines[stableIndex(`${seed}:${tone}`, lines.length)],
    };
  });
}

export type LofiVoiceRequestOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
};

/**
 * One call per video. The canon block is marked for prompt caching because it
 * is identical across every call of a run and is by far the largest part.
 */
export async function requestLofiComments(
  opportunity: Parameters<typeof buildLofiCommentPrompt>[0],
  options: LofiVoiceRequestOptions,
): Promise<LofiVoiceResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const prompt = buildLofiCommentPrompt(opportunity);
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model ?? LOFI_VOICE_MODEL,
      max_tokens: 400,
      temperature: 1,
      system: [
        { type: "text", text: prompt.system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: prompt.user }],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
  });
  if (!response.ok) {
    return {
      usable: false,
      reason: `moteur de voix indisponible (HTTP ${response.status})`,
    };
  }
  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (payload.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  if (text.trim().length === 0) {
    return { usable: false, reason: "réponse vide du moteur de voix" };
  }
  return parseLofiVoiceResponse(text);
}
