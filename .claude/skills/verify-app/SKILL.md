---
name: verify-app
description: 把 Agent S 實際跑起來驗證改動時使用：用 Playwright 驅動 Electron、隔離資料目錄、讀狀態與終端內容、假冒 hook 事件、截圖，以及不誤殺使用者正式版的清理方式。
---

# 跑起來驗證

## 啟動
1. `pnpm build`：跑的是 `out/`，改了代碼要重新建置。
2. 用本目錄的 `app.mjs` 啟動（在 scratchpad 寫個 `.mjs` 腳本 import 它）：
   ```js
   import { launch, poll } from '<repo>/.claude/skills/verify-app/app.mjs'
   const t = await launch({ dataDir: '<scratchpad>/userdata', env: { AGENTS_LOG_NOTIFY: '1' } })
   ```
   它剝掉啟動者的 `CLAUDE*`／終端環境變數（從 claude session 裡啟動時，app 開的 claude 會被當成 nested 而秒退），並用 `AGENTS_USER_DATA_DIR` 隔開資料與 single-instance lock。要測資料遷移，先把舊格式的 `config.json` 放進 `dataDir`。
3. `t.win.evaluate(() => window.api.…)` 直接呼叫整組 IPC；`t.state()`／`t.session(id)` 讀狀態（`cols`／`rows` 是 pty 尺寸），`t.screen(id)` 讀終端純文字，`t.hook(id, 'Stop')` 假冒 claude 的 hook 事件（完成、通知、限額續跑都能這樣觸發），`t.mainLog` 是 main 行程的輸出。
4. 獨立視窗是 `t.app.windows().find((w) => w.url().includes('session=' + id))`，`page.close()` 等同使用者關掉它；截圖用 `page.screenshot({ path })`。

## 常用 env
- `AGENTS_NO_USAGE_FETCH=1`：不跑用量探測
- `AGENTS_LOG_NOTIFY=1`：每則系統通知在 main 輸出印一行 `[notify] …`
- 更新器相關的 env 見 skill `release`

## 注意
- claude 相關流程（換帳號、resume）每次要等 claude 啟動，timeout 給足；「TUI 就緒」可用 `t.screen(id)` 等到出現 `◉ agents`。
- 測試用的是使用者的真實帳號：送 prompt 會花額度，能不送就不送；別在真實帳號上打 `/model`、`/effort <level>`（會寫成該帳號的預設）。要讓 transcript 有記錄又不花額度：Pro 帳號的 `/cost` 會寫記錄，Max 帳號的 `/cost` 只開用量面板、不寫。
- 讀輸入框要用 placeholder 找 ChatInput：`document.querySelector('textarea')` 會先抓到 xterm 隱藏的 helper textarea。
- 拖檔：CDP `Input.dispatchDragEvent`（`data.files: [真實路徑]`）能驗 preload 的路徑解析與路由，但測不到游標（真實拖曳到 xterm 上要 `dropEffect='copy'` 才會觸發 drop）。貼檔：先 `osascript -e 'set the clipboard to (POSIX file "…")'` 再按 ⌘V。
- 要模擬 claude 起不來、秒退或印出特定文案：app 用 login shell 找 `claude`，所以給 `launch()` 的 `env` 加 `ZDOTDIR`，指到一個只放 `.zshrc` 的目錄，在裡面把 PATH 設成「放了假 `claude` 腳本的目錄＋系統路徑」。假腳本要回應 `auth status --json`（印 `{"loggedIn":true,…}`），其餘依參數有沒有 `--resume` 決定退出或 `exec sleep`；帳號與 session 直接寫進 `dataDir/config.json`。
- 清理只殺自己啟動的：優先 `t.close()`；有殘留時只用本 worktree 路徑或測試資料目錄匹配（`pkill -f "<worktree>/node_modules/.*Electron"`、`pkill -f "<測試資料目錄>/session-settings"`）。絕不用 `session-settings/` 這種會命中正式版 claude 的樣式，也別用只含 `agents` 的樣式（會殺到其他 worktree 的 dev app）。
- 收尾刪掉測試在真實帳號留下的 transcript：`<configDir>/projects/` 底下以測試路徑命名的目錄。在新目錄開過 session 的帳號，`.claude.json` 會多一筆信任記錄（無害）。
