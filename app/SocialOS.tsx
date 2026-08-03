"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails come from live social sources with dynamic hosts. */

import { useCallback, useEffect, useMemo, useState } from "react";

type Platform = "youtube" | "instagram" | "tiktok" | "x";
type View = "overview" | "top" | "all" | "sources";

type SocialAccount = {
  id: string;
  platform: Platform;
  handle: string;
  display_name: string;
  profile_url: string;
  external_account_id: string | null;
  source_kind: string;
  coverage_label: string;
  status: "ready" | "limited" | "error" | "idle";
  follower_count: number | null;
  last_scan_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  post_count: number;
};

type SocialPost = {
  id: string;
  account_id: string;
  platform: Platform;
  external_post_id: string;
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
  performance_score: number | null;
  score_confidence: "high" | "medium" | "low" | "insufficient";
  score_explanation: string;
  analysis_label: string | null;
  source_kind: string;
  first_seen_at: string;
  last_seen_at: string;
  last_metric_at: string;
};

type ScanRun = {
  id: string;
  account_id: string;
  status: "running" | "succeeded" | "partial" | "failed";
  found_count: number;
  inserted_count: number;
  updated_count: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
};

type Insight = {
  emoji: string;
  title: string;
  summary: string;
  evidence?: string;
};

type WorkspacePayload = {
  mode: "live";
  notice: string;
  generatedAt: string;
  accounts: SocialAccount[];
  posts: SocialPost[];
  scans: ScanRun[];
  analysis?: {
    insights?: Array<
      Partial<Insight> & {
        title: string;
        detail?: string;
        platform?: Platform | "all";
      }
    >;
    crossPlatform?: Array<{
      label: string;
      platforms: Platform[];
      averageScore: number;
      postIds: string[];
    }>;
  } | null;
};

const PLATFORM_META: Record<
  Platform,
  { emoji: string; label: string; short: string; tone: string }
> = {
  youtube: { emoji: "▶️", label: "YouTube", short: "YT", tone: "red" },
  instagram: { emoji: "📸", label: "Instagram", short: "IG", tone: "pink" },
  tiktok: { emoji: "🎵", label: "TikTok", short: "TT", tone: "cyan" },
  x: { emoji: "𝕏", label: "X", short: "X", tone: "blue" },
};

const NAV: Array<{
  id: View;
  emoji: string;
  label: string;
  group: "Pilotage" | "Données";
}> = [
  { id: "overview", emoji: "📊", label: "Command Center", group: "Pilotage" },
  { id: "top", emoji: "🏆", label: "Meilleurs posts", group: "Pilotage" },
  { id: "all", emoji: "🔎", label: "Tous les contenus", group: "Données" },
  { id: "sources", emoji: "🔌", label: "Sources", group: "Données" },
];

const VIEW_COPY: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "Command Center",
    subtitle: "Ce qui fonctionne vraiment sur les comptes Lofi Girl.",
  },
  top: {
    title: "Meilleurs posts",
    subtitle: "Classement normalisé par plateforme, métriques et âge du contenu.",
  },
  all: {
    title: "Tous les contenus",
    subtitle: "Les publications réellement détectées, sans donnée de démonstration.",
  },
  sources: {
    title: "Sources officielles",
    subtitle: "Couverture, fraîcheur et limites visibles pour chaque réseau.",
  },
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function relativeAge(value: string | null) {
  if (!value) return "date publique absente";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "date inconnue";
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 1) return "moins d’1 h";
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} j`;
  const months = Math.floor(days / 30);
  return `${months} mois`;
}

function confidenceLabel(value: SocialPost["score_confidence"]) {
  if (value === "high") return "Confiance forte";
  if (value === "medium") return "Confiance moyenne";
  if (value === "low") return "Échantillon limité";
  return "Non classé";
}

function scoreTone(score: number | null) {
  if (score === null) return "muted";
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "muted";
}

function postLabel(post: SocialPost) {
  if (post.analysis_label) return post.analysis_label;
  const value = `${post.title} ${post.text}`.toLowerCase();
  if (/radio|beats|music|mix|sleep|study|lofi/.test(value)) return "Musique & usage";
  if (/fortnite|game|album|release|merch|listen/.test(value)) return "Activation";
  if (/pocky|maya|girl|character|lore/.test(value)) return "Personnage & lore";
  if (/tell me|comment|you|your|\?/.test(value)) return "Conversation";
  return "Relatable & humour";
}

function normalizeCreative(post: SocialPost) {
  return `${post.title || post.text}`
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

function localInsights(posts: SocialPost[]): Insight[] {
  if (!posts.length) return [];
  const ranked = [...posts].sort(
    (a, b) => (b.performance_score ?? -1) - (a.performance_score ?? -1),
  );
  const groups = new Map<string, SocialPost[]>();
  for (const post of posts) {
    const key = normalizeCreative(post);
    if (key.split(" ").length < 3) continue;
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  const cross = [...groups.values()]
    .filter((group) => new Set(group.map((post) => post.platform)).size >= 2)
    .sort((a, b) => {
      const average = (items: SocialPost[]) =>
        items.reduce((sum, item) => sum + (item.performance_score ?? 0), 0) / items.length;
      return average(b) - average(a);
    })[0];
  const topFive = ranked.slice(0, Math.min(5, ranked.length));
  const labels = new Map<string, number>();
  for (const post of topFive) {
    const label = postLabel(post);
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const dominant = [...labels.entries()].sort((a, b) => b[1] - a[1])[0];
  const top = ranked[0];
  const insights: Insight[] = [];

  if (cross) {
    const platforms = [...new Set(cross.map((post) => PLATFORM_META[post.platform].label))];
    insights.push({
      emoji: "🌍",
      title: "Créatif cross-platform détecté",
      summary: `« ${cross[0].title || cross[0].text} » ressort sur ${platforms.join(", ")}.`,
      evidence: `${cross.length} publications reliées par leur accroche.`,
    });
  }
  insights.push({
    emoji: "🚀",
    title: `${PLATFORM_META[top.platform].label} porte le signal n°1`,
    summary: `« ${top.title || top.text} » est actuellement le post le mieux classé.`,
    evidence: `${top.performance_score ?? "—"}/100 · ${top.score_explanation}`,
  });
  if (dominant) {
    insights.push({
      emoji: "🧠",
      title: `Pattern dominant : ${dominant[0]}`,
      summary: `${dominant[1]} des ${topFive.length} meilleurs posts utilisent ce ressort éditorial.`,
      evidence: "Lecture descriptive de l’échantillon visible, pas une causalité.",
    });
  }
  return insights.slice(0, 3);
}

function metrics(post: SocialPost) {
  return [
    post.views !== null ? { icon: "👁", label: "vues", value: post.views } : null,
    post.likes !== null ? { icon: "♥", label: "likes", value: post.likes } : null,
    post.comments !== null
      ? { icon: "💬", label: "commentaires", value: post.comments }
      : null,
    post.shares !== null ? { icon: "↗", label: "partages", value: post.shares } : null,
    post.saves !== null ? { icon: "🔖", label: "sauvegardes", value: post.saves } : null,
  ].filter(Boolean) as Array<{ icon: string; label: string; value: number }>;
}

export function SocialOS() {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [view, setView] = useState<View>("overview");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const payload = (await response.json()) as WorkspacePayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Le radar ne répond pas.");
      setWorkspace(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadWorkspace();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const runScan = useCallback(
    async (target?: Platform) => {
      setScanning(true);
      setError("");
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(target ? { platform: target } : {}),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || "Le scan a échoué.");
        await loadWorkspace();
        setToast(target ? `${PLATFORM_META[target].label} actualisé` : "Les 4 réseaux ont été rescannés");
      } catch (scanError) {
        setError(scanError instanceof Error ? scanError.message : "Le scan a échoué.");
      } finally {
        setScanning(false);
      }
    },
    [loadWorkspace],
  );

  const posts = useMemo(() => workspace?.posts ?? [], [workspace?.posts]);
  const accounts = workspace?.accounts ?? [];
  const topPosts = useMemo(
    () => [...posts].sort((a, b) => (b.performance_score ?? -1) - (a.performance_score ?? -1)),
    [posts],
  );
  const filteredPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return topPosts.filter((post) => {
      if (platform !== "all" && post.platform !== platform) return false;
      if (!needle) return true;
      return `${post.title} ${post.text} ${post.format}`.toLowerCase().includes(needle);
    });
  }, [platform, search, topPosts]);
  const insights = useMemo(() => {
    const serverInsights = workspace?.analysis?.insights;
    return serverInsights?.length
      ? serverInsights.slice(0, 3).map((insight) => ({
          emoji:
            insight.emoji ??
            (insight.platform && insight.platform !== "all"
              ? PLATFORM_META[insight.platform].emoji
              : "🧠"),
          title: insight.title,
          summary: insight.summary ?? insight.detail ?? "Analyse descriptive disponible.",
          evidence: insight.evidence,
        }))
      : localInsights(posts);
  }, [posts, workspace?.analysis?.insights]);
  const activeSources = accounts.filter((account) => account.post_count > 0).length;
  const lastSuccess = accounts
    .map((account) => account.last_success_at)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;

  const navCount = (id: View) => {
    if (id === "top") return Math.min(10, posts.length);
    if (id === "all") return posts.length;
    if (id === "sources") return accounts.length;
    return undefined;
  };

  return (
    <div className="app-shell">
      <button
        className="burger"
        type="button"
        aria-label="Ouvrir le menu"
        onClick={() => setMobileOpen(true)}
      >
        ☰
      </button>
      <button
        className={`side-veil ${mobileOpen ? "show" : ""}`}
        type="button"
        aria-label="Fermer le menu"
        onClick={() => setMobileOpen(false)}
      />

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            ◉<span />
          </div>
          <div className="brand-copy">
            <h1>
              Lofi <span>Social Radar</span>
            </h1>
            <small>Community Intelligence</small>
          </div>
        </div>

        <div className="radar-switch" aria-label="Produit actif">
          <span>▶ YouTube</span>
          <span>♫ Spotify</span>
          <span className="on">● Social</span>
        </div>

        <nav className="nav" aria-label="Navigation principale">
          {(["Pilotage", "Données"] as const).map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {NAV.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  className={view === item.id ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setView(item.id);
                    setMobileOpen(false);
                  }}
                >
                  <span className="nav-emoji">{item.emoji}</span>
                  <span className="nav-text">{item.label}</span>
                  {navCount(item.id) !== undefined ? (
                    <span className="nav-count">{navCount(item.id)}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sync-row">
            <span className={`sync-dot ${scanning ? "loading" : error ? "error" : ""}`} />
            <div>
              <b>{scanning ? "Scan en cours" : `${activeSources}/4 sources actives`}</b>
              <span>{lastSuccess ? `Dernier relevé ${formatDate(lastSuccess, true)}` : "Premier scan à lancer"}</span>
            </div>
          </div>
          <button className="refresh-button" type="button" disabled={scanning} onClick={() => void runScan()}>
            {scanning ? "⏳ Collecte…" : "↻ Scanner les réseaux"}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">Social & Community Intelligence OS</span>
            <h2>
              {NAV.find((item) => item.id === view)?.emoji} {VIEW_COPY[view].title}
              <span className="top-pill">Live V1</span>
            </h2>
            <p>{VIEW_COPY[view].subtitle}</p>
          </div>
          <div className="top-actions">
            <span className="demo-pill live-pill">● Données publiques réelles</span>
            <button className="button primary" type="button" disabled={scanning} onClick={() => void runScan()}>
              {scanning ? "⏳ Scan en cours" : "🔄 Scanner maintenant"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <span>⚠️</span>
            <div>
              <b>Le radar a rencontré un problème</b>
              <p>{error}</p>
            </div>
            <button type="button" aria-label="Fermer" onClick={() => setError("")}>×</button>
          </div>
        ) : null}

        {loading && !workspace ? (
          <div className="scanner-loading">
            <div className="radar-loader">◉</div>
            <h3>Scan des comptes officiels Lofi Girl</h3>
            <p>Instagram, X, TikTok et YouTube sont interrogés et normalisés.</p>
            <div className="scan-platforms">📸 &nbsp; 𝕏 &nbsp; 🎵 &nbsp; ▶️</div>
          </div>
        ) : null}

        {workspace && view === "overview" ? (
          <div className="view-stack">
            <section>
              <div className="section-heading">
                <div>
                  <span className="section-kicker">Couverture maintenant</span>
                  <h3>{activeSources} réseaux avec des posts exploitables</h3>
                </div>
                <span className="freshness">{posts.length} contenus · relevé {formatDate(lastSuccess ?? null, true)}</span>
              </div>
              <div className="source-status-grid">
                {(Object.keys(PLATFORM_META) as Platform[]).map((key) => {
                  const account = accounts.find((item) => item.platform === key);
                  const meta = PLATFORM_META[key];
                  return (
                    <button
                      type="button"
                      className={`source-status-card tone-${meta.tone}`}
                      key={key}
                      onClick={() => {
                        setPlatform(key);
                        setView("top");
                      }}
                    >
                      <span className="source-logo">{meta.emoji}</span>
                      <span className="source-card-copy">
                        <b>{meta.label}</b>
                        <small>{account?.coverage_label ?? "Source en attente"}</small>
                      </span>
                      <span className="source-count">
                        <b>{account?.post_count ?? 0}</b>
                        <small>posts</small>
                      </span>
                      <span className={`source-state ${account?.status ?? "idle"}`}>
                        {account?.status === "error" ? "Erreur" : account?.status === "limited" ? "Limité" : "Actif"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <span className="section-kicker">Analyse éditoriale</span>
                  <h3>Ce qui mérite l’attention de l’équipe</h3>
                </div>
                <span className="freshness">Calculé sur {posts.length} posts réels</span>
              </div>
              <div className="insight-grid">
                {insights.map((insight, index) => (
                  <article className={`insight-card insight-${index + 1}`} key={`${insight.title}-${index}`}>
                    <span className="insight-emoji">{insight.emoji}</span>
                    <span className="section-kicker">{index === 0 ? "Signal prioritaire" : "Lecture du radar"}</span>
                    <h3>{insight.title}</h3>
                    <p>{insight.summary}</p>
                    {insight.evidence ? <small>{insight.evidence}</small> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="overview-columns social-overview-columns">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="section-kicker">Top performance</span>
                    <h3>Les posts qui fonctionnent le mieux</h3>
                  </div>
                  <button className="text-button" type="button" onClick={() => setView("top")}>Voir tout →</button>
                </div>
                <div className="top-post-list">
                  {topPosts.slice(0, 5).map((post, index) => (
                    <PostRow post={post} rank={index + 1} key={post.id} />
                  ))}
                </div>
              </div>

              <div className="panel methodology-panel">
                <div className="panel-head">
                  <div>
                    <span className="section-kicker">Score explicable</span>
                    <h3>Comparaisons honnêtes</h3>
                  </div>
                  <span className="audit-lock">🔒</span>
                </div>
                <div className="method-list">
                  <div><span>01</span><p><b>Chaque réseau est comparé à lui-même.</b> Les vues TikTok ne sont jamais comparées brutes aux likes Instagram.</p></div>
                  <div><span>02</span><p><b>L’âge du post est intégré quand sa date est publique.</b> Sans date, le radar signale qu’il compare seulement les volumes visibles.</p></div>
                  <div><span>03</span><p><b>Les métriques absentes sont retirées.</b> Elles ne sont jamais remplacées artificiellement par zéro.</p></div>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {workspace && (view === "top" || view === "all") ? (
          <div className="view-stack">
            <div className="toolbar social-toolbar">
              <div className="filter-tabs" aria-label="Filtrer par plateforme">
                <button className={platform === "all" ? "active" : ""} type="button" onClick={() => setPlatform("all")}>Tous</button>
                {(Object.keys(PLATFORM_META) as Platform[]).map((key) => (
                  <button className={platform === key ? "active" : ""} type="button" key={key} onClick={() => setPlatform(key)}>
                    {PLATFORM_META[key].emoji} {PLATFORM_META[key].label}
                  </button>
                ))}
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Chercher une accroche, un format…" />
              </label>
              <span className="result-count"><b>{filteredPosts.length}</b> contenus</span>
            </div>

            <div className={view === "top" ? "post-grid" : "post-list-grid"}>
              {(view === "top" ? filteredPosts.slice(0, 20) : filteredPosts).map((post, index) => (
                <PostCard post={post} rank={index + 1} compact={view === "all"} key={post.id} />
              ))}
            </div>
            {!filteredPosts.length ? (
              <div className="empty-state">
                <span>🔎</span>
                <h3>Aucun contenu pour ce filtre</h3>
                <p>Relance un scan ou choisis une autre plateforme.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {workspace && view === "sources" ? (
          <div className="view-stack">
            <div className="source-notice">
              <span>🛰️</span>
              <div>
                <b>Première base : signaux publics réellement visibles</b>
                <p>Le radar collecte ce que chaque réseau rend public. Les connexions propriétaires ajouteront ensuite portée, watch time, sauvegardes et rétention.</p>
              </div>
            </div>
            <div className="sources-detail-grid">
              {accounts.map((account) => {
                const meta = PLATFORM_META[account.platform];
                return (
                  <article className={`source-detail-card tone-${meta.tone}`} key={account.id}>
                    <div className="source-detail-head">
                      <span className="source-logo large">{meta.emoji}</span>
                      <div>
                        <span className="section-kicker">Compte officiel vérifié</span>
                        <h3>{meta.label} · @{account.handle}</h3>
                      </div>
                      <span className={`source-state ${account.status}`}>{account.status === "error" ? "Erreur" : account.status === "limited" ? "Couverture limitée" : "Actif"}</span>
                    </div>
                    <div className="source-kpis">
                      <div><b>{formatNumber(account.follower_count)}</b><span>abonnés visibles</span></div>
                      <div><b>{account.post_count}</b><span>posts collectés</span></div>
                      <div><b>{formatDate(account.last_success_at, true)}</b><span>dernier succès</span></div>
                    </div>
                    <div className="coverage-box">
                      <span>Couverture</span>
                      <p>{account.coverage_label}</p>
                      {account.last_error ? <small>Dernière limite : {account.last_error}</small> : null}
                    </div>
                    <div className="source-actions">
                      <a className="button ghost compact" href={account.profile_url} target="_blank" rel="noreferrer">Voir le profil ↗</a>
                      <button className="button primary compact" type="button" disabled={scanning} onClick={() => void runScan(account.platform)}>↻ Scanner {meta.label}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}
      </main>

      {toast ? <div className="toast">✅ {toast}</div> : null}
    </div>
  );
}

function PostRow({ post, rank }: { post: SocialPost; rank: number }) {
  const meta = PLATFORM_META[post.platform];
  return (
    <a className="social-post-row" href={post.url} target="_blank" rel="noreferrer">
      <span className="rank">{String(rank).padStart(2, "0")}</span>
      <span className="post-platform-icon">{meta.emoji}</span>
      <span className="post-row-copy">
        <b>{post.title || post.text || "Publication sans légende"}</b>
        <small>{meta.label} · {post.format} · {post.published_at ? `il y a ${relativeAge(post.published_at)}` : "date publique absente"}</small>
      </span>
      <span className="row-metrics">
        {metrics(post).slice(0, 2).map((metric) => (
          <span key={metric.label}>{metric.icon} {formatNumber(metric.value)}</span>
        ))}
      </span>
      <span className={`mini-score score-${scoreTone(post.performance_score)}`}>{post.performance_score ?? "—"}</span>
    </a>
  );
}

function PostCard({ post, rank, compact }: { post: SocialPost; rank: number; compact: boolean }) {
  const meta = PLATFORM_META[post.platform];
  return (
    <article className={`social-post-card ${compact ? "compact" : ""}`}>
      <a className="post-visual" href={post.url} target="_blank" rel="noreferrer" aria-label={`Ouvrir sur ${meta.label}`}>
        {post.thumbnail_url ? <img src={post.thumbnail_url} alt="" loading="lazy" /> : <span>{meta.emoji}</span>}
        <span className={`platform-badge tone-${meta.tone}`}>{meta.emoji} {meta.label}</span>
        <span className="post-rank">#{rank}</span>
      </a>
      <div className="post-card-body">
        <div className="post-card-title">
          <div>
            <span className="section-kicker">{postLabel(post)} · {post.format}</span>
            <h3>{post.title || post.text || "Publication sans légende"}</h3>
          </div>
          <span className={`score-badge score-${scoreTone(post.performance_score)}`}>
            <b>{post.performance_score ?? "—"}</b><small>/100</small>
          </span>
        </div>
        <div className="metric-row">
          {metrics(post).map((metric) => (
            <span key={metric.label} title={metric.label}>{metric.icon} <b>{formatNumber(metric.value)}</b></span>
          ))}
        </div>
        {!compact ? (
          <div className="why-box">
            <span>Pourquoi ça ressort</span>
            <p>{post.score_explanation}</p>
          </div>
        ) : null}
        <footer>
          <span>{post.published_at ? `Publié il y a ${relativeAge(post.published_at)}` : "Date publique absente"} · relevé {formatDate(post.last_metric_at, true)}</span>
          <span className={`confidence confidence-${post.score_confidence}`}>{confidenceLabel(post.score_confidence)}</span>
        </footer>
      </div>
    </article>
  );
}
