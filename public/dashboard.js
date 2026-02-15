import { apiJson, copyToClipboard, el, getDocIdFromPath, mustToken } from './utils.js';

const docId = getDocIdFromPath();
const token = mustToken();

const docPill = el('docPill');
const configLink = el('configLink');
const statusEl = el('status');
const progressEl = el('progress');

const dlOriginal = el('dlOriginal');
const dlSigned = el('dlSigned');
const dlHint = el('dlHint');

const signerUrlEl = el('signerUrl');
const openSigner = el('openSigner');
const copySigner = el('copySigner');

const fieldList = el('fieldList');

const webhookUrl = el('webhookUrl');
const saveWebhook = el('saveWebhook');
const webhookHint = el('webhookHint');

function progressFromFields(fields) {
  const required = fields.filter((f) => f.required === 1 || f.required === true);
  const requiredSigned = required.filter((f) => f.signature_id);
  return { requiredTotal: required.length, requiredSigned: requiredSigned.length };
}

function renderFields(fields) {
  fieldList.innerHTML = '';
  if (!fields?.length) {
    const d = document.createElement('div');
    d.className = 'muted small';
    d.textContent = '尚未設定任何欄位。請先到「設定簽名框」拉框後儲存。';
    fieldList.appendChild(d);
    return;
  }
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'linkline';
    row.innerHTML = `
      <div class="col" style="gap:4px;min-width:0">
        <div class="muted small">第 ${f.page} 頁｜${f.type === 'text' ? '文字' : '簽名'}｜${(f.required === 1 || f.required === true) ? '必填' : '選填'}</div>
        <div class="mono url">${f.label || '(未命名)'} — ${f.signature_id ? '✅ 已完成' : '⏳ 未完成'}</div>
      </div>
      <div class="row">
        <span class="pill">${f.signature_id ? '<b style="color:var(--ok)">已簽</b>' : '<b style="color:var(--warn)">待簽</b>'}</span>
      </div>
    `;
    fieldList.appendChild(row);
  }
}

async function refresh() {
  docPill.textContent = `doc:${docId}`;
  configLink.href = `/doc/${docId}/config?token=${encodeURIComponent(token)}`;
  dlOriginal.href = `/api/doc/${docId}/download/original?token=${encodeURIComponent(token)}`;
  dlSigned.href = `/api/doc/${docId}/download/signed?token=${encodeURIComponent(token)}`;

  const docJson = await apiJson(`/api/doc/${docId}?token=${encodeURIComponent(token)}`);
  statusEl.textContent = docJson.doc.status;
  webhookUrl.value = docJson.doc.webhook_url || '';

  const fieldsJson = await apiJson(`/api/doc/${docId}/fields?token=${encodeURIComponent(token)}`);
  const fields = fieldsJson.fields || [];
  renderFields(fields);

  const p = progressFromFields(fields);
  progressEl.textContent = `${p.requiredSigned} / ${p.requiredTotal}`;

  const signerLink = docJson.doc.signer_url;
  if (signerLink) {
    signerUrlEl.textContent = signerLink;
    openSigner.href = signerLink;
    copySigner.onclick = async () => {
      await copyToClipboard(signerLink);
      copySigner.textContent = '已複製';
      setTimeout(() => (copySigner.textContent = '複製'), 1200);
    };
  } else {
    signerUrlEl.textContent = '(尚未可用)';
  }

  if (docJson.doc.signed_pdf_available) {
    dlSigned.style.display = 'inline-flex';
    dlHint.textContent = '已簽名 PDF 已產生。';
  } else {
    dlSigned.style.display = 'none';
    dlHint.textContent = '等待簽名者完成所有必填欄位後，才會自動產生已簽名 PDF。';
  }
}

saveWebhook.addEventListener('click', async () => {
  webhookHint.textContent = '儲存中...';
  try {
    await apiJson(`/api/doc/${docId}/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webhookUrl: webhookUrl.value })
    });
    webhookHint.textContent = '已儲存。';
    setTimeout(() => (webhookHint.textContent = ''), 1200);
  } catch (e) {
    webhookHint.textContent = `失敗：${e}`;
  }
});

refresh().catch((e) => {
  dlHint.textContent = `載入失敗：${e}`;
});

setInterval(() => refresh().catch(() => {}), 5000);

