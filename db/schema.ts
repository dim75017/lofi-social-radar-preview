import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const trends = sqliteTable(
  "trends",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    platform: text("platform").notNull(),
    sourceLabel: text("source_label").notNull(),
    sourceUrl: text("source_url"),
    firstDetectedAt: text("first_detected_at").notNull(),
    velocityScore: integer("velocity_score").notNull(),
    maturity: text("maturity").notNull(),
    saturationRisk: integer("saturation_risk").notNull(),
    brandFit: integer("brand_fit").notNull(),
    brandRisk: integer("brand_risk").notNull().default(0),
    recommendation: text("recommendation").notNull(),
    explanation: text("explanation").notNull(),
    origin: text("origin").notNull().default("manual"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_trends_recommendation_fit").on(
      table.recommendation,
      table.brandFit,
    ),
  ],
);

export const ideas = sqliteTable("ideas", {
  id: text("id").primaryKey(),
  trendId: text("trend_id").references(() => trends.id),
  title: text("title").notNull(),
  concept: text("concept").notNull(),
  objective: text("objective").notNull(),
  platform: text("platform").notNull(),
  format: text("format").notNull(),
  character: text("character").notNull(),
  hook: text("hook").notNull(),
  cta: text("cta").notNull().default(""),
  brandScore: integer("brand_score").notNull(),
  timingScore: integer("timing_score").notNull(),
  evidenceScore: integer("evidence_score").notNull(),
  feasibilityScore: integer("feasibility_score").notNull(),
  priorityScore: integer("priority_score").notNull(),
  confidenceLabel: text("confidence_label").notNull(),
  scoreExplanation: text("score_explanation").notNull(),
  predictionVersion: text("prediction_version").notNull(),
  predictionSnapshot: text("prediction_snapshot").notNull(),
  productionEffort: text("production_effort").notNull(),
  status: text("status").notNull().default("review"),
  decisionNote: text("decision_note"),
  idealPublishAt: text("ideal_publish_at"),
  origin: text("origin").notNull().default("manual"),
  rowVersion: integer("row_version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_ideas_status_created").on(table.status, table.createdAt),
]);

export const briefs = sqliteTable("briefs", {
  id: text("id").primaryKey(),
  ideaId: text("idea_id")
    .notNull()
    .unique()
    .references(() => ideas.id),
  objective: text("objective").notNull(),
  message: text("message").notNull(),
  hookVariants: text("hook_variants").notNull(),
  storyboard: text("storyboard").notNull(),
  assetRequirements: text("asset_requirements").notNull(),
  successCriteria: text("success_criteria").notNull(),
  owner: text("owner"),
  deadline: text("deadline"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const decisionEvents = sqliteTable("decision_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actorLabel: text("actor_label").notNull(),
  rationale: text("rationale"),
  immutableSnapshot: text("immutable_snapshot").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_decision_events_entity_created").on(
    table.entityType,
    table.entityId,
    table.createdAt,
  ),
]);
