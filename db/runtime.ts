import { env } from "cloudflare:workers";

type D1Result<T = Record<string, unknown>> = {
  results?: T[];
  success: boolean;
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};

export type SocialD1 = {
  prepare(query: string): D1Statement;
  batch<T = Record<string, unknown>>(
    statements: D1Statement[],
  ): Promise<D1Result<T>[]>;
};

export function getD1(): SocialD1 {
  const database = env.DB as unknown as SocialD1 | undefined;
  if (!database) {
    throw new Error(
      "La base partagée n’est pas disponible. Réessaie dans quelques instants ou utilise l’import manuel.",
    );
  }
  return database;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS trends (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    platform TEXT NOT NULL,
    source_label TEXT NOT NULL,
    source_url TEXT,
    first_detected_at TEXT NOT NULL,
    velocity_score INTEGER NOT NULL,
    maturity TEXT NOT NULL,
    saturation_risk INTEGER NOT NULL,
    brand_fit INTEGER NOT NULL,
    brand_risk INTEGER NOT NULL DEFAULT 0,
    recommendation TEXT NOT NULL,
    explanation TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trends_recommendation_fit
   ON trends(recommendation, brand_fit DESC)`,
  `CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    trend_id TEXT REFERENCES trends(id),
    title TEXT NOT NULL,
    concept TEXT NOT NULL,
    objective TEXT NOT NULL,
    platform TEXT NOT NULL,
    format TEXT NOT NULL,
    character TEXT NOT NULL,
    hook TEXT NOT NULL,
    cta TEXT NOT NULL DEFAULT '',
    brand_score INTEGER NOT NULL,
    timing_score INTEGER NOT NULL,
    evidence_score INTEGER NOT NULL,
    feasibility_score INTEGER NOT NULL,
    priority_score INTEGER NOT NULL,
    confidence_label TEXT NOT NULL,
    score_explanation TEXT NOT NULL,
    prediction_version TEXT NOT NULL,
    prediction_snapshot TEXT NOT NULL,
    production_effort TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'review',
    decision_note TEXT,
    ideal_publish_at TEXT,
    origin TEXT NOT NULL DEFAULT 'manual',
    row_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ideas_status_created
   ON ideas(status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS briefs (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL UNIQUE REFERENCES ideas(id),
    objective TEXT NOT NULL,
    message TEXT NOT NULL,
    hook_variants TEXT NOT NULL,
    storyboard TEXT NOT NULL,
    asset_requirements TEXT NOT NULL,
    success_criteria TEXT NOT NULL,
    owner TEXT,
    deadline TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS decision_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    actor_label TEXT NOT NULL,
    rationale TEXT,
    immutable_snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decision_events_entity_created
   ON decision_events(entity_type, entity_id, created_at DESC)`,
];

const demoTrends = [
  {
    id: "demo_trend_quiet_reset",
    title: "Le rituel du quiet reset",
    summary:
      "Un format court qui transforme une transition banale en respiration visuelle : ranger le bureau, remettre le casque et relancer la session.",
    platform: "Instagram · TikTok",
    sourceLabel: "Exemple de démonstration",
    detectedAt: "2026-08-03T08:30:00.000Z",
    velocity: 82,
    maturity: "Émergente",
    saturation: 24,
    brandFit: 94,
    brandRisk: 8,
    recommendation: "Utiliser",
    explanation:
      "Compatible avec les rituels d’étude et la narration silencieuse. À adapter sans reprendre un son ou un montage tiers.",
  },
  {
    id: "demo_trend_tiny_win",
    title: "Tiny wins de fin de journée",
    summary:
      "Des micro-victoires racontées en trois plans : une tâche terminée, une boisson chaude, la lumière qui baisse.",
    platform: "YouTube Shorts",
    sourceLabel: "Exemple de démonstration",
    detectedAt: "2026-08-02T16:10:00.000Z",
    velocity: 68,
    maturity: "En hausse",
    saturation: 38,
    brandFit: 91,
    brandRisk: 6,
    recommendation: "Utiliser",
    explanation:
      "Le mécanisme émotionnel est proche de l’univers Lofi Girl, mais doit rester sobre et non motivationnel.",
  },
  {
    id: "demo_trend_desk_personality",
    title: "Le bureau révèle le personnage",
    summary:
      "Chaque objet du bureau devient un indice de personnalité et invite la communauté à reconnaître le personnage.",
    platform: "Instagram · Pinterest",
    sourceLabel: "Exemple de démonstration",
    detectedAt: "2026-08-01T12:00:00.000Z",
    velocity: 56,
    maturity: "À surveiller",
    saturation: 29,
    brandFit: 88,
    brandRisk: 10,
    recommendation: "Surveiller",
    explanation:
      "Bonne compatibilité lore et merchandising, mais signal encore insuffisant sans données de plateforme connectées.",
  },
  {
    id: "demo_trend_overstimulated_edit",
    title: "Montages ultra-stimulants",
    summary:
      "Succession de cuts, zooms et textes très rapides conçus pour maximiser la rétention seconde par seconde.",
    platform: "TikTok",
    sourceLabel: "Exemple de démonstration",
    detectedAt: "2026-07-30T18:45:00.000Z",
    velocity: 89,
    maturity: "Saturée",
    saturation: 88,
    brandFit: 31,
    brandRisk: 72,
    recommendation: "Ignorer",
    explanation:
      "Performance potentielle élevée mais langage incompatible avec le rythme et la cohérence de marque.",
  },
];

export async function ensureSocialSchema() {
  const db = getD1();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));

  const count = await db
    .prepare("SELECT COUNT(*) AS total FROM trends")
    .first<{ total: number }>();
  if (Number(count?.total ?? 0) > 0) return;

  await db.batch(
    demoTrends.map((trend) =>
      db
        .prepare(
          `INSERT INTO trends (
            id, title, summary, platform, source_label, first_detected_at,
            velocity_score, maturity, saturation_risk, brand_fit, brand_risk,
            recommendation, explanation, origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')`,
        )
        .bind(
          trend.id,
          trend.title,
          trend.summary,
          trend.platform,
          trend.sourceLabel,
          trend.detectedAt,
          trend.velocity,
          trend.maturity,
          trend.saturation,
          trend.brandFit,
          trend.brandRisk,
          trend.recommendation,
          trend.explanation,
        ),
    ),
  );
}

export function actorFromRequest(request: Request) {
  return (
    request.headers.get("oai-authenticated-user-full-name") ??
    request.headers.get("oai-authenticated-user-email") ??
    "Direction · aperçu local"
  );
}

export function routeError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
  return Response.json({ error: message }, { status: 500 });
}
