---
name: verify-app
description: 把 Agent S 實際跑起來驗證改動時使用：用 Playwright 驅動 Electron、隔離資料目錄、讀狀態與終端內容、截圖，以及不誤殺使用者正式版的清理方式。
---

# 跑起來驗證

## 啟動
1. `pnpm build`（main／preload／renderer 都打包進 `out/`）。
2. 用 `playwright-core` 的 `_electron.launch({ args: ['.'], env })` 啟動，`env` 一定要帶 `AGENTS_USER_DATA_DIR=<scratchpad 裡的目錄>`：資料與 single-instance lock 都跟使用者的 dev／正式版分開。
3. `const win = await app.firstWindow()`。renderer 裡的 `window.api` 就是整組 IPC，可以直接 `win.evaluate(() => window.api.getState())` 讀狀態、`window.api.ptySnapshot(id)` 讀終端輸出，或呼叫任何操作。

## 常用 env
- `AGENTS_NO_USAGE_FETCH=1`：不跑用量探測（不需要用量時省時間）
- `AGENTS_LOG_NOTIFY=1`：每則系統通知在 stdout 印一行 `[notify] …`
- 更新器相關的 env 見 skill `release`

## 注意
- claude 相關流程（換帳號、resume、用量探測）慢：每個 claude 啟動加一次 API 來回約 15–30 秒，timeout 要給足。
- 測試用的是使用者的真實帳號：送 prompt 會花額度，能不送就不送；別在真實帳號上打 `/model`、`/effort <level>`（會寫成該帳號的預設）。
- 讀輸入框要用 placeholder 找 ChatInput：`document.querySelector('textarea')` 會先抓到 xterm 隱藏的 helper textarea。
- 拖檔：CDP `Input.dispatchDragEvent`（`data.files: [真實路徑]`）能驗 preload 的路徑解析與路由，但測不到游標（真實拖曳到 xterm 上要 `dropEffect='copy'` 才會觸發 drop）。貼檔：先 `osascript -e 'set the clipboard to (POSIX file "…")'` 再按 ⌘V。
- 清理只殺自己啟動的：優先 `app.close()`；有殘留時只用本 worktree 路徑或測試資料目錄匹配（`pkill -f "<worktree>/node_modules/.*Electron"`、`pkill -f "<測試資料目錄>/session-settings"`）。絕不用 `session-settings/` 這種會命中正式版 claude 的樣式，也別用只含 `agents` 的樣式（會殺到其他 worktree 的 dev app）。殘留的 electron 若共用同一份 `config.json`，會互相覆蓋狀態，造成各種詭異的 flaky。
