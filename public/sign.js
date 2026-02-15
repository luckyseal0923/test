import { apiJson, el, getDocIdFromPath, mustToken } from './utils.js';

// pdf.js global
// eslint-disable-next-line no-undef
const pdfjsLib = window['pdfjsLib'];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const docId = getDocIdFromPath();
const token = mustToken();

const docPill = el('docPill');
const pageInfo = el('pageInfo');
const progressEl = el('progress');
const prevPage = el('prevPage');
const nextPage = el('nextPage');
const canvas = el('pdfCanvas');
const overlay = el('overlay');
const todoList = el('todoList');
const doneHint = el('doneHint');

// Signature modal
const sigMask = el('sigMask');
const sigTitle = el('sigTitle');
const sigCanvas = el('sigCanvas');
const sigClear = el('sigClear');
const sigCancel = el('sigCancel');
const sigSave = el('sigSave');

// Text modal
const textMask = el('textMask');
const textTitle = el('textTitle');
const textInput = el('textInput');
const textCancel = el('textCancel');
const textSave = el('textSave');

let pdfDoc = null;
let pageNum = 1;
let totalPages = 1;
let viewport = null;
let fields = [];
let currentField = null;
let sigPad = null;

async function loadPdf() {
  const pdfUrl = `/api/doc/${docId}/pdf?token=${encodeURIComponent(token)}`;
  pdfDoc = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
  totalPages = pdfDoc.numPages;
}

async function renderPage(n) {
  pageNum = Math.max(1, Math.min(totalPages, n));
  pageInfo.textContent = `${pageNum} / ${totalPages}`;

  const page = await pdfDoc.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1 });
  const maxWidth = Math.min(920, document.querySelector('.card').clientWidth - 40);
  const scale = maxWidth / baseViewport.width;
  viewport = page.getViewport({ scale });

  const ctx = canvas.getContext('2d');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  overlay.style.width = canvas.style.width;
  overlay.style.height = canvas.style.height;

  await page.render({ canvasContext: ctx, viewport }).promise;
  redrawBoxes();
}

function statsFromFields() {
  const required = fields.filter((f) => f.required === 1 || f.required === true);
  const signedRequired = required.filter((f) => f.signature_id);
  return { requiredTotal: required.length, requiredSigned: signedRequired.length };
}

function redrawBoxes() {
  overlay.innerHTML = '';
  const pageFields = fields.filter((f) => f.page === pageNum);
  for (const f of pageFields) {
    const box = document.createElement('div');
    box.className = `box ${f.signature_id ? 'signed' : ''}`;
    box.style.left = `${f.x * viewport.width}px`;
    box.style.top = `${f.y * viewport.height}px`;
    box.style.width = `${f.w * viewport.width}px`;
    box.style.height = `${f.h * viewport.height}px`;
    box.style.cursor = f.signature_id ? 'default' : 'pointer';
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = `${f.signature_id ? '已完成' : '點我'}｜${f.type === 'text' ? '文字' : '簽名'}${f.label ? `｜${f.label}` : ''}`;
    box.appendChild(tag);
    if (!f.signature_id) {
      box.addEventListener('click', () => openField(f));
    }
    overlay.appendChild(box);
  }
  renderTodoList();
}

function renderTodoList() {
  todoList.innerHTML = '';
  const pending = fields.filter((f) => !f.signature_id).sort((a, b) => a.page - b.page);
  if (pending.length === 0) {
    const d = document.createElement('div');
    d.className = 'pill';
    d.innerHTML = '<b>全部完成</b> 可關閉此頁';
    todoList.appendChild(d);
    doneHint.textContent = '你已完成所有必填欄位。發起人可在看板下載已簽名 PDF。';
  } else {
    doneHint.textContent = '';
  }
  for (const f of pending.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'linkline';
    row.innerHTML = `
      <div class="col" style="gap:4px;min-width:0">
        <div class="muted small">第 ${f.page} 頁｜${f.type === 'text' ? '文字' : '簽名'}｜${(f.required === 1 || f.required === true) ? '必填' : '選填'}</div>
        <div class="mono url">${f.label || '(未命名)'} </div>
      </div>
      <div class="row">
        <button class="btn" data-goto="${f.page}" type="button">跳頁</button>
        <button class="btn primary" data-open="${f.id}" type="button">開始</button>
      </div>
    `;
    row.querySelector('[data-goto]').addEventListener('click', () => renderPage(Number(f.page)));
    row.querySelector('[data-open]').addEventListener('click', () => {
      renderPage(Number(f.page)).then(() => openField(f));
    });
    todoList.appendChild(row);
  }

  const s = statsFromFields();
  progressEl.textContent = `${s.requiredSigned} / ${s.requiredTotal} 必填`;
}

function openField(f) {
  currentField = f;
  if (f.type === 'text') {
    textTitle.textContent = `文字欄位${f.label ? `：${f.label}` : ''}`;
    textInput.value = '';
    textMask.style.display = 'flex';
    setTimeout(() => textInput.focus(), 30);
  } else {
    sigTitle.textContent = `手寫簽名${f.label ? `：${f.label}` : ''}`;
    sigMask.style.display = 'flex';
    setupSigPad();
  }
}

function closeSig() {
  sigMask.style.display = 'none';
  currentField = null;
}

function closeText() {
  textMask.style.display = 'none';
  currentField = null;
}

function setupSigPad() {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const w = sigCanvas.clientWidth;
  const h = sigCanvas.clientHeight;
  sigCanvas.width = Math.floor(w * ratio);
  sigCanvas.height = Math.floor(h * ratio);
  sigCanvas.getContext('2d').scale(ratio, ratio);

  // eslint-disable-next-line no-undef
  sigPad = new SignaturePad(sigCanvas, {
    minWidth: 1.2,
    maxWidth: 3.2,
    penColor: 'rgb(0,0,0)'
  });
  sigPad.clear();
}

async function refreshFields() {
  const json = await apiJson(`/api/doc/${docId}/fields?token=${encodeURIComponent(token)}`);
  fields = json.fields || [];
  redrawBoxes();
}

prevPage.addEventListener('click', () => renderPage(pageNum - 1));
nextPage.addEventListener('click', () => renderPage(pageNum + 1));

sigClear.addEventListener('click', () => sigPad?.clear());
sigCancel.addEventListener('click', closeSig);
sigSave.addEventListener('click', async () => {
  if (!currentField) return;
  if (!sigPad || sigPad.isEmpty()) return;
  const dataUrl = sigPad.toDataURL('image/png');
  sigSave.textContent = '儲存中...';
  try {
    await apiJson(`/api/doc/${docId}/field/${currentField.id}/sign?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: dataUrl })
    });
    closeSig();
    await refreshFields();
  } catch (e) {
    sigSave.textContent = `失敗：${e}`;
    setTimeout(() => (sigSave.textContent = '儲存'), 1200);
  } finally {
    sigSave.textContent = '儲存';
  }
});

textCancel.addEventListener('click', closeText);
textSave.addEventListener('click', async () => {
  if (!currentField) return;
  const text = textInput.value.trim();
  if (!text) return;
  textSave.textContent = '儲存中...';
  try {
    await apiJson(`/api/doc/${docId}/field/${currentField.id}/sign?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });
    closeText();
    await refreshFields();
  } catch (e) {
    textSave.textContent = `失敗：${e}`;
    setTimeout(() => (textSave.textContent = '儲存'), 1200);
  } finally {
    textSave.textContent = '儲存';
  }
});

window.addEventListener('resize', () => {
  if (pdfDoc) renderPage(pageNum);
});

async function init() {
  docPill.textContent = `doc:${docId}`;
  await apiJson(`/api/doc/${docId}?token=${encodeURIComponent(token)}`);
  await loadPdf();
  await refreshFields();
  await renderPage(1);
}

init().catch((e) => {
  doneHint.textContent = `載入失敗：${e}`;
});

