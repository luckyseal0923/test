# 遠端簽名 Web（MVP）

這是一個可跑通流程的 MVP：

- 發起人上傳 PDF
- 在 PDF 上拉框設定多個「簽名 / 文字」欄位（可跨頁）
- 自動產生「簽名者連結」與「狀態看板/下載連結」
- 簽名者用手機點框 → 手寫簽名或輸入文字 → 自動儲存
- 必填欄位全部完成後，自動產出 **已簽名 PDF**，發起人可下載
- 可選 **Webhook**：完成時自動 POST JSON 到指定網址

## 需求

- Node.js 22+

## 啟動

```bash
npm install
npm start
```

瀏覽 `http://localhost:3000/`

## 環境變數（可選）

- **PORT**：預設 `3000`
- **BOARD_TOKEN**：啟用全域看板 API（`GET /api/board?token=...`）用的 token；未設定時會回 `board_disabled`

## 資料儲存位置

所有資料都存在本機（未做雲端儲存）：

- `data/app.db`：SQLite
- `data/uploads/`：上傳的原始 PDF
- `data/signatures/`：簽名 PNG
- `data/signed/`：產出的已簽名 PDF

## 安全性注意（重要）

目前採 **連結 token** 的簡化設計（token 具 bearer 權限）：

- **請務必** 部署在內網/VPN 或加上 SSO/登入、HTTPS、存取控管
- 未實作審計軌跡、身分驗證、IP 限制、到期時間、撤銷、加密儲存等醫療常見合規需求

## Webhook payload

完成時會 POST：

```json
{
  "docId": "xxxx",
  "status": "COMPLETED",
  "completedAt": "2026-02-15T00:00:00.000Z",
  "signedDownloadUrl": "https://.../api/doc/xxxx/download/signed?token=..."
}
```

