# src/main

## 佈局
- `index.ts` — bootstrap、IPC handlers、tray／選單、退出流程、系統通知、定期用量掃描
- `claude-cli.ts` — claude CLI 的全部知識：執行檔與 env、auth、`--settings` 注入、transcript 搬移、TUI 文字偵測、用量解析
- `session-manager.ts` — session 生命週期、hook 事件驅動的狀態機、送出佇列、限額處理、換帳號
- `account-manager.ts` — 帳號 CRUD、`claude auth login` pty、用量探測與限額 park、選帳號
- `pty-manager.ts` — 每個 session／登入一個 node-pty，輸出環形緩衝＋跨重生單調遞增的 offset
- `hook-server.ts` — localhost HTTP，接收注入的 hooks 與 statusline
- `window-manager.ts` 主視窗與獨立視窗；`update-manager.ts` in-app 熱更新；`resource-log.ts` pty／行程／fd 自檢；`store.ts` electron-store schema

## 慣例
- CLI 的文案、旗標、JSON 形狀只寫在 `claude-cli.ts`，其他模組呼叫它的函式；CLI 改版先改這裡
- 對 claude 的提交（使用者訊息、continue、`/effort ultracode`）一律走 `SessionManager.send()` 佇列，不直接 `ptys.submit()`：要等 TUI 就緒、要等 ack 重試
- 使用者訊息的 `submit()` 打進 claude 才 resolve、在佇列裡被丟掉就 reject，chat input 據此決定清空或保留：丟佇列只經 `abandonSends()`／`clearSends()` 並帶原因，直接刪 `sendQueue` 會讓輸入框一直卡在送出中
- done 只表示「做完、還沒看過」：畫面一到使用者眼前，renderer 的 `useMarkSeen()` 就經 `markSessionSeen` 轉 idle（使用者拍板），done 可能一閃即逝；判斷 claude 收到送出與否看 `UserPromptSubmit`（`promptAcked`），不看狀態
- model／effort／permission mode 都是 per-process：每次 respawn 用啟動旗標還原（`sessionArgs()`），不送 `/model`（有對話歷史時會跳確認框）
- 不寫帳號目錄的 `settings.json`（claude-switch 的 profile 可能 symlink 共用），注入一律走 per-session 的 `--settings` 檔；帳號的 `.claude.json` 只經 `patchClaudeJson()` 補兩樣：`markOnboarded()` 的 onboarding 旗標、`trustRepo()` 為 worktree 補的 repo 信任
- 限額 park（`usage.limitedUntil`）是權威值、只由到期清除：用量寫入都要帶回 `livePark()`，提前清掉會讓 auto-switch 無限換帳號
- session 預設不接 Remote Control（`remoteControlAtStartup: false`＋resume 前 `unbridgeTranscript()`）；要上雲端由使用者在該 session 的設定 JSON 或 `/rc` 打開
- 標題只來自使用者設定或 CLI 的 `session_name`，不用 prompt 內容
- 用量只來自 `claude -p /usage` 探測（`fetchUsage()`）與 statusline，不刮 TUI 面板、不打非官方的 `api/oauth/usage`

## 坑
- TUI 用游標定位碼（`\x1b[<col>G`）隔開單字：偵測文字前先 `stripAnsi()`，regex 字間用 `\s*`
- 限額橫幅會被 `--resume` 重播、捲動時重繪：只有 running 中、新 chunk 裡、窗口＋reset（`LimitHit.key`）沒見過的橫幅才算新撞限額
- default 帳號（`~/.claude`）的 `.claude.json` 在 `~` 而非目錄內：不設 `CLAUDE_CONFIG_DIR`（`envFor()`），讀寫它走 `claudeJsonPath()`
- `electron-store` 的 `get()` 偶爾回 `undefined`：讀陣列一律 `?? []`
- 原生系統通知只有帶 team 簽名的 build 發得出來：dev 的 `node_modules/electron` 與 0.2.29 以前的安裝都走 osascript（以 Script Editor 名義），`index.ts` 啟動時用 `codesign -dv` 判斷
