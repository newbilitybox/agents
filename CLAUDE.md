# Agent S

用途、怎麼跑、怎麼測見 `README.md`；設計上的取捨記在 `DECISIONS.md`，改這些設計前先讀。

## 佈局
Electron app：每個 session 在 main 行程用 node-pty 跑一個 `claude` CLI，以 `CLAUDE_CONFIG_DIR` 隔離帳號；`--settings` 注入的 hooks／statusline 用 curl 把狀態與用量回報給 app 內建的 localhost HTTP server。
- `src/shared/` — IPC 契約（`ipc.ts`）與資料模型（`types.ts`），main／preload／renderer 共用
- `src/main/` — Electron 主行程，所有 claude CLI 交互都在這（見 `src/main/CLAUDE.md`）
- `src/preload/` — contextBridge 暴露 typed IPC；拖放／貼上的檔案在這裡解析成路徑
- `src/renderer/` — React 19 + Tailwind v4 + shadcn/ui + zustand（見 `src/renderer/CLAUDE.md`）
- `scripts/release.mjs` — 建置並發佈 GitHub release（熱更／完整），`.github/workflows/release.yml` 是它的 CI 入口
- `build/` — 簽名 entitlements；`assets/` — 圖示

## 慣例
- 與我溝通用繁體中文；程式碼註解與命名用英文，編輯既有檔案時配合周圍的語言
- main 行程是唯一事實來源：狀態存 electron-store，變動經 `notify()` 廣播 `EVENT_STATE`，renderer 用 zustand 鏡像，不自己推算
- 改 IPC 要同步四處：`ipc.ts` 的型別與 `INVOKE_CHANNELS`、main `index.ts` 的 `handle()`、`preload/index.ts` 的 `api`、renderer 呼叫端

## 坑
- claude 一啟動就退、零輸出 → 先懷疑 node-pty 被重建成 Node ABI：`pnpm rebuild`（postinstall 會自動跑 electron-rebuild）
- `pnpm dev` 只熱更 renderer；改了 `src/main` 或 `src/preload` 要整個重啟，否則新舊版本混跑，行為像「沒生效」
- 資料目錄：正式版 `~/.agent-s`、dev `~/.agent-s-dev`，`AGENTS_USER_DATA_DIR` 可覆寫（也隔開 single-instance lock）；對話 transcript 不在這，在各帳號的 `<configDir>/projects/`
- 清理測試行程絕不能用 `pkill -f session-settings/`：正式版 app 的 claude 命令列也含這串，會殺掉使用者的 session；只匹配自己的測試資料目錄

## 流程
- 單元測試：`pnpm test`（node:test 直接跑 `src/**/*.test.ts`；import 要寫 `.ts` 副檔名，只能測不 import electron／node-pty 的模組）；型別檢查：`pnpm typecheck`
- 把 app 跑起來驗證改動：skill `verify-app`
- 打包、簽名、發佈：skill `release`
- CLI 改版後查它的新行為（文案、旗標、面板、hook payload）：skill `cli-behavior`
