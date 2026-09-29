# Agent S

在同一台 Mac 上管理**多個 Claude Code 訂閱帳號**與**多個 session** 的 Electron 桌面工具：所有 session 的終端排成櫥窗，集中看各帳號用量，撞到限額時可以自動換帳號接著跑。

> 只支援 macOS 上的 Claude Code CLI。

## 功能

**帳號**
- 一個帳號就是一個 `CLAUDE_CONFIG_DIR`。可掃描本機 `~/.claude*` 一鍵匯入，或手動新增（名稱 → 路徑，留空為 `~/.claude-<名稱>`）後在 app 內登入：瀏覽器登入自動回填、複製連結貼代碼、或直接用內嵌的 CLI 終端。
- 顯示登入狀態、方案，以及 5 小時／本週／各模型窗口的用量與 reset 時間；撞到限額的帳號標 ⛔ 直到該窗口 reset。

**Session**
- 建立時只有工作目錄必填；帳號留空會自動挑（週額度最快重置、且這個模型仍有餘量的帳號）。
- 模型、effort、權限模式、系統提示附加檔、附加目錄、設定覆寫、啟動參數都能事後修改，每次重啟自動還原。
- 主畫面是可互動的終端櫥窗：點卡片啟用，下方浮出輸入框（貼圖、拖檔、Shift/⌘+Enter 換行）；可拖拽排序、彈出獨立視窗。
- 新目錄的信任提示自動確認；預設不接 Remote Control、不同步到雲端（要上雲端在該 session 的設定 JSON 寫 `{"remoteControlAtStartup": true}` 或在 session 內打 `/rc`）。

**限額**（達上限時依 session 的規則）
- 自動切換帳號：換到有餘量的帳號並送 continue（換帳號＝把 transcript 搬到目標帳號目錄再 `--resume`）。
- 手動處理：通知並等待。
- 等額度刷新後自動繼續：按 reset 時間排程。

**其他**
- 跨帳號 session 互通：所有帳號共用一份 session registry，`ListAgents`／`SendMessage` 不再侷限於同一帳號。
- 選單列常駐；退出時可選「背景執行」保留執行中的 session；系統通知（需處理／完成／限額／模型回退）；in-app 更新；繁簡中文＋英文、深淺色主題。

## 開發

需求：macOS、Node 22.18+、pnpm、已安裝 `claude` CLI。

```bash
pnpm install     # postinstall 會把 node-pty 重建成 Electron 的 ABI
pnpm dev         # 開發模式（資料目錄 ~/.agent-s-dev，與正式版的 ~/.agent-s 分開）
pnpm typecheck
pnpm test        # 單元測試（Node 內建 test runner）
```

## 打包與發佈

```bash
pnpm release --dry-run           # 只建置、列出會上傳什麼
pnpm release --notes "修了 X"     # 熱更：只換 app.asar，使用者按「更新並重啟」即可
pnpm release --full --notes "…"  # 換過 Electron／node-pty 時必須用，附 DMG/zip 安裝包
```

目前的發佈版未經 Developer ID 簽名與公證，在別台 Mac 第一次開要右鍵 →「打開」。細節見 `.claude/skills/release/SKILL.md`。

## 已知限制
- 閒置帳號的用量靠定期（每 15 分鐘，以及打開設定時）跑 `claude -p /usage` 取得；執行中的 session 由 statusline 即時回報。各模型（如 Fable）的窗口只有前者有。
- 限額橫幅、信任提示等偵測依賴 CLI 的畫面文字，CLI 改版可能需要跟著調整。
