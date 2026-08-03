import {
  actorFromRequest,
  ensureSocialSchema,
  getD1,
  routeError,
  runSocialScan,
  socialDataNeedsScan,
} from "../../../db/runtime";
import type {
  NormalizedPost,
  SocialPlatform,
} from "../../../lib/social-scanner";
import { buildSocialAnalysis } from "../../../lib/social-score";

export const dynamic = "force-dynamic";

type WorkspacePost = {
  platform: string;
  external_id: string;
  url: string;
  title: string;
  text: string;
  format: string;
  thumbnail_url: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  raw_json: string | null;
  [key: string]: unknown;
};

function rawFromJson(value: string | null): NormalizedPost["raw"] {
  if (!value) return null;
  try {
    return JSON.parse(value) as NormalizedPost["raw"];
  } catch {
    return null;
  }
}

function normalizedFromWorkspace(post: WorkspacePost): NormalizedPost {
  return {
    platform: post.platform as SocialPlatform,
    externalId: post.external_id,
    url: post.url,
    title: post.title || null,
    text: post.text || null,
    format: post.format || null,
    thumbnailUrl: post.thumbnail_url,
    publishedAt: post.published_at,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    saves: post.saves,
    raw: rawFromJson(post.raw_json),
  };
}

export async function GET(request: Request) {
  try {
    await ensureSocialSchema();
    if (await socialDataNeedsScan()) {
      await runSocialScan({
        trigger: "auto",
        actorLabel: actorFromRequest(request),
      });
    }

    const db = getD1();
    const [accountResult, postResult, scanResult] = await Promise.all([
      db
        .prepare(
          `SELECT a.id, a.platform, a.handle, a.display_name,
                  a.profile_url, a.external_account_id, a.verified,
                  a.follower_count,
                  COALESCE(a.source_kind, 'pending') AS source_kind,
                  a.coverage, a.scan_status, a.scan_message,
                  a.last_scanned_at, a.last_success_at,
                  a.created_at, a.updated_at,
                  COALESCE(
                    a.coverage,
                    'Source officielle configurée · aucun relevé exploitable pour le moment.'
                  ) AS coverage_label,
                  CASE a.scan_status
                    WHEN 'pending' THEN 'idle'
                    ELSE a.scan_status
                  END AS status,
                  a.scan_message AS last_error,
                  a.last_scanned_at AS last_scan_at,
                  COUNT(p.id) AS post_count
           FROM social_accounts a
           LEFT JOIN social_posts p ON p.account_id = a.id
           GROUP BY a.id
           ORDER BY CASE a.platform
             WHEN 'youtube' THEN 1
             WHEN 'instagram' THEN 2
             WHEN 'tiktok' THEN 3
             ELSE 4
           END`,
        )
        .all(),
      db
        .prepare(
          `SELECT
             p.id, p.account_id, p.platform, p.external_id,
             p.external_id AS external_post_id, p.url,
             COALESCE(p.title, '') AS title,
             COALESCE(p.text, '') AS text,
             COALESCE(p.format, '') AS format,
             p.thumbnail_url, p.published_at, p.views, p.likes,
             p.comments, p.shares, p.saves, p.performance_score,
             p.confidence, p.confidence AS score_confidence,
             p.cohort_key, p.score_explanation, p.metric_coverage,
             p.rank, p.platform_rank, p.raw_json, p.first_seen_at,
             p.last_seen_at, p.created_at, p.updated_at,
             p.updated_at AS last_metric_at,
             a.source_kind AS source_kind,
             NULL AS analysis_label
           FROM social_posts p
           JOIN social_accounts a ON a.id = p.account_id
           ORDER BY p.performance_score IS NULL ASC,
                    p.performance_score DESC,
                    p.published_at DESC`,
        )
        .all<WorkspacePost>(),
      db
        .prepare(
          `SELECT * FROM scan_runs
           ORDER BY started_at DESC
           LIMIT 40`,
        )
        .all(),
    ]);

    const posts = postResult.results ?? [];
    let analysis: ReturnType<typeof buildSocialAnalysis> | null = null;
    if (posts.length > 0) {
      try {
        analysis = buildSocialAnalysis(posts.map(normalizedFromWorkspace));
      } catch {
        analysis = null;
      }
    }

    return Response.json({
      mode: "live",
      notice:
        "Données publiques des comptes officiels Lofi Girl. Les couvertures limitées sont signalées explicitement et aucune métrique manquante n’est inventée.",
      generatedAt: new Date().toISOString(),
      accounts: accountResult.results ?? [],
      posts,
      scans: scanResult.results ?? [],
      analysis,
    });
  } catch (error) {
    return routeError(error);
  }
}
