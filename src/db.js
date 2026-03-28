import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function nowIso() {
  return new Date().toISOString();
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
    CREATE TABLE IF NOT EXISTS equipments (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      location TEXT,
      total_count INTEGER NOT NULL CHECK (total_count >= 1),
      note TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_equipments_name ON equipments(name);
    CREATE INDEX IF NOT EXISTS idx_equipments_category ON equipments(category);

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      equipment_id TEXT NOT NULL,
      borrower_name TEXT NOT NULL,
      borrower_contact TEXT,
      purpose TEXT,
      expected_return_date TEXT,
      status TEXT NOT NULL,
      borrowed_at TEXT NOT NULL,
      returned_at TEXT,
      returned_condition TEXT,
      return_note TEXT,
      FOREIGN KEY (equipment_id) REFERENCES equipments(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_loans_equipment ON loans(equipment_id);
    CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
    CREATE INDEX IF NOT EXISTS idx_loans_borrowed_at ON loans(borrowed_at DESC);
  `);
}

function normalizeLimit(limit, fallback = 100) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

export function createEquipment(db, { id, name, category, location, totalCount, note }) {
  db.prepare(
    `INSERT INTO equipments (id, created_at, name, category, location, total_count, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    nowIso(),
    name.trim(),
    category?.trim() || null,
    location?.trim() || null,
    totalCount,
    note?.trim() || null
  );
  return getEquipmentById(db, id);
}

export function getEquipmentById(db, equipmentId) {
  return (
    db
      .prepare(
        `SELECT
          e.*,
          (
            SELECT COUNT(*)
            FROM loans l
            WHERE l.equipment_id = e.id AND l.status = 'BORROWED'
          ) AS borrowed_count
        FROM equipments e
        WHERE e.id = ?`
      )
      .get(equipmentId) ?? null
  );
}

export function listEquipments(db) {
  const rows = db
    .prepare(
      `SELECT
        e.*,
        (
          SELECT COUNT(*)
          FROM loans l
          WHERE l.equipment_id = e.id AND l.status = 'BORROWED'
        ) AS borrowed_count
      FROM equipments e
      ORDER BY e.created_at DESC`
    )
    .all();
  return rows.map((row) => ({
    ...row,
    available_count: Math.max(0, row.total_count - (row.borrowed_count || 0))
  }));
}

export function listLoans(db, { status = 'ALL', limit = 100 } = {}) {
  const normalizedStatus = String(status || 'ALL').toUpperCase();
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedStatus === 'BORROWED' || normalizedStatus === 'RETURNED') {
    return db
      .prepare(
        `SELECT
          l.*,
          e.name AS equipment_name,
          e.category AS equipment_category
        FROM loans l
        JOIN equipments e ON e.id = l.equipment_id
        WHERE l.status = ?
        ORDER BY l.borrowed_at DESC
        LIMIT ?`
      )
      .all(normalizedStatus, normalizedLimit);
  }

  return db
    .prepare(
      `SELECT
        l.*,
        e.name AS equipment_name,
        e.category AS equipment_category
      FROM loans l
      JOIN equipments e ON e.id = l.equipment_id
      ORDER BY l.borrowed_at DESC
      LIMIT ?`
    )
    .all(normalizedLimit);
}

export function getLoanById(db, loanId) {
  return db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) ?? null;
}

export function createLoan(db, { id, equipmentId, borrowerName, borrowerContact, purpose, expectedReturnDate }) {
  const tx = db.transaction(() => {
    const equipment = getEquipmentById(db, equipmentId);
    if (!equipment) {
      throw new Error('equipment_not_found');
    }

    const borrowedCount = Number(equipment.borrowed_count || 0);
    const available = Number(equipment.total_count || 0) - borrowedCount;
    if (available <= 0) {
      throw new Error('equipment_unavailable');
    }

    const now = nowIso();
    db.prepare(
      `INSERT INTO loans (
        id, created_at, equipment_id, borrower_name, borrower_contact, purpose,
        expected_return_date, status, borrowed_at, returned_at, returned_condition, return_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BORROWED', ?, NULL, NULL, NULL)`
    ).run(
      id,
      now,
      equipmentId,
      borrowerName.trim(),
      borrowerContact?.trim() || null,
      purpose?.trim() || null,
      expectedReturnDate || null,
      now
    );
  });

  tx();
  return getLoanById(db, id);
}

export function returnLoan(db, { loanId, returnedCondition, returnNote }) {
  const loan = getLoanById(db, loanId);
  if (!loan) return { ok: false, error: 'loan_not_found' };
  if (loan.status !== 'BORROWED') return { ok: false, error: 'already_returned' };

  db.prepare(
    `UPDATE loans
     SET status = 'RETURNED',
         returned_at = ?,
         returned_condition = ?,
         return_note = ?
     WHERE id = ?`
  ).run(nowIso(), returnedCondition?.trim() || null, returnNote?.trim() || null, loanId);

  return { ok: true };
}

export function summaryStats(db) {
  const equipmentRows = db
    .prepare(
      `SELECT
        COUNT(*) AS equipment_total,
        COALESCE(SUM(total_count), 0) AS stock_total
      FROM equipments`
    )
    .get();

  const loanRows = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status = 'BORROWED' THEN 1 ELSE 0 END) AS borrowed_total,
        SUM(CASE WHEN status = 'RETURNED' THEN 1 ELSE 0 END) AS returned_total
      FROM loans`
    )
    .get();

  const borrowedNow = Number(loanRows?.borrowed_total || 0);
  const stockTotal = Number(equipmentRows?.stock_total || 0);

  return {
    equipmentTotal: Number(equipmentRows?.equipment_total || 0),
    stockTotal,
    borrowedNow,
    availableNow: Math.max(0, stockTotal - borrowedNow),
    returnedTotal: Number(loanRows?.returned_total || 0)
  };
}

