import {
  pgTable, text, integer, real, jsonb, bigserial, timestamp, boolean, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// Packet data is ingested once into these tables and never updated.
// Every row is scoped by packet_id (and through it return/client/firm), and
// packet-local ids such as "ev-0016" are unique only within their packet.

export const firms = pgTable("firms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  firmId: text("firm_id").notNull(),
  name: text("name").notNull(),
});

export const returns = pgTable("returns", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  taxYear: integer("tax_year").notNull(),
}, (t) => [uniqueIndex("returns_client_year").on(t.clientId, t.taxYear)]);

export const packets = pgTable("packets", {
  id: text("id").primaryKey(),
  returnId: text("return_id").notNull(),
  packetHash: text("packet_hash").notNull(),
  schemaVersion: text("schema_version").notNull(),
  generated: text("generated").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  /** the return's current packet is the most recently activated one */
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  sections: jsonb("sections").notNull(),
}, (t) => [uniqueIndex("packets_hash").on(t.packetHash), index("packets_return").on(t.returnId)]);

export const documents = pgTable("documents", {
  packetId: text("packet_id").notNull(),
  localId: text("local_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  ord: integer("ord").notNull(),
  meta: jsonb("meta").notNull(),
}, (t) => [primaryKey({ columns: [t.packetId, t.localId] })]);

export const pages = pgTable("pages", {
  packetId: text("packet_id").notNull(),
  documentId: text("document_id").notNull(),
  page: integer("page").notNull(),
  printedContent: text("printed_content").notNull(),
}, (t) => [primaryKey({ columns: [t.packetId, t.documentId, t.page] })]);

export const extractedValues = pgTable("extracted_values", {
  packetId: text("packet_id").notNull(),
  localId: text("local_id").notNull(),
  documentId: text("document_id").notNull(),
  page: integer("page").notNull(),
  field: text("field").notNull(),
  anchor: text("anchor").notNull(),
  label: text("label").notNull(),
  value: jsonb("value"),
  valueType: text("value_type").notNull(),
  textAsRead: text("text_as_read").notNull(),
  position: jsonb("position").notNull(),
  confidence: real("confidence").notNull(),
  ord: integer("ord").notNull(),
}, (t) => [
  primaryKey({ columns: [t.packetId, t.localId] }),
  index("ev_doc").on(t.packetId, t.documentId),
  index("ev_anchor").on(t.packetId, t.anchor),
]);

export const returnVersions = pgTable("return_versions", {
  packetId: text("packet_id").notNull(),
  version: text("version").notNull(),
  computedAt: text("computed_at").notNull(),
  meta: jsonb("meta").notNull(),
}, (t) => [primaryKey({ columns: [t.packetId, t.version] })]);

export const lines = pgTable("lines", {
  packetId: text("packet_id").notNull(),
  version: text("version").notNull(),
  key: text("key").notNull(),
  form: text("form").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  label: text("label").notNull(),
  value: jsonb("value"),
  rule: text("rule").notNull(),
  note: text("note"),
  ord: integer("ord").notNull(),
}, (t) => [primaryKey({ columns: [t.packetId, t.version, t.key] }), index("lines_form").on(t.packetId, t.version, t.form)]);

// Trace graph: line --source--> ev / ref, line --input--> line, doc --supersedes--> doc.
export const edges = pgTable("edges", {
  packetId: text("packet_id").notNull(),
  version: text("version").notNull(),
  fromRef: text("from_ref").notNull(),
  toRef: text("to_ref").notNull(),
  kind: text("kind").notNull(),
}, (t) => [index("edges_to").on(t.packetId, t.toRef), index("edges_from").on(t.packetId, t.fromRef)]);

// Append-only log of everything people do. Never updated, never deleted.
export const events = pgTable("events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  id: text("id").notNull(),
  returnId: text("return_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  simAt: text("sim_at").notNull(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role").notNull(),
  type: text("type").notNull(),
  target: text("target").notNull(),
  anchor: text("anchor"),
  payload: jsonb("payload").notNull(),
  batchId: text("batch_id"),
  layer: text("layer").notNull(),
}, (t) => [
  uniqueIndex("events_id").on(t.id),
  index("events_return_seq").on(t.returnId, t.seq),
  index("events_return_target").on(t.returnId, t.target),
]);

// Materialized headline state per return, written after every change. Firm-wide
// status reads these rows instead of replaying each return's log.
export const returnSnapshots = pgTable("return_snapshots", {
  returnId: text("return_id").primaryKey(),
  packetId: text("packet_id").notNull(),
  seq: integer("seq").notNull(),
  asOf: text("as_of").notNull(),
  phase: text("phase").notNull(),
  totals: jsonb("totals").notNull(),
  openIssues: integer("open_issues").notNull(),
  blockers: jsonb("blockers").notNull(),
  events: integer("events").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const readMarks = pgTable("read_marks", {
  returnId: text("return_id").notNull(),
  actorId: text("actor_id").notNull(),
  lastSeenSeq: integer("last_seen_seq").notNull(),
}, (t) => [primaryKey({ columns: [t.returnId, t.actorId] })]);

export const attachments = pgTable("attachments", {
  id: text("id").primaryKey(),
  returnId: text("return_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
});

// DDL kept next to the table definitions; applied idempotently at startup so the
// app works against a fresh Neon database or the embedded local Postgres.
export const DDL = `
CREATE TABLE IF NOT EXISTS firms (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id text PRIMARY KEY, firm_id text NOT NULL, name text NOT NULL);
CREATE TABLE IF NOT EXISTS returns (id text PRIMARY KEY, client_id text NOT NULL, tax_year integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS returns_client_year ON returns (client_id, tax_year);
CREATE TABLE IF NOT EXISTS packets (id text PRIMARY KEY, return_id text NOT NULL, packet_hash text NOT NULL,
  schema_version text NOT NULL, generated text NOT NULL, ingested_at timestamptz NOT NULL, sections jsonb NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS packets_hash ON packets (packet_hash);
CREATE INDEX IF NOT EXISTS packets_return ON packets (return_id);
ALTER TABLE packets ADD COLUMN IF NOT EXISTS activated_at timestamptz;
CREATE TABLE IF NOT EXISTS documents (packet_id text NOT NULL, local_id text NOT NULL, fingerprint text NOT NULL,
  ord integer NOT NULL, meta jsonb NOT NULL, PRIMARY KEY (packet_id, local_id));
CREATE TABLE IF NOT EXISTS pages (packet_id text NOT NULL, document_id text NOT NULL, page integer NOT NULL,
  printed_content text NOT NULL, PRIMARY KEY (packet_id, document_id, page));
CREATE TABLE IF NOT EXISTS extracted_values (packet_id text NOT NULL, local_id text NOT NULL, document_id text NOT NULL,
  page integer NOT NULL, field text NOT NULL, anchor text NOT NULL, label text NOT NULL, value jsonb, value_type text NOT NULL,
  text_as_read text NOT NULL, position jsonb NOT NULL, confidence real NOT NULL, ord integer NOT NULL,
  PRIMARY KEY (packet_id, local_id));
CREATE INDEX IF NOT EXISTS ev_doc ON extracted_values (packet_id, document_id);
CREATE INDEX IF NOT EXISTS ev_anchor ON extracted_values (packet_id, anchor);
CREATE TABLE IF NOT EXISTS return_versions (packet_id text NOT NULL, version text NOT NULL, computed_at text NOT NULL,
  meta jsonb NOT NULL, PRIMARY KEY (packet_id, version));
CREATE TABLE IF NOT EXISTS lines (packet_id text NOT NULL, version text NOT NULL, key text NOT NULL, form text NOT NULL,
  jurisdiction text NOT NULL, label text NOT NULL, value jsonb, rule text NOT NULL, note text, ord integer NOT NULL,
  PRIMARY KEY (packet_id, version, key));
CREATE INDEX IF NOT EXISTS lines_form ON lines (packet_id, version, form);
CREATE TABLE IF NOT EXISTS edges (packet_id text NOT NULL, version text NOT NULL, from_ref text NOT NULL,
  to_ref text NOT NULL, kind text NOT NULL);
CREATE INDEX IF NOT EXISTS edges_to ON edges (packet_id, to_ref);
CREATE INDEX IF NOT EXISTS edges_from ON edges (packet_id, from_ref);
CREATE TABLE IF NOT EXISTS events (seq bigserial PRIMARY KEY, id text NOT NULL, return_id text NOT NULL,
  at timestamptz NOT NULL, sim_at text NOT NULL, actor_id text NOT NULL, actor_role text NOT NULL, type text NOT NULL,
  target text NOT NULL, anchor text, payload jsonb NOT NULL, batch_id text, layer text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS events_id ON events (id);
CREATE INDEX IF NOT EXISTS events_return_seq ON events (return_id, seq);
CREATE INDEX IF NOT EXISTS events_return_target ON events (return_id, target);
CREATE TABLE IF NOT EXISTS return_snapshots (return_id text PRIMARY KEY, packet_id text NOT NULL, seq integer NOT NULL,
  as_of text NOT NULL, phase text NOT NULL, totals jsonb NOT NULL, open_issues integer NOT NULL, blockers jsonb NOT NULL,
  events integer NOT NULL, updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS read_marks (return_id text NOT NULL, actor_id text NOT NULL, last_seen_seq integer NOT NULL,
  PRIMARY KEY (return_id, actor_id));
CREATE TABLE IF NOT EXISTS attachments (id text PRIMARY KEY, return_id text NOT NULL, name text NOT NULL, mime text NOT NULL,
  size integer NOT NULL, data text NOT NULL, created_at timestamptz NOT NULL, sensitive boolean NOT NULL DEFAULT false);
`;
