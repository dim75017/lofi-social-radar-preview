import { ensureSocialSchema, getD1, routeError } from "../../../db/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSocialSchema();
    const db = getD1();
    const [trendResult, ideaResult, briefResult, eventResult] = await Promise.all([
      db
        .prepare(
          `SELECT * FROM trends
           ORDER BY CASE recommendation
             WHEN 'Utiliser' THEN 1 WHEN 'Surveiller' THEN 2 ELSE 3 END,
             brand_fit DESC, first_detected_at DESC`,
        )
        .all(),
      db.prepare("SELECT * FROM ideas ORDER BY created_at DESC").all(),
      db.prepare("SELECT * FROM briefs ORDER BY created_at DESC").all(),
      db
        .prepare(
          "SELECT * FROM decision_events ORDER BY created_at DESC, id DESC LIMIT 30",
        )
        .all(),
    ]);

    return Response.json({
      mode: "demo",
      notice:
        "Données de démonstration clairement séparées. Aucun connecteur social n’est actif.",
      trends: trendResult.results ?? [],
      ideas: ideaResult.results ?? [],
      briefs: briefResult.results ?? [],
      events: eventResult.results ?? [],
    });
  } catch (error) {
    return routeError(error);
  }
}
