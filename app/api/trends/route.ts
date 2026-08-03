import {
  actorFromRequest,
  ensureSocialSchema,
  getD1,
  routeError,
} from "../../../db/runtime";

type TrendPayload = {
  title?: string;
  summary?: string;
  platform?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  brandFit?: number;
  velocityScore?: number;
};

export async function POST(request: Request) {
  try {
    await ensureSocialSchema();
    const payload = (await request.json()) as TrendPayload;
    const title = payload.title?.trim() ?? "";
    const summary = payload.summary?.trim() ?? "";
    const platform = payload.platform?.trim() ?? "";
    const sourceLabel = payload.sourceLabel?.trim() ?? "Import manuel";
    if (!title || !summary || !platform) {
      return Response.json(
        { error: "Titre, résumé et plateforme sont obligatoires." },
        { status: 400 },
      );
    }

    const db = getD1();
    const id = `trend_${crypto.randomUUID()}`;
    const brandFit = Math.max(0, Math.min(100, Number(payload.brandFit ?? 70)));
    const velocity = Math.max(
      0,
      Math.min(100, Number(payload.velocityScore ?? 50)),
    );
    const recommendation = brandFit >= 80 ? "Utiliser" : "Surveiller";
    const explanation =
      "Signal ajouté manuellement. Vérifier la source et compléter les observations avant toute conclusion de performance.";

    await db.batch([
      db
        .prepare(
          `INSERT INTO trends (
            id, title, summary, platform, source_label, source_url,
            first_detected_at, velocity_score, maturity, saturation_risk,
            brand_fit, brand_risk, recommendation, explanation, origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'À qualifier', 35, ?, 12, ?, ?, 'manual')`,
        )
        .bind(
          id,
          title,
          summary,
          platform,
          sourceLabel,
          payload.sourceUrl?.trim() || null,
          new Date().toISOString(),
          velocity,
          brandFit,
          recommendation,
          explanation,
        ),
      db
        .prepare(
          `INSERT INTO decision_events (
            entity_type, entity_id, action, to_status, actor_label,
            rationale, immutable_snapshot
          ) VALUES ('trend', ?, 'created', 'detected', ?, ?, ?)`,
        )
        .bind(
          id,
          actorFromRequest(request),
          "Ajout manuel",
          JSON.stringify({ title, platform, sourceLabel, brandFit, velocity }),
        ),
    ]);

    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
