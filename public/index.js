import { apiJson, copyToClipboard } from './utils.js';

const form = document.getElementById('uploadForm');
const hint = document.getElementById('uploadHint');
const links = document.getElementById('links');

function linkRow(label, url) {
  const div = document.createElement('div');
  div.className = 'linkline';
  div.innerHTML = `
    <div class="col" style="gap:4px;min-width:0">
      <div class="muted small">${label}</div>
      <div class="url mono">${url}</div>
    </div>
    <div class="row">
      <a class="btn" href="${url}" target="_blank" rel="noopener">開啟</a>
      <button class="btn" data-copy="${url}" type="button">複製</button>
    </div>
  `;
  div.querySelector('[data-copy]').addEventListener('click', async () => {
    await copyToClipboard(url);
    div.querySelector('[data-copy]').textContent = '已複製';
    setTimeout(() => (div.querySelector('[data-copy]').textContent = '複製'), 1200);
  });
  return div;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hint.textContent = '上傳中...';
  links.innerHTML = '';

  const fd = new FormData(form);
  try {
    const res = await fetch('/api/docs', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || `HTTP_${res.status}`);
    hint.textContent = '完成。請先進入「設定簽名框」拉框後儲存。';
    links.appendChild(linkRow('1) 設定簽名框（發起人）', json.configUrl));
    links.appendChild(linkRow('2) 簽名者連結（給同仁）', json.signerUrl));
    links.appendChild(linkRow('3) 狀態看板/下載（發起人）', json.dashboardUrl));
  } catch (err) {
    hint.textContent = `失敗：${err}`;
  }
});

