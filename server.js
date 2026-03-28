import express from 'express';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  openDb,
  createEquipment,
  createLoan,
  getEquipmentById,
  listEquipments,
  listLoans,
  returnLoan,
  summaryStats
} from './src/db.js';

const app = express();
const db = openDb();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(path.join(process.cwd(), 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

function toNonEmptyString(raw, { max = 200 } = {}) {
  const value = String(raw || '').trim();
  if (!value) return null;
  return value.slice(0, max);
}

function toOptionalString(raw, { max = 200 } = {}) {
  const value = String(raw || '').trim();
  return value ? value.slice(0, max) : null;
}

function toValidDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function toPositiveInt(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 10000) return null;
  return n;
}

app.get('/api/summary', (req, res) => {
  res.json({ stats: summaryStats(db) });
});

app.get('/api/equipments', (req, res) => {
  res.json({ equipments: listEquipments(db) });
});

app.post('/api/equipments', (req, res) => {
  const name = toNonEmptyString(req.body?.name, { max: 100 });
  const totalCount = toPositiveInt(req.body?.totalCount);
  const category = toOptionalString(req.body?.category, { max: 50 });
  const location = toOptionalString(req.body?.location, { max: 100 });
  const note = toOptionalString(req.body?.note, { max: 500 });

  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!totalCount) return res.status(400).json({ error: 'invalid_total_count' });

  const equipment = createEquipment(db, {
    id: nanoid(12),
    name,
    category,
    location,
    totalCount,
    note
  });
  res.status(201).json({ equipment });
});

app.post('/api/loans', (req, res) => {
  const equipmentId = toNonEmptyString(req.body?.equipmentId, { max: 30 });
  const borrowerName = toNonEmptyString(req.body?.borrowerName, { max: 50 });
  const borrowerContact = toOptionalString(req.body?.borrowerContact, { max: 100 });
  const purpose = toOptionalString(req.body?.purpose, { max: 200 });
  const expectedReturnDate = toValidDate(req.body?.expectedReturnDate);

  if (!equipmentId) return res.status(400).json({ error: 'equipment_id_required' });
  if (!borrowerName) return res.status(400).json({ error: 'borrower_name_required' });

  if (!getEquipmentById(db, equipmentId)) {
    return res.status(404).json({ error: 'equipment_not_found' });
  }

  try {
    const loan = createLoan(db, {
      id: nanoid(12),
      equipmentId,
      borrowerName,
      borrowerContact,
      purpose,
      expectedReturnDate
    });
    return res.status(201).json({ loan });
  } catch (error) {
    const message = String(error?.message || '');
    if (message === 'equipment_unavailable') {
      return res.status(409).json({ error: 'equipment_unavailable' });
    }
    if (message === 'equipment_not_found') {
      return res.status(404).json({ error: 'equipment_not_found' });
    }
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/loans', (req, res) => {
  const status = String(req.query.status || 'ALL').toUpperCase();
  const limit = Number(req.query.limit || 100);
  res.json({ loans: listLoans(db, { status, limit }) });
});

app.post('/api/loans/:loanId/return', (req, res) => {
  const returnedCondition = toOptionalString(req.body?.returnedCondition, { max: 100 });
  const returnNote = toOptionalString(req.body?.returnNote, { max: 500 });
  const result = returnLoan(db, {
    loanId: req.params.loanId,
    returnedCondition,
    returnNote
  });

  if (!result.ok) {
    if (result.error === 'loan_not_found') return res.status(404).json({ error: result.error });
    if (result.error === 'already_returned') return res.status(409).json({ error: result.error });
    return res.status(400).json({ error: result.error || 'return_failed' });
  }
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Equipment loan web listening on http://localhost:${PORT}`);
});

