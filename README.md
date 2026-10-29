# 簡單記帳

純 HTML + CSS + JavaScript 的個人記帳 PWA，可離線使用、可加到手機主畫面。
資料只存在瀏覽器的 localStorage，不會上傳到任何伺服器；這個 repo 只有程式碼與 icon，沒有任何記帳資料。

## 檔案

```
simple-ledger/
├── index.html            所有畫面的骨架與 SVG 圖示
├── manifest.json         PWA 設定（名稱、顏色、icon）
├── sw.js                 Service worker：預先快取所有檔案，離線可用
├── icon-generator.html   用瀏覽器開啟，一鍵下載 180 / 192 / 512 / maskable 512 PNG
├── css/style.css         樣式（以 390px 手機寬度為基準，桌機置中）
├── js/format.js          日期、金額、百分比格式化
├── js/store.js           localStorage 資料層
├── js/csv.js             CSV 匯入（UTF-8 / Big5）與匯出（與原始格式相同）
├── js/app.js             畫面與互動
└── icons/                icon.svg 與各尺寸 PNG
```

## 部署到 GitHub Pages

1. 在 GitHub 建立一個 **公開** repo（例如 `simple-ledger`）。
2. 把這個資料夾裡的所有檔案上傳到 repo 根目錄（`index.html` 必須在根目錄）。
3. Settings → Pages → Build and deployment → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 Save。
4. 等 1–2 分鐘，網址為 `https://<帳號>.github.io/<repo 名稱>/`。

更新程式後請把 `sw.js` 裡的 `VERSION` 加 1，手機上重新開啟兩次就會拿到新版。

## 加到主畫面

- **iPhone（Safari）**：開啟網址 → 底部「分享」→「加入主畫面」→「新增」。
- **Android（Chrome）**：開啟網址 → 右上「⋮」→「加到主畫面」或「安裝應用程式」。

iOS 只在「加入主畫面」當下讀取狀態列樣式等設定；若日後這些設定有改，要把主畫面的 icon 移除後重新加入（資料存在瀏覽器裡，不會因此消失）。

## 首次使用：匯入舊資料

主畫面右上「⚙ 設定」→「匯入 CSV」→ 選擇從原 App 匯出的 CSV → 預覽筆數後選「合併」或「覆蓋」。

## 備份

設定頁「匯出備份」會下載 `記帳備份_YYYY-MM-DD.csv`，格式與原 App 相同，可再匯回。
超過 7 天未備份，打開 App 會提醒。**換手機或清除瀏覽器資料前，請先匯出備份。**
