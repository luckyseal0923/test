import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import {
  openDb,
  createDoc,
  getDoc,
  listFieldsWithSignatures,
  replaceFields,
  setDocStatus,
  upsertSignature,
  docCompletionStats,
  setSignedPdfPath,
  setWebhookUrl,
  listDocs,
  getField
} from './src/db.js';
import { stampSignedPdf } from './src/pdf.js';
import { fireWebhook } from './src/webhook.js';

const app = express();
const db = openDb();

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SIG_DIR = path.join(DATA_DIR, 'signatures');
const SIGNED_DIR = path.join(DATA_DIR, 'signed');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SIG_DIR, { recursive: true });
fs.mkdirSync(SIGNED_DIR, { recursive: true });

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/assets', express.static(path.join(process.cwd(), 'public')));

function absoluteUrl(req, pathname) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}${pathname}`;
}

function getRole(doc, token) {
  if (!doc || !token) return null;
  if (token === doc.initiator_token) return 'initiator';
  if (token === doc.signer_token) return 'signer';
  return null;
}

function requireDoc(req, res) {
  const doc = getDoc(db, req.params.docId);
  if (!doc) {
    res.status(404).json({ error: 'doc_not_found' });
    return null;
  }
  return doc;
}

function requireRole(req, res, doc, roles) {
  const token = String(req.query.token || req.headers['x-doc-token'] || '');
  const role = getRole(doc, token);
  if (!role || !roles.includes(role)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return { role, token };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const docId = nanoid(12);
      req._docId = docId;
      cb(null, `${docId}.pdf`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    cb(ok ? null : new Error('Only PDF allowed'), ok);
  },
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.get('/doc/:docId/config', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'config.html'));
});

app.get('/doc/:docId/dashboard', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html'));
});

app.get('/sign/:docId', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'sign.html'));
});

// ---- API

app.post('/api/docs', upload.single('pdf'), (req, res) => {
  const docId = req._docId;
  if (!docId || !req.file) return res.status(400).json({ error: 'upload_failed' });

  const initiatorToken = nanoid(24);
  const signerToken = nanoid(24);
  const pdfPath = path.join(UPLOAD_DIR, `${docId}.pdf`);

  const doc = createDoc(db, {
    id: docId,
    originalFilename: req.file.originalname || 'document.pdf',
    pdfPath,
    initiatorToken,
    signerToken
  });

  const dashboardPath = `/doc/${docId}/dashboard?token=${encodeURIComponent(initiatorToken)}`;
  const configPath = `/doc/${docId}/config?token=${encodeURIComponent(initiatorToken)}`;
  const signerPath = `/sign/${docId}?token=${encodeURIComponent(signerToken)}`;

  res.json({
    docId,
    status: doc.status,
    dashboardUrl: absoluteUrl(req, dashboardPath),
    configUrl: absoluteUrl(req, configPath),
    signerUrl: absoluteUrl(req, signerPath)
  });
});

app.get('/api/doc/:docId', (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['initiator', 'signer']);
  if (!auth) return;

  const stats = docCompletionStats(db, doc.id);
  const signerUrl =
    auth.role === 'initiator'
      ? absoluteUrl(req, `/sign/${doc.id}?token=${encodeURIComponent(doc.signer_token)}`)
      : undefined;
  res.json({
    doc: {
      id: doc.id,
      created_at: doc.created_at,
      original_filename: doc.original_filename,
      status: doc.status,
      signed_pdf_available: Boolean(doc.signed_pdf_path),
      signer_url: signerUrl,
      webhook_url: auth.role === 'initiator' ? doc.webhook_url : undefined
    },
    stats
  });
});

app.get('/api/doc/:docId/fields', (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['initiator', 'signer']);
  if (!auth) return;
  const rows = listFieldsWithSignatures(db, doc.id);
  res.json({ fields: rows });
});

app.post('/api/doc/:docId/fields', (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['initiator']);
  if (!auth) return;

  const bodyFields = Array.isArray(req.body?.fields) ? req.body.fields : null;
  if (!bodyFields) return res.status(400).json({ error: 'fields_required' });

  const cleaned = [];
  for (const raw of bodyFields) {
    const page = Number(raw.page);
    const type = raw.type === 'text' ? 'text' : 'signature';
    const x = Number(raw.x);
    const y = Number(raw.y);
    const w = Number(raw.w);
    const h = Number(raw.h);
    const required = raw.required !== false;
    if (!Number.isInteger(page) || page < 1) continue;
    if (![x, y, w, h].every((n) => Number.isFinite(n))) continue;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) continue;
    cleaned.push({
      id: String(raw.id || nanoid(10)),
      page,
      type,
      label: raw.label ? String(raw.label).slice(0, 50) : null,
      x,
      y,
      w,
      h,
      required
    });
  }

  if (cleaned.length === 0) return res.status(400).json({ error: 'no_valid_fields' });

  replaceFields(db, doc.id, cleaned);
  setDocStatus(db, doc.id, 'CONFIGURED');

  res.json({ ok: true, fieldCount: cleaned.length });
});

app.post('/api/doc/:docId/webhook', (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['initiator']);
  if (!auth) return;
  const webhookUrl = req.body?.webhookUrl ? String(req.body.webhookUrl).trim() : '';
  setWebhookUrl(db, doc.id, webhookUrl || null);
  res.json({ ok: true });
});

app.get('/api/doc/:docId/pdf', async (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['initiator', 'signer']);
  if (!auth) return;
  res.setHeader('content-type', 'application/pdf');
  fs.createReadStream(doc.pdf_path).pipe(res);
});

app.post('/api/doc/:docId/field/:fieldId/sign', async (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['signer']);
  if (!auth) return;

  const field = getField(db, req.params.fieldId);
  if (!field || field.doc_id !== doc.id) return res.status(404).json({ error: 'field_not_found' });

  const type = field.type === 'text' ? 'text' : 'signature';
  if (type === 'signature') {
    const dataUrl = String(req.body?.imageDataUrl || '');
    const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'invalid_image' });
    const buf = Buffer.from(m[1], 'base64');
    const outPath = path.join(SIG_DIR, `${doc.id}-${field.id}.png`);
    await fsp.writeFile(outPath, buf);
    upsertSignature(db, {
      id: nanoid(10),
      docId: doc.id,
      fieldId: field.id,
      type: 'signature',
      pngPath: outPath
    });
  } else {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text_required' });
    upsertSignature(db, {
      id: nanoid(10),
      docId: doc.id,
      fieldId: field.id,
      type: 'text',
      textValue: text.slice(0, 200)
    });
  }

  const stats = docCompletionStats(db, doc.id);
  if (stats.requiredTotal > 0 && stats.requiredSigned === stats.requiredTotal) {
    // completed: stamp signed pdf
    const rows = listFieldsWithSignatures(db, doc.id);
    const outPath = path.join(SIGNED_DIR, `${doc.id}-signed.pdf`);
    await stampSignedPdf({
      originalPdfPath: doc.pdf_path,
      outPdfPath: outPath,
      fieldsWithSignatures: rows
    });
    setSignedPdfPath(db, doc.id, outPath);
    setDocStatus(db, doc.id, 'COMPLETED');

    const refreshed = getDoc(db, doc.id);
    const payload = {
      docId: doc.id,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      signedDownloadUrl: absoluteUrl(req, `/api/doc/${doc.id}/download/signed?token=${encodeURIComponent(refreshed.initiator_token)}`)
    };
    await fireWebhook({ webhookUrl: refreshed.webhook_url, payload });
  } else {
    setDocStatus(db, doc.id, 'IN_PROGRESS');
  }

  res.json({ ok: true, stats: docCompletionStats(db, doc.id) });
});

app.get('/api/doc/:docId/download/original', (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['initiator']);
  if (!auth) return;
  res.download(doc.pdf_path, doc.original_filename);
});

app.get('/api/doc/:docId/download/signed', (req, res) => {
  const doc = requireDoc(req, res);
  if (!doc) return;
  const auth = requireRole(req, res, doc, ['initiator']);
  if (!auth) return;
  if (!doc.signed_pdf_path) return res.status(409).json({ error: 'not_completed' });
  const name = doc.original_filename.replace(/\.pdf$/i, '') + '-signed.pdf';
  res.download(doc.signed_pdf_path, name);
});

app.get('/api/board', (req, res) => {
  const boardToken = process.env.BOARD_TOKEN;
  if (boardToken) {
    const token = String(req.query.token || '');
    if (token !== boardToken) return res.status(403).json({ error: 'forbidden' });
  } else {
    return res.status(404).json({ error: 'board_disabled' });
  }
  res.json({ docs: listDocs(db) });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Remote-sign web listening on http://localhost:${PORT}`);
});

