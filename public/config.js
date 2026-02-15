import { apiJson, copyToClipboard, el, getDocIdFromPath, mustToken } from './utils.js';

// pdf.js global
// eslint-disable-next-line no-undef
const pdfjsLib = window['pdfjsLib'];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const docId = getDocIdFromPath();
const token = mustToken();

const docPill = el('docPill');
const dashLink = el('dashLink');
const pageInfo = el('pageInfo');
const prevPage = el('prevPage');
const nextPage = el('nextPage');
const canvas = el('pdfCanvas');
const overlay = el('overlay');
const saveBtn = el('saveFields');
const saveHint = el('saveHint');
const fieldList = el('fieldList');

const fieldType = el('fieldType');
const fieldLabel = el('fieldLabel');
const fieldRequired = el('fieldRequired');

const signerUrlEl = el('signerUrl');
const openSigner = el('openSigner');
const copySigner = el('copySigner');

let pdfDoc = null;
let pageNum = 1;
let totalPages = 1;
let viewport = null;
let fields = [];

function buildInitiatorDashUrl() {
  return `/doc/${docId}/dashboard?token=${encodeURIComponent(token)}`;
}

function buildSignerUrl() {
  return null;
}

function randId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/[^a-z0-9]/gi, '').slice(0, 10);
}

function setOverlaySize() {
  overlay.style.width = `${canvas.clientWidth}px`;
  overlay.style.height = `${canvas.clientHeight}px`;
  overlay.style.left = `${canvas.offsetLeft}px`;
  overlay.style.top = `${canvas.offsetTop}px`;
}

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

function redrawBoxes() {
  overlay.innerHTML = '';
  const pageFields = fields.filter((f) => f.page === pageNum);
  for (const f of pageFields) {
    const box = document.createElement('div');
    box.className = 'box';
    box.style.left = `${f.x * viewport.width}px`;
    box.style.top = `${f.y * viewport.height}px`;
    box.style.width = `${f.w * viewport.width}px`;
    box.style.height = `${f.h * viewport.height}px`;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = `${f.type === 'text' ? '文字' : '簽名'}${f.label ? `｜${f.label}` : ''}`;
    box.appendChild(tag);
    overlay.appendChild(box);
  }
  renderFieldList();
}

function renderFieldList() {
  fieldList.innerHTML = '';
  if (fields.length === 0) {
    const d = document.createElement('div');
    d.className = 'muted small';
    d.textContent = '尚未新增任何欄位。請在左側 PDF 上拖曳拉框。';
    fieldList.appendChild(d);
    return;
  }
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'linkline';
    row.innerHTML = `
      <div class="col" style="gap:4px;min-width:0">
        <div class="muted small">第 ${f.page} 頁｜${f.type === 'text' ? '文字' : '簽名'}｜${f.required ? '必填' : '選填'}</div>
        <div class="mono url">${f.label || '(未命名)'} — (${f.x.toFixed(3)}, ${f.y.toFixed(3)}) ${f.w.toFixed(3)}×${f.h.toFixed(3)}</div>
      </div>
      <div class="row">
        <button class="btn" data-goto="${f.page}" type="button">跳頁</button>
        <button class="btn danger" data-del="${f.id}" type="button">刪除</button>
      </div>
    `;
    row.querySelector('[data-goto]').addEventListener('click', async () => renderPage(Number(f.page)));
    row.querySelector('[data-del]').addEventListener('click', () => {
      fields = fields.filter((x) => x.id !== f.id);
      redrawBoxes();
    });
    fieldList.appendChild(row);
  }
}

let drawing = null;
function onPointerDown(e) {
  if (!viewport) return;
  const rect = overlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  drawing = { startX: x, startY: y, div: document.createElement('div') };
  drawing.div.className = 'box';
  overlay.appendChild(drawing.div);
  e.preventDefault();
}

function onPointerMove(e) {
  if (!drawing || !viewport) return;
  const rect = overlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const left = Math.min(drawing.startX, x);
  const top = Math.min(drawing.startY, y);
  const w = Math.abs(x - drawing.startX);
  const h = Math.abs(y - drawing.startY);
  drawing.div.style.left = `${left}px`;
  drawing.div.style.top = `${top}px`;
  drawing.div.style.width = `${w}px`;
  drawing.div.style.height = `${h}px`;
  e.preventDefault();
}

function onPointerUp() {
  if (!drawing || !viewport) return;
  const leftPx = parseFloat(drawing.div.style.left || '0');
  const topPx = parseFloat(drawing.div.style.top || '0');
  const wPx = parseFloat(drawing.div.style.width || '0');
  const hPx = parseFloat(drawing.div.style.height || '0');
  overlay.removeChild(drawing.div);
  drawing = null;

  if (wPx < 18 || hPx < 18) return;
  const f = {
    id: randId(),
    page: pageNum,
    type: fieldType.value === 'text' ? 'text' : 'signature',
    label: fieldLabel.value.trim() || null,
    required: fieldRequired.checked,
    x: leftPx / viewport.width,
    y: topPx / viewport.height,
    w: wPx / viewport.width,
    h: hPx / viewport.height
  };
  fields.push(f);
  redrawBoxes();
}

async function init() {
  docPill.textContent = `doc:${docId}`;
  dashLink.href = buildInitiatorDashUrl();

  try {
    const docJson = await apiJson(`/api/doc/${docId}?token=${encodeURIComponent(token)}`);
    const signerLink = docJson?.doc?.signer_url;
    if (signerLink) {
      signerUrlEl.textContent = signerLink;
      openSigner.href = signerLink;
      copySigner.addEventListener('click', async () => {
        await copyToClipboard(signerLink);
        copySigner.textContent = '已複製';
        setTimeout(() => (copySigner.textContent = '複製'), 1200);
      });
    } else {
      signerUrlEl.textContent = '(尚未可用)';
      openSigner.href = dashLink.href;
      copySigner.addEventListener('click', async () => {
        await copyToClipboard(dashLink.href);
        copySigner.textContent = '已複製看板連結';
        setTimeout(() => (copySigner.textContent = '複製'), 1200);
      });
    }
  } catch (e) {
    saveHint.textContent = `無法載入：${e}`;
    return;
  }

  await loadPdf();
  await renderPage(1);
}

prevPage.addEventListener('click', () => renderPage(pageNum - 1));
nextPage.addEventListener('click', () => renderPage(pageNum + 1));

overlay.addEventListener('pointerdown', onPointerDown);
overlay.addEventListener('pointermove', onPointerMove);
overlay.addEventListener('pointerup', onPointerUp);
overlay.addEventListener('pointercancel', onPointerUp);

saveBtn.addEventListener('click', async () => {
  saveHint.textContent = '儲存中...';
  try {
    await apiJson(`/api/doc/${docId}/fields?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    saveHint.textContent = `已儲存（${fields.length} 個欄位）。`;
  } catch (e) {
    saveHint.textContent = `失敗：${e}`;
  }
});

window.addEventListener('resize', () => {
  if (pdfDoc) renderPage(pageNum);
});

init();

