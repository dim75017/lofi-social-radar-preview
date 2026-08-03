"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type View =
  | "overview"
  | "trends"
  | "ideas"
  | "review"
  | "approved"
  | "briefs"
  | "connectors";

type Trend = {
  id: string;
  title: string;
  summary: string;
  platform: string;
  source_label: string;
  source_url: string | null;
  first_detected_at: string;
  velocity_score: number;
  maturity: string;
  saturation_risk: number;
  brand_fit: number;
  brand_risk: number;
  recommendation: "Utiliser" | "Surveiller" | "Ignorer";
  explanation: string;
  origin: "demo" | "manual" | "connector";
};

type IdeaStatus = "review" | "approved" | "rejected";

type Idea = {
  id: string;
  trend_id: string | null;
  title: string;
  concept: string;
  objective: string;
  platform: string;
  format: string;
  character: string;
  hook: string;
  cta: string;
  brand_score: number;
  timing_score: number;
  evidence_score: number;
  feasibility_score: number;
  priority_score: number;
  confidence_label: string;
  score_explanation: string;
  prediction_version: string;
  prediction_snapshot: string;
  production_effort: string;
  status: IdeaStatus;
  decision_note: string | null;
  ideal_publish_at: string | null;
  origin: "demo" | "manual" | "connector";
  row_version: number;
  created_at: string;
  updated_at: string;
};

type Brief = {
  id: string;
  idea_id: string;
  objective: string;
  message: string;
  hook_variants: string;
  storyboard: string;
  asset_requirements: string;
  success_criteria: string;
  owner: string | null;
  deadline: string | null;
  created_at: string;
};

type DecisionEvent = {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor_label: string;
  rationale: string | null;
  created_at: string;
};

type WorkspacePayload = {
  mode: "demo" | "real";
  notice: string;
  trends: Trend[];
  ideas: Idea[];
  briefs: Brief[];
  events: DecisionEvent[];
};

type IdeaDraft = {
  trendId: string;
  title: string;
  concept: string;
  objective: string;
  platform: string;
  format: string;
  character: string;
  hook: string;
  cta: string;
  productionEffort: string;
};

type TrendDraft = {
  title: string;
  summary: string;
  platform: string;
  sourceLabel: string;
  sourceUrl: string;
  brandFit: number;
  velocityScore: number;
};

const NAV: Array<{
  id: View;
  emoji: string;
  label: string;
  group: "Pilotage" | "Production" | "Système";
}> = [
  { id: "overview", emoji: "📊", label: "Vue d’ensemble", group: "Pilotage" },
  { id: "trends", emoji: "🔥", label: "Tendances", group: "Pilotage" },
  { id: "ideas", emoji: "✨", label: "Idées", group: "Production" },
  { id: "review", emoji: "⏳", label: "À valider", group: "Production" },
  { id: "approved", emoji: "✅", label: "Validées", group: "Production" },
  { id: "briefs", emoji: "📝", label: "Briefs", group: "Production" },
  { id: "connectors", emoji: "🔌", label: "Connecteurs", group: "Système" },
];

const VIEW_COPY: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "Vue d’ensemble",
    subtitle: "Les décisions utiles maintenant, pas 200 métriques sans conclusion.",
  },
  trends: {
    title: "Radar tendances",
    subtitle: "Signaux précoces, compatibilité de marque et preuves visibles.",
  },
  ideas: {
    title: "Content Brain",
    subtitle: "Idées reliées à leurs tendances et score éditorial explicable.",
  },
  review: {
    title: "À valider",
    subtitle: "Décider, motiver et conserver la prédiction initiale.",
  },
  approved: {
    title: "Idées validées",
    subtitle: "Validation éditoriale distincte de la mise en Roadmap.",
  },
  briefs: {
    title: "Briefs créatifs",
    subtitle: "Concepts validés transformés en livrables exploitables.",
  },
  connectors: {
    title: "Connecteurs & imports",
    subtitle: "API officielles uniquement, avec repli manuel explicite.",
  },
};

const CONNECTORS = [
  {
    emoji: "▶️",
    name: "YouTube",
    status: "OAuth requis",
    detail: "Analytics propriétaire après autorisation de la chaîne.",
    tone: "red",
  },
  {
    emoji: "📸",
    name: "Instagram",
    status: "Non connecté",
    detail: "Compte professionnel, permissions Meta et App Review.",
    tone: "pink",
  },
  {
    emoji: "🎵",
    name: "TikTok",
    status: "Import manuel",
    detail: "Pas de radar commercial global via Research API.",
    tone: "cyan",
  },
  {
    emoji: "🟠",
    name: "Reddit",
    status: "Accord requis",
    detail: "Usage commercial à encadrer, aucun contournement par scraping.",
    tone: "amber",
  },
  {
    emoji: "💬",
    name: "Discord",
    status: "Bot à installer",
    detail: "Uniquement les serveurs autorisés et intents approuvés.",
    tone: "indigo",
  },
  {
    emoji: "📈",
    name: "Google Trends",
    status: "Alpha limitée",
    detail: "Import manuel jusqu’à obtention d’un accès API officiel.",
    tone: "green",
  },
];

const rejectionReasons = [
  "Hors marque",
  "Trop tard",
  "Signal trop faible",
  "Production trop lourde",
  "Doublon",
  "Autre",
];

const emptyTrendDraft: TrendDraft = {
  title: "",
  summary: "",
  platform: "Instagram",
  sourceLabel: "Import manuel",
  sourceUrl: "",
  brandFit: 75,
  velocityScore: 50,
};

function formatDate(value: string | null, withTime = false) {
  if (!value) return "Non défini";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function readJsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function recommendationTone(recommendation: Trend["recommendation"]) {
  if (recommendation === "Utiliser") return "green";
  if (recommendation === "Surveiller") return "amber";
  return "red";
}

function statusCopy(status: IdeaStatus) {
  if (status === "approved") return { emoji: "✅", label: "Validée", tone: "green" };
  if (status === "rejected") return { emoji: "❌", label: "Refusée", tone: "red" };
  return { emoji: "⏳", label: "À valider", tone: "indigo" };
}

function scoreTone(score: number) {
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "red";
}

export function SocialOS() {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [trendFilter, setTrendFilter] = useState("Toutes");
  const [trendModal, setTrendModal] = useState(false);
  const [ideaModal, setIdeaModal] = useState(false);
  const [decisionModal, setDecisionModal] = useState<"approved" | "rejected" | "review" | null>(null);
  const [briefModal, setBriefModal] = useState(false);
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [selectedBrief, setSelectedBrief] = useState<Brief | null>(null);
  const [trendDraft, setTrendDraft] = useState<TrendDraft>(emptyTrendDraft);
  const [ideaDraft, setIdeaDraft] = useState<IdeaDraft | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [publishDate, setPublishDate] = useState("");

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const payload = (await response.json()) as WorkspacePayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Chargement impossible.");
      setWorkspace(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger l’espace de travail.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWorkspace();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTrendModal(false);
      setIdeaModal(false);
      setDecisionModal(null);
      setBriefModal(false);
      setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const trends = useMemo(() => workspace?.trends ?? [], [workspace]);
  const ideas = useMemo(() => workspace?.ideas ?? [], [workspace]);
  const briefs = useMemo(() => workspace?.briefs ?? [], [workspace]);
  const reviewIdeas = ideas.filter((idea) => idea.status === "review");
  const approvedIdeas = ideas.filter((idea) => idea.status === "approved");

  const navCounts: Partial<Record<View, number>> = {
    trends: trends.length,
    ideas: ideas.length,
    review: reviewIdeas.length,
    approved: approvedIdeas.length,
    briefs: briefs.length,
  };

  const filteredTrends = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr");
    return trends.filter((trend) => {
      const matchesSearch =
        !query ||
        [trend.title, trend.summary, trend.platform, trend.source_label]
          .join(" ")
          .toLocaleLowerCase("fr")
          .includes(query);
      const matchesFilter =
        trendFilter === "Toutes" || trend.recommendation === trendFilter;
      return matchesSearch && matchesFilter;
    });
  }, [search, trendFilter, trends]);

  function switchView(nextView: View) {
    setView(nextView);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openIdeaBuilder(trend: Trend) {
    setSelectedTrend(trend);
    setIdeaDraft({
      trendId: trend.id,
      title: `${trend.title} · version Lofi Girl`,
      concept: `${trend.summary} Le concept est réinterprété avec un rythme calme, une narration visuelle originale et les codes de Lofi Girl.`,
      objective: "Renforcer les sauvegardes et la proximité avec la communauté",
      platform: trend.platform.split(" · ")[0],
      format: "Vidéo courte · 12 s",
      character: "Lofi Girl",
      hook: "Le petit rituel qui remet la journée sur les rails.",
      cta: "Et toi, quel est ton rituel pour repartir ?",
      productionEffort: "Moyen",
    });
    setIdeaModal(true);
  }

  function openDecision(idea: Idea, nextStatus: "approved" | "rejected" | "review") {
    setSelectedIdea(idea);
    setDecisionReason("");
    setPublishDate(idea.ideal_publish_at?.slice(0, 10) ?? "");
    setDecisionModal(nextStatus);
  }

  function openBrief(brief: Brief) {
    setSelectedBrief(brief);
    setBriefModal(true);
  }

  async function submitTrend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/trends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(trendDraft),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Import impossible.");
      setTrendModal(false);
      setTrendDraft(emptyTrendDraft);
      setToast("🔥 Tendance ajoutée avec sa provenance");
      await loadWorkspace();
      setView("trends");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Import impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ideaDraft) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ideaDraft),
      });
      const payload = (await response.json()) as {
        error?: string;
        priority?: number;
      };
      if (!response.ok) throw new Error(payload.error || "Création impossible.");
      setIdeaModal(false);
      setIdeaDraft(null);
      setToast(`✨ Idée créée · priorité ${payload.priority ?? "calculée"}/100`);
      await loadWorkspace();
      setView("review");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Création impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIdea || !decisionModal) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/ideas/${selectedIdea.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: decisionModal,
          rationale: decisionReason,
          idealPublishAt: publishDate || null,
          expectedVersion: selectedIdea.row_version,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Décision impossible.");
      const statusLabel = statusCopy(decisionModal).label;
      setDecisionModal(null);
      setSelectedIdea(null);
      setToast(`${statusCopy(decisionModal).emoji} Idée ${statusLabel.toLowerCase()}`);
      await loadWorkspace();
      setView(decisionModal === "approved" ? "approved" : decisionModal === "rejected" ? "ideas" : "review");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Décision impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function copyBrief(brief: Brief) {
    const idea = ideas.find((item) => item.id === brief.idea_id);
    const text = [
      `📝 ${idea?.title ?? "Brief créatif"}`,
      `Objectif : ${brief.objective}`,
      `Message : ${brief.message}`,
      "Hooks :",
      ...readJsonList(brief.hook_variants).map((item) => `- ${item}`),
      "Storyboard :",
      ...readJsonList(brief.storyboard).map((item) => `- ${item}`),
      "Assets :",
      ...readJsonList(brief.asset_requirements).map((item) => `- ${item}`),
      `Critère de succès : ${brief.success_criteria}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setToast("📋 Brief copié");
    } catch {
      setToast("Copie indisponible · sélectionne le texte du brief");
    }
  }

  return (
    <div className="app-shell">
      <button
        className="burger"
        type="button"
        onClick={() => setMobileOpen((value) => !value)}
        aria-label="Ouvrir la navigation"
        aria-expanded={mobileOpen}
      >
        ☰
      </button>
      <button
        type="button"
        aria-label="Fermer la navigation"
        className={`side-veil ${mobileOpen ? "show" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            ◉
            <span />
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
          <span className="on">◎ Social</span>
        </div>

        <nav className="nav" aria-label="Navigation principale">
          {(["Pilotage", "Production", "Système"] as const).map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {NAV.filter((item) => item.group === group).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={view === item.id ? "active" : ""}
                  onClick={() => switchView(item.id)}
                >
                  <span className="nav-emoji" aria-hidden="true">
                    {item.emoji}
                  </span>
                  <span className="nav-text">{item.label}</span>
                  {navCounts[item.id] !== undefined && (
                    <span className="nav-count">{navCounts[item.id]}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sync-row">
            <span className={`sync-dot ${error ? "error" : loading ? "loading" : ""}`} />
            <div>
              <b>{error ? "Connexion interrompue" : loading ? "Chargement…" : "Base partagée active"}</b>
              <span>{workspace?.mode === "demo" ? "🧪 Données démo" : "Données réelles"}</span>
            </div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadWorkspace()} disabled={loading}>
            ↻ <span>{loading ? "Actualisation…" : "Actualiser"}</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">SOCIAL & COMMUNITY INTELLIGENCE OS</div>
            <h2>
              {NAV.find((item) => item.id === view)?.emoji} {VIEW_COPY[view].title}
              {view === "overview" && <span className="top-pill">Fondation V1</span>}
            </h2>
            <p>{VIEW_COPY[view].subtitle}</p>
          </div>
          <div className="top-actions">
            <span className="demo-pill">🧪 Démo · sources non connectées</span>
            <button className="button secondary" type="button" onClick={() => setTrendModal(true)}>
              ＋ Importer un signal
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <span>⚠️</span>
            <div>
              <b>Action interrompue</b>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => setError("")} aria-label="Fermer l’alerte">
              ×
            </button>
          </div>
        )}

        {loading && !workspace ? (
          <LoadingState />
        ) : view === "overview" ? (
          <Overview
            trends={trends}
            ideas={ideas}
            events={workspace?.events ?? []}
            reviewIdeas={reviewIdeas}
            approvedIdeas={approvedIdeas}
            onView={switchView}
            onBuildIdea={openIdeaBuilder}
            onDecision={openDecision}
          />
        ) : view === "trends" ? (
          <TrendView
            trends={filteredTrends}
            search={search}
            onSearch={setSearch}
            filter={trendFilter}
            onFilter={setTrendFilter}
            onBuildIdea={openIdeaBuilder}
            onImport={() => setTrendModal(true)}
          />
        ) : view === "ideas" ? (
          <IdeaView
            ideas={ideas}
            trends={trends}
            title="Toutes les idées"
            empty="Aucune idée pour l’instant. Transforme un signal du Radar en concept éditorial."
            onDecision={openDecision}
            onViewTrends={() => switchView("trends")}
          />
        ) : view === "review" ? (
          <IdeaView
            ideas={reviewIdeas}
            trends={trends}
            title="File de décision"
            empty="Tout est décidé. Les nouvelles idées apparaîtront ici."
            onDecision={openDecision}
            onViewTrends={() => switchView("trends")}
          />
        ) : view === "approved" ? (
          <ApprovedView
            ideas={approvedIdeas}
            briefs={briefs}
            onOpenBrief={openBrief}
            onViewReview={() => switchView("review")}
          />
        ) : view === "briefs" ? (
          <BriefView
            briefs={briefs}
            ideas={ideas}
            onOpen={openBrief}
            onCopy={copyBrief}
            onViewApproved={() => switchView("approved")}
          />
        ) : (
          <ConnectorView onImport={() => setTrendModal(true)} />
        )}
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}

      {trendModal && (
        <Modal title="🔥 Importer une tendance" subtitle="Ajout manuel avec provenance visible" onClose={() => setTrendModal(false)}>
          <form className="form" onSubmit={submitTrend}>
            <div className="form-note">🔎 Les chiffres saisis restent des observations manuelles, jamais des données API.</div>
            <label>
              <span>Titre du signal</span>
              <input required value={trendDraft.title} onChange={(event) => setTrendDraft({ ...trendDraft, title: event.target.value })} placeholder="Ex. Un rituel visuel émergent" />
            </label>
            <label>
              <span>Résumé et mécanisme observé</span>
              <textarea required rows={4} value={trendDraft.summary} onChange={(event) => setTrendDraft({ ...trendDraft, summary: event.target.value })} placeholder="Décris le mécanisme, sans proposer de copie…" />
            </label>
            <div className="form-grid">
              <label>
                <span>Plateforme</span>
                <select value={trendDraft.platform} onChange={(event) => setTrendDraft({ ...trendDraft, platform: event.target.value })}>
                  <option>YouTube</option><option>Instagram</option><option>TikTok</option><option>Reddit</option><option>Discord</option><option>Pinterest</option><option>Multi-plateforme</option>
                </select>
              </label>
              <label>
                <span>Source</span>
                <input required value={trendDraft.sourceLabel} onChange={(event) => setTrendDraft({ ...trendDraft, sourceLabel: event.target.value })} />
              </label>
            </div>
            <label>
              <span>URL source · facultative</span>
              <input type="url" value={trendDraft.sourceUrl} onChange={(event) => setTrendDraft({ ...trendDraft, sourceUrl: event.target.value })} placeholder="https://…" />
            </label>
            <div className="form-grid">
              <RangeField label="Compatibilité Lofi Girl" value={trendDraft.brandFit} onChange={(value) => setTrendDraft({ ...trendDraft, brandFit: value })} />
              <RangeField label="Vitesse observée" value={trendDraft.velocityScore} onChange={(value) => setTrendDraft({ ...trendDraft, velocityScore: value })} />
            </div>
            <div className="modal-actions"><button className="button ghost" type="button" onClick={() => setTrendModal(false)}>Annuler</button><button className="button primary" type="submit" disabled={saving}>{saving ? "Ajout…" : "🔥 Ajouter au Radar"}</button></div>
          </form>
        </Modal>
      )}

      {ideaModal && ideaDraft && selectedTrend && (
        <Modal title="✨ Transformer en idée" subtitle={`Signal source · ${selectedTrend.title}`} onClose={() => setIdeaModal(false)} wide>
          <form className="form" onSubmit={submitIdea}>
            <div className="source-context"><span>🔥</span><div><b>{selectedTrend.recommendation} · fit {selectedTrend.brand_fit}/100</b><p>{selectedTrend.explanation}</p></div></div>
            <label><span>Titre interne</span><input required value={ideaDraft.title} onChange={(event) => setIdeaDraft({ ...ideaDraft, title: event.target.value })} /></label>
            <label><span>Concept original</span><textarea required rows={4} value={ideaDraft.concept} onChange={(event) => setIdeaDraft({ ...ideaDraft, concept: event.target.value })} /></label>
            <div className="form-grid">
              <label><span>Objectif</span><input required value={ideaDraft.objective} onChange={(event) => setIdeaDraft({ ...ideaDraft, objective: event.target.value })} /></label>
              <label><span>Personnage</span><select value={ideaDraft.character} onChange={(event) => setIdeaDraft({ ...ideaDraft, character: event.target.value })}><option>Lofi Girl</option><option>Synthwave Boy</option><option>Mochi</option><option>Ensemble de personnages</option><option>Sans personnage</option></select></label>
            </div>
            <div className="form-grid thirds">
              <label><span>Plateforme</span><select value={ideaDraft.platform} onChange={(event) => setIdeaDraft({ ...ideaDraft, platform: event.target.value })}><option>YouTube Shorts</option><option>Instagram</option><option>TikTok</option><option>YouTube</option><option>Pinterest</option></select></label>
              <label><span>Format</span><select value={ideaDraft.format} onChange={(event) => setIdeaDraft({ ...ideaDraft, format: event.target.value })}><option>Vidéo courte · 12 s</option><option>Carousel · 5 cartes</option><option>Image éditoriale</option><option>Vidéo · 30 s</option><option>Story interactive</option></select></label>
              <label><span>Effort</span><select value={ideaDraft.productionEffort} onChange={(event) => setIdeaDraft({ ...ideaDraft, productionEffort: event.target.value })}><option>Faible</option><option>Moyen</option><option>Élevé</option></select></label>
            </div>
            <label><span>Hook</span><input required value={ideaDraft.hook} onChange={(event) => setIdeaDraft({ ...ideaDraft, hook: event.target.value })} /></label>
            <label><span>CTA · facultatif</span><input value={ideaDraft.cta} onChange={(event) => setIdeaDraft({ ...ideaDraft, cta: event.target.value })} /></label>
            <div className="immutable-note"><span>🔒</span><div><b>Prévision initiale figée à la création</b><p>Le moteur stockera le score, son explication et sa version avant toute décision humaine.</p></div></div>
            <div className="modal-actions"><button className="button ghost" type="button" onClick={() => setIdeaModal(false)}>Annuler</button><button className="button primary" type="submit" disabled={saving}>{saving ? "Calcul…" : "✨ Créer et envoyer à validation"}</button></div>
          </form>
        </Modal>
      )}

      {decisionModal && selectedIdea && (
        <Modal title={`${statusCopy(decisionModal).emoji} ${statusCopy(decisionModal).label}`} subtitle={selectedIdea.title} onClose={() => setDecisionModal(null)}>
          <form className="form" onSubmit={submitDecision}>
            <div className="decision-score"><ScoreRing score={selectedIdea.priority_score} small /><div><b>Priorité éditoriale · {selectedIdea.priority_score}/100</b><p>{selectedIdea.confidence_label}. La prévision initiale reste immuable.</p></div></div>
            {decisionModal === "rejected" ? (
              <label><span>Motif du refus · obligatoire</span><select required value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)}><option value="">Choisir un motif…</option>{rejectionReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
            ) : (
              <label><span>{decisionModal === "approved" ? "Note de validation" : "Motif de restauration"} · facultatif</span><textarea rows={3} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="Contexte utile pour l’équipe…" /></label>
            )}
            {decisionModal === "approved" && (
              <><label><span>Date idéale · facultative</span><input type="date" value={publishDate} onChange={(event) => setPublishDate(event.target.value)} /></label><div className="form-note">📍 Valider génère le brief mais n’ajoute pas automatiquement l’idée à la Roadmap.</div></>
            )}
            <div className="modal-actions"><button className="button ghost" type="button" onClick={() => setDecisionModal(null)}>Annuler</button><button className={`button ${decisionModal === "rejected" ? "danger" : "success"}`} type="submit" disabled={saving}>{saving ? "Enregistrement…" : `${statusCopy(decisionModal).emoji} Confirmer`}</button></div>
          </form>
        </Modal>
      )}

      {briefModal && selectedBrief && (
        <Modal title="📝 Brief créatif" subtitle={ideas.find((idea) => idea.id === selectedBrief.idea_id)?.title ?? "Idée validée"} onClose={() => setBriefModal(false)} wide>
          <BriefDetail brief={selectedBrief} onCopy={() => void copyBrief(selectedBrief)} />
        </Modal>
      )}
    </div>
  );
}

function Overview({ trends, ideas, events, reviewIdeas, approvedIdeas, onView, onBuildIdea, onDecision }: {
  trends: Trend[]; ideas: Idea[]; events: DecisionEvent[]; reviewIdeas: Idea[]; approvedIdeas: Idea[]; onView: (view: View) => void; onBuildIdea: (trend: Trend) => void; onDecision: (idea: Idea, status: "approved" | "rejected" | "review") => void;
}) {
  const useTrends = trends.filter((trend) => trend.recommendation === "Utiliser");
  const topTrend = useTrends[0];
  const nextIdea = reviewIdeas[0];
  return (
    <div className="view-stack">
      <section className="action-strip">
        <div className="section-heading"><div><span className="section-kicker">À FAIRE MAINTENANT</span><h3>3 décisions qui font avancer l’équipe</h3></div><span className="freshness">Mis à jour à l’ouverture</span></div>
        <div className="action-grid">
          <ActionCard tone="purple" emoji="🔥" label="SIGNAL PRIORITAIRE" title={topTrend?.title ?? "Importer le premier signal"} description={topTrend?.explanation ?? "Aucune tendance exploitable n’est encore disponible."} action={topTrend ? "Transformer en idée" : "Ouvrir le Radar"} onClick={() => topTrend ? onBuildIdea(topTrend) : onView("trends")} />
          <ActionCard tone="green" emoji="⏳" label="DÉCISION ATTENDUE" title={nextIdea?.title ?? "File de validation vide"} description={nextIdea ? `Priorité ${nextIdea.priority_score}/100 · ${nextIdea.confidence_label}` : "Les nouvelles idées soumises apparaîtront ici."} action={nextIdea ? "Décider maintenant" : "Voir les idées"} onClick={() => nextIdea ? onDecision(nextIdea, "approved") : onView("ideas")} />
          <ActionCard tone="blue" emoji="🔌" label="COUVERTURE DATA" title="Aucun connecteur actif" description="Les exemples sont isolés. Branche une API officielle ou importe un signal avec sa provenance." action="Voir les limites" onClick={() => onView("connectors")} />
        </div>
      </section>

      <section>
        <div className="section-heading"><div><span className="section-kicker">BOUCLE ÉDITORIALE</span><h3>De la détection à l’apprentissage</h3></div><button className="text-button" type="button" onClick={() => onView("trends")}>Ouvrir le Radar →</button></div>
        <div className="pipeline">
          <PipelineStep emoji="🔥" label="Tendances" value={trends.length} hint={`${useTrends.length} à utiliser`} active />
          <span className="pipeline-arrow">›</span>
          <PipelineStep emoji="✨" label="Idées" value={ideas.length} hint="score figé" />
          <span className="pipeline-arrow">›</span>
          <PipelineStep emoji="⏳" label="À valider" value={reviewIdeas.length} hint="décision humaine" />
          <span className="pipeline-arrow">›</span>
          <PipelineStep emoji="✅" label="Validées" value={approvedIdeas.length} hint="brief généré" />
          <span className="pipeline-arrow">›</span>
          <PipelineStep emoji="📈" label="Résultats" value={0} hint="à connecter" locked />
        </div>
      </section>

      <section className="overview-columns">
        <div className="panel">
          <div className="panel-head"><div><span className="section-kicker">TENDANCES COMPATIBLES</span><h3>À exploiter tôt</h3></div><button className="icon-button" type="button" onClick={() => onView("trends")} aria-label="Voir toutes les tendances">→</button></div>
          <div className="compact-list">
            {useTrends.slice(0, 3).map((trend, index) => <button type="button" className="compact-row" key={trend.id} onClick={() => onBuildIdea(trend)}><span className="rank">0{index + 1}</span><div><b>{trend.title}</b><span>{trend.platform} · {trend.maturity}</span></div><span className="mini-score">{trend.brand_fit}</span></button>)}
            {!useTrends.length && <EmptyInline text="Aucune tendance à utiliser." />}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div><span className="section-kicker">JOURNAL IMMUABLE</span><h3>Dernières décisions</h3></div><span className="audit-lock">🔒</span></div>
          <div className="activity-list">
            {events.slice(0, 4).map((event) => <div className="activity-row" key={event.id}><span className={`activity-dot ${event.action}`} /><div><b>{event.action === "approved" ? "Idée validée" : event.action === "rejected" ? "Idée refusée" : event.action === "restored" ? "Idée restaurée" : event.entity_type === "trend" ? "Tendance ajoutée" : "Idée créée"}</b><span>{event.actor_label} · {formatDate(event.created_at, true)}</span></div></div>)}
            {!events.length && <EmptyInline text="Le journal se remplira à la première action." />}
          </div>
        </div>
      </section>
    </div>
  );
}

function TrendView({ trends, search, onSearch, filter, onFilter, onBuildIdea, onImport }: { trends: Trend[]; search: string; onSearch: (value: string) => void; filter: string; onFilter: (value: string) => void; onBuildIdea: (trend: Trend) => void; onImport: () => void }) {
  return (
    <div className="view-stack">
      <div className="toolbar"><label className="search-box"><span>🔍</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Rechercher un signal, une plateforme…" /><kbd>⌘ K</kbd></label><div className="filter-tabs">{["Toutes", "Utiliser", "Surveiller", "Ignorer"].map((item) => <button type="button" key={item} className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>{item === "Utiliser" ? "🟢" : item === "Surveiller" ? "🟡" : item === "Ignorer" ? "🔴" : "◎"} {item}</button>)}</div><span className="result-count"><b>{trends.length}</b> signaux</span></div>
      {trends.length ? <div className="trend-grid">{trends.map((trend) => <TrendCard trend={trend} key={trend.id} onBuildIdea={() => onBuildIdea(trend)} />)}</div> : <EmptyState emoji="🔥" title="Aucun signal ne correspond" description="Change les filtres ou importe une tendance avec sa source." action="Importer un signal" onAction={onImport} />}
    </div>
  );
}

function TrendCard({ trend, onBuildIdea }: { trend: Trend; onBuildIdea: () => void }) {
  const tone = recommendationTone(trend.recommendation);
  return (
    <article className={`trend-card tone-${tone}`}>
      <div className="trend-card-top"><div className="source-chip"><span>{trend.platform.includes("YouTube") ? "▶️" : trend.platform.includes("TikTok") ? "🎵" : trend.platform.includes("Pinterest") ? "📌" : "📸"}</span>{trend.platform}</div><span className={`recommendation tone-${tone}`}>{tone === "green" ? "🟢" : tone === "amber" ? "🟡" : "🔴"} {trend.recommendation}</span></div>
      <div><div className="origin-line"><span>{trend.origin === "demo" ? "🧪 EXEMPLE" : trend.origin === "manual" ? "✍️ MANUEL" : "🔌 API"}</span><span>Détectée {formatDate(trend.first_detected_at)}</span></div><h3>{trend.title}</h3><p className="trend-summary">{trend.summary}</p></div>
      <div className="trend-metrics"><Metric label="Vitesse" value={trend.velocity_score} suffix="/100" tone={scoreTone(trend.velocity_score)} /><Metric label="Fit marque" value={trend.brand_fit} suffix="/100" tone={scoreTone(trend.brand_fit)} /><Metric label="Saturation" value={trend.saturation_risk} suffix="%" tone={trend.saturation_risk >= 70 ? "red" : trend.saturation_risk >= 40 ? "amber" : "green"} /></div>
      <div className="trend-tags"><span>📍 {trend.maturity}</span><span>🛡️ Risque {trend.brand_risk}/100</span></div>
      <div className="why-box"><span>💡</span><p>{trend.explanation}</p></div>
      <div className="trend-footer"><span className="source-label">Source · {trend.source_label}</span><button className="button primary compact" type="button" onClick={onBuildIdea} disabled={trend.recommendation === "Ignorer"}>{trend.recommendation === "Ignorer" ? "Signal écarté" : "✨ Transformer en idée"}</button></div>
    </article>
  );
}

function IdeaView({ ideas, trends, title, empty, onDecision, onViewTrends }: { ideas: Idea[]; trends: Trend[]; title: string; empty: string; onDecision: (idea: Idea, status: "approved" | "rejected" | "review") => void; onViewTrends: () => void }) {
  return (
    <div className="view-stack"><div className="section-heading"><div><span className="section-kicker">CONTENT BRAIN</span><h3>{title}</h3></div><span className="result-count"><b>{ideas.length}</b> idées</span></div>{ideas.length ? <div className="idea-list">{ideas.map((idea) => <IdeaCard key={idea.id} idea={idea} trend={trends.find((trend) => trend.id === idea.trend_id)} onDecision={onDecision} />)}</div> : <EmptyState emoji="✨" title="Rien dans cette vue" description={empty} action="Voir les tendances" onAction={onViewTrends} />}</div>
  );
}

function IdeaCard({ idea, trend, onDecision }: { idea: Idea; trend?: Trend; onDecision: (idea: Idea, status: "approved" | "rejected" | "review") => void }) {
  const status = statusCopy(idea.status);
  return (
    <article className="idea-card">
      <div className="idea-main"><div className="idea-meta"><span className={`status-badge tone-${status.tone}`}>{status.emoji} {status.label}</span><span>{idea.platform}</span><span>{idea.format}</span><span>{idea.character}</span></div><h3>{idea.title}</h3><p>{idea.concept}</p><div className="hook-line"><span>HOOK</span><b>“{idea.hook}”</b></div><div className="idea-source">🔥 Source · {trend?.title ?? "Tendance archivée"} <span>·</span> 🔒 score initial {idea.prediction_version}</div></div>
      <div className="idea-score"><ScoreRing score={idea.priority_score} /><span>Priorité éditoriale</span><small>{idea.confidence_label}</small></div>
      <div className="idea-breakdown"><ScoreBar label="Marque" value={idea.brand_score} /><ScoreBar label="Timing" value={idea.timing_score} /><ScoreBar label="Preuves" value={idea.evidence_score} /><ScoreBar label="Faisabilité" value={idea.feasibility_score} /><button className="explain-link" type="button" title={idea.score_explanation}>ⓘ Pourquoi ce score ?</button></div>
      <div className="idea-actions">{idea.status === "review" ? <><button className="round-action reject" type="button" onClick={() => onDecision(idea, "rejected")}><span>✕</span> Refuser</button><button className="round-action approve" type="button" onClick={() => onDecision(idea, "approved")}><span>✓</span> Valider</button></> : idea.status === "rejected" ? <button className="round-action restore" type="button" onClick={() => onDecision(idea, "review")}><span>↩</span> Restaurer</button> : <div className="approved-note"><span>✅</span><div><b>Brief disponible</b><small>Pas encore dans la Roadmap</small></div></div>}</div>
    </article>
  );
}

function ApprovedView({ ideas, briefs, onOpenBrief, onViewReview }: { ideas: Idea[]; briefs: Brief[]; onOpenBrief: (brief: Brief) => void; onViewReview: () => void }) {
  return <div className="view-stack">{ideas.length ? <div className="approved-grid">{ideas.map((idea) => { const brief = briefs.find((item) => item.idea_id === idea.id); return <article className="approved-card" key={idea.id}><div className="approved-icon">✅</div><div className="idea-meta"><span>{idea.platform}</span><span>{idea.format}</span></div><h3>{idea.title}</h3><p>{idea.objective}</p><div className="approved-kpis"><span><b>{idea.priority_score}</b> priorité</span><span><b>{idea.brand_score}</b> marque</span><span><b>{idea.production_effort}</b> effort</span></div><div className="approved-footer"><span>{idea.ideal_publish_at ? `🗓️ ${formatDate(idea.ideal_publish_at)}` : "🗓️ Date à définir"}</span>{brief ? <button className="button primary compact" type="button" onClick={() => onOpenBrief(brief)}>📝 Ouvrir le brief</button> : <span className="status-badge tone-amber">Brief en préparation</span>}</div></article>; })}</div> : <EmptyState emoji="✅" title="Aucune idée validée" description="La validation reste humaine. Une fois confirmée, l’idée et son brief apparaîtront ici." action="Ouvrir la file de décision" onAction={onViewReview} />}</div>;
}

function BriefView({ briefs, ideas, onOpen, onCopy, onViewApproved }: { briefs: Brief[]; ideas: Idea[]; onOpen: (brief: Brief) => void; onCopy: (brief: Brief) => void; onViewApproved: () => void }) {
  return <div className="view-stack">{briefs.length ? <div className="brief-list">{briefs.map((brief) => { const idea = ideas.find((item) => item.id === brief.idea_id); return <article className="brief-row" key={brief.id}><div className="brief-icon">📝</div><div className="brief-copy"><div className="idea-meta"><span>{idea?.platform ?? "Plateforme"}</span><span>{idea?.character ?? "Personnage"}</span><span>{formatDate(brief.created_at)}</span></div><h3>{idea?.title ?? "Brief créatif"}</h3><p>{brief.objective}</p></div><div className="brief-status"><span className="status-badge tone-green">Prêt pour production</span><small>{brief.deadline ? `Cible · ${formatDate(brief.deadline)}` : "Date à définir"}</small></div><div className="brief-actions"><button className="button ghost compact" type="button" onClick={() => onCopy(brief)}>📋 Copier</button><button className="button primary compact" type="button" onClick={() => onOpen(brief)}>Ouvrir →</button></div></article>; })}</div> : <EmptyState emoji="📝" title="Aucun brief" description="Valide d’abord une idée. Son brief créatif sera généré sans la planifier automatiquement." action="Voir les idées validées" onAction={onViewApproved} />}</div>;
}

function ConnectorView({ onImport }: { onImport: () => void }) {
  return <div className="view-stack"><div className="connector-banner"><div className="connector-banner-icon">🛡️</div><div><b>Garde-fou V1 · aucune publication automatique</b><p>Les connecteurs collectent ou importent des données. Tout post, commentaire ou réponse officielle exige une validation humaine.</p></div></div><div className="connector-grid">{CONNECTORS.map((connector) => <article className={`connector-card tone-${connector.tone}`} key={connector.name}><div className="connector-icon">{connector.emoji}</div><div><div className="connector-title"><h3>{connector.name}</h3><span>{connector.status}</span></div><p>{connector.detail}</p></div><button className="button ghost compact" type="button" onClick={onImport}>↥ Import manuel</button></article>)}</div><div className="panel connector-next"><div><span className="section-kicker">PROCHAINE ÉTAPE</span><h3>Brancher YouTube en premier</h3><p>Le connecteur apportera les performances historiques propriétaires. Les autres sources resteront manuelles tant que leurs permissions officielles ne sont pas obtenues.</p></div><div className="connector-checks"><span>✓ OAuth chaîne</span><span>✓ quotas suivis</span><span>✓ audit des imports</span><span>× aucune publication automatique</span></div></div></div>;
}

function BriefDetail({ brief, onCopy }: { brief: Brief; onCopy: () => void }) {
  return <div className="brief-detail"><section><span className="section-kicker">OBJECTIF</span><p>{brief.objective}</p></section><section><span className="section-kicker">MESSAGE</span><p>{brief.message}</p></section><section><span className="section-kicker">VARIANTES DE HOOK</span><ol>{readJsonList(brief.hook_variants).map((item) => <li key={item}>{item}</li>)}</ol></section><section><span className="section-kicker">STORYBOARD</span><ol>{readJsonList(brief.storyboard).map((item) => <li key={item}>{item}</li>)}</ol></section><section><span className="section-kicker">ASSETS REQUIS</span><ul>{readJsonList(brief.asset_requirements).map((item) => <li key={item}>{item}</li>)}</ul></section><section className="success-box"><span>📈</span><div><b>Critère de succès</b><p>{brief.success_criteria}</p></div></section><div className="modal-actions"><button className="button primary" type="button" onClick={onCopy}>📋 Copier le brief</button></div></div>;
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button type="button" onClick={onClose} aria-label="Fermer">×</button></header><div className="modal-body">{children}</div></section></div>;
}

function ActionCard({ tone, emoji, label, title, description, action, onClick }: { tone: string; emoji: string; label: string; title: string; description: string; action: string; onClick: () => void }) { return <article className={`action-card tone-${tone}`}><div className="action-icon">{emoji}</div><div><span className="section-kicker">{label}</span><h3>{title}</h3><p>{description}</p><button className="text-button" type="button" onClick={onClick}>{action} →</button></div></article>; }
function PipelineStep({ emoji, label, value, hint, active = false, locked = false }: { emoji: string; label: string; value: number; hint: string; active?: boolean; locked?: boolean }) { return <div className={`pipeline-step ${active ? "active" : ""} ${locked ? "locked" : ""}`}><span className="pipeline-emoji">{emoji}</span><div><span>{label}</span><b>{value}</b><small>{hint}</small></div></div>; }
function Metric({ label, value, suffix, tone }: { label: string; value: number; suffix: string; tone: string }) { return <div className="metric"><span>{label}</span><b className={`text-${tone}`}>{value}<small>{suffix}</small></b><div className="metric-track"><span className={`bg-${tone}`} style={{ width: `${Math.max(4, value)}%` }} /></div></div>; }
function ScoreRing({ score, small = false }: { score: number; small?: boolean }) { return <div className={`score-ring ${small ? "small" : ""}`} style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}><div><b>{score}</b><span>/100</span></div></div>; }
function ScoreBar({ label, value }: { label: string; value: number }) { return <div className="score-bar"><span>{label}</span><div><i style={{ width: `${value}%` }} /></div><b>{value}</b></div>; }
function RangeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="range-field"><span>{label} <b>{value}/100</b></span><input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function EmptyState({ emoji, title, description, action, onAction }: { emoji: string; title: string; description: string; action: string; onAction: () => void }) { return <div className="empty-state"><span>{emoji}</span><h3>{title}</h3><p>{description}</p><button className="button primary" type="button" onClick={onAction}>{action}</button></div>; }
function EmptyInline({ text }: { text: string }) { return <div className="empty-inline">{text}</div>; }
function LoadingState() { return <div className="loading-grid" role="status" aria-label="Chargement de l’espace"><div className="loading-card" /><div className="loading-card" /><div className="loading-card" /><div className="loading-panel" /></div>; }
