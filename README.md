# ⚖️ VOTEHK 蹺蹺板投票系統

一個支援使用者登入、具備冷卻機制、並能依照雙方票數比動態傾斜蹺蹺板的即時投票 Web 應用程式。

- **前端託管**：Cloudflare Pages（純靜態網頁，支援自動 CI/CD）
- **後端資料庫與認證**：Supabase（Auth + PostgreSQL + RLS 安全門禁）

---

## 🌟 功能特色

1. **使用者身分驗證（Supabase Auth）**：
   - 支援 Email / Password 註冊、登入與登出。
2. **蹺蹺板動態傾斜視覺動畫**：
   - 即時計算雙方票數比。
   - 傾斜公式：`傾斜角度 = 30° / 兩邊票數比`（票數多的一端下沉，相等時維持 0° 水平平衡）。
   - 平滑 CSS 動畫變換。
3. **防洗票 5 分鐘冷卻機制**：
   - 前端具備即時倒數計時器（`X 分 XX 秒`）。
   - 資料庫層級（PostgreSQL Function）進行強制校驗，嚴格限制每個帳號每 5 分鐘只能投一票。
4. **個人歷史紀錄**：
   - 利用 Supabase RLS（行級安全性），使用者僅能查看自己的歷史投票時間與選項。

---

## 🚀 部署教學三步驟

### 第一步：Supabase 資料庫設定

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard) 登入並進入您的專案。
2. 點擊左側導航列的 **SQL Editor**。
3. 點擊 **New query**，將專案中的 `schema.sql` 完整內容複製並貼上，點選右下角 **Run** 執行。
4. 前往專案的 **Settings** -> **Data API**：
   - 複製 **Project URL**（格式為 `https://xxxx.supabase.co`）。
   - 複製 **Project API Keys** 裡的 `publishable key`（通常以 `sb_publishable_` 或 `anon` 開頭）。
5. 打開專案中的 `config.js`，將對應的值貼入並存檔：
   ```javascript
   window.APP_CONFIG = {
     SUPABASE_URL: "https://你的專案代碼.supabase.co",
     SUPABASE_KEY: "你的-publishable-key"
   };
   ```
   > ⚠️ **注意**：切勿將 `service_role` / `secret key` 填入！

---

### 第二步：推送到 GitHub

所有更新已經為您加入 Git 追蹤，只需確認推送到遠端：
```powershell
git add .
git commit -m "feat: 實現蹺蹺板動態傾斜投票系統與5分鐘冷卻機制"
git push origin main
```

---

### 第三步：透過 Cloudflare Pages 免費上線

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 點選左側選單的 **Compute (Workers & Pages)** -> **Create** -> 選擇 **Pages**。
3. 選擇 **Connect to Git**（連接到 GitHub）。
4. 授權並選取您的儲存庫：`Eric200710/VOTEHK`。
5. 設定建置參數：
   - **Framework preset**：選擇 `None`
   - **Build command**：（留空）
   - **Build output directory**：（留空，或輸入 `/`）
6. 點擊 **Save and Deploy**。
7. 數秒後即可獲得一個專屬的 Cloudflare 公開網址（例如 `https://votehk.pages.dev`）！

---

## 📂 檔案架構

| 檔案 | 說明 |
|---|---|
| `index.html` | 網頁架構：蹺蹺板視圖、投票控制項、冷卻提示、登入表單、個人投票清單 |
| `style.css` | 現代化 UI 設計、蹺蹺板與支點動畫樣式、響應式排版 |
| `app.js` | 業務邏輯：認證狀態、RPC 投票、角度計算、5分鐘倒數計時、定時輪詢 |
| `schema.sql` | Supabase 資料表 (`votes`)、RLS 權限、原子投票函數 (`cast_vote`) |
| `config.js` | Supabase 連線參數設定檔 |
