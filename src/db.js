import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function openDb() {
  ensureDataDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      pdf_path TEXT NOT NULL,
      signed_pdf_path TEXT,
      status TEXT NOT NULL,
      initiator_token TEXT NOT NULL,
      signer_token TEXT NOT NULL,
      webhook_url TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_docs_status ON docs(status);

    CREATE TABLE IF NOT EXISTS fields (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      page INTEGER NOT NULL,
      type TEXT NOT NULL,
      label TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      w REAL NOT NULL,
      h REAL NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (doc_id) REFERENCES docs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_fields_doc ON fields(doc_id);

    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      field_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      type TEXT NOT NULL,
      png_path TEXT,
      text_value TEXT,
      FOREIGN KEY (doc_id) REFERENCES docs(id) ON DELETE CASCADE,
      FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sigs_doc ON signatures(doc_id);
  `);
}

export function nowIso() {
  return new Date().toISOString();
}

export function getDoc(db, docId) {
  return db.prepare('SELECT * FROM docs WHERE id = ?').get(docId) ?? null;
}

export function createDoc(db, { id, originalFilename, pdfPath, initiatorToken, signerToken }) {
  db.prepare(
    `INSERT INTO docs (id, created_at, original_filename, pdf_path, status, initiator_token, signer_token)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, nowIso(), originalFilename, pdfPath, 'DRAFT', initiatorToken, signerToken);
  return getDoc(db, id);
}

export function setDocStatus(db, docId, status) {
  db.prepare('UPDATE docs SET status = ? WHERE id = ?').run(status, docId);
}

export function setSignedPdfPath(db, docId, signedPdfPath) {
  db.prepare('UPDATE docs SET signed_pdf_path = ? WHERE id = ?').run(signedPdfPath, docId);
}

export function setWebhookUrl(db, docId, webhookUrl) {
  db.prepare('UPDATE docs SET webhook_url = ? WHERE id = ?').run(webhookUrl || null, docId);
}

export function replaceFields(db, docId, fields) {
  const del = db.prepare('DELETE FROM fields WHERE doc_id = ?');
  const ins = db.prepare(
    `INSERT INTO fields (id, doc_id, created_at, page, type, label, x, y, w, h, required)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    del.run(docId);
    for (const f of fields) {
      ins.run(
        f.id,
        docId,
        nowIso(),
        f.page,
        f.type,
        f.label ?? null,
        f.x,
        f.y,
        f.w,
        f.h,
        f.required ? 1 : 0
      );
    }
  });
  tx();
}

export function listFieldsWithSignatures(db, docId) {
  return db
    .prepare(
      `SELECT
         f.*,
         s.id as signature_id,
         s.type as signature_type,
         s.png_path as signature_png_path,
         s.text_value as signature_text_value,
         s.created_at as signature_created_at
       FROM fields f
       LEFT JOIN signatures s ON s.field_id = f.id
       WHERE f.doc_id = ?
       ORDER BY f.page ASC, f.created_at ASC`
    )
    .all(docId);
}

export function getField(db, fieldId) {
  return db.prepare('SELECT * FROM fields WHERE id = ?').get(fieldId) ?? null;
}

export function upsertSignature(db, { id, docId, fieldId, type, pngPath, textValue }) {
  db.prepare(
    `INSERT INTO signatures (id, doc_id, field_id, created_at, type, png_path, text_value)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(field_id) DO UPDATE SET
       created_at = excluded.created_at,
       type = excluded.type,
       png_path = excluded.png_path,
       text_value = excluded.text_value`
  ).run(id, docId, fieldId, nowIso(), type, pngPath ?? null, textValue ?? null);
}

export function docCompletionStats(db, docId) {
  const rows = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN required = 1 THEN 1 ELSE 0 END) as required_total,
         SUM(CASE WHEN required = 1 AND s.field_id IS NOT NULL THEN 1 ELSE 0 END) as required_signed,
         SUM(CASE WHEN s.field_id IS NOT NULL THEN 1 ELSE 0 END) as signed_total
       FROM fields f
       LEFT JOIN signatures s ON s.field_id = f.id
       WHERE f.doc_id = ?`
    )
    .get(docId);

  const total = rows?.total ?? 0;
  const requiredTotal = rows?.required_total ?? 0;
  const requiredSigned = rows?.required_signed ?? 0;
  const signedTotal = rows?.signed_total ?? 0;
  return {
    total,
    requiredTotal,
    requiredSigned,
    signedTotal,
    isComplete:
      total > 0 && (requiredTotal > 0 ? requiredSigned === requiredTotal : signedTotal === total)
  };
}

export function listDocs(db, limit = 200) {
  return db
    .prepare(
      `SELECT id, created_at, original_filename, status
       FROM docs
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit);
}

