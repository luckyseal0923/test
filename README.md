# 器材借用 Web 系統（MVP）

這是一個可直接跑的器材借用系統 MVP，支援：

- 新增器材（名稱、分類、庫存數、位置、備註）
- 查看器材可借數（總庫存 / 借出中 / 可借）
- 建立借用單（借用人、聯絡方式、用途、預計歸還日）
- 辦理歸還（可填寫歸還狀態與備註）
- 即時看板（器材數、總庫存、借用中、可借）
- 借用中清單與已歸還歷史清單

## 需求

- Node.js 22+

## 啟動

```bash
npm install
npm start
```

開啟：`http://localhost:3000/`

## 環境變數（可選）

- **PORT**：預設 `3000`

## 資料儲存

資料存在本機 SQLite：

- `data/app.db`

### 資料表

- `equipments`：器材主檔
- `loans`：借用 / 歸還紀錄

## 主要 API（MVP）

- `GET /api/summary`：統計資訊
- `GET /api/equipments`：器材清單
- `POST /api/equipments`：新增器材
- `GET /api/loans?status=ALL|BORROWED|RETURNED&limit=100`
- `POST /api/loans`：建立借用
- `POST /api/loans/:loanId/return`：辦理歸還

## 後續可擴充

- 帳號登入與權限（管理員 / 一般借用者）
- 器材圖片與條碼/QR Code 借還
- 預約流程（未借先預留）
- 到期提醒（Email/Line/Slack）
- 匯出報表（CSV/Excel）

