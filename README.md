# Agent S

在同一台 Mac 上管理**多個 Claude Code 訂閱帳號**與**多個 session** 的 Electron 桌面工具：所有 session 的終端排成櫥窗，集中看各帳號用量，撞到限額時可以自動換帳號接著跑。

> 只支援 macOS 上的 Claude Code CLI。

## 功能

**帳號**
- 一個帳號就是一個 `CLAUDE_CONFIG_DIR`。可掃描本機 `~/.claude*` 一鍵匯入，或手動新增（名稱 → 路徑，留空為 `~/.claude-<名稱>`）後在 app 內登入：瀏覽器登入自動回填、複製連結貼代碼、或直接用內嵌的 CLI 終端。
- 新增帳號時可選登入方式：本地登入，或貼上 `claude setup-token` 產生的長效 token（不必在這台機器登入）。token 只有推理權限，所以 token 帳號不顯示信箱與方案、沒有 session 在跑時沒有用量、不能用 Remote Control。
- 每個帳號都能在編輯對話框生成、查看、複製、重新生成長效 token，並顯示到期日（生成後一年）；也能貼上在別處生成的。本地登入的帳號只是把 token 保存下來供你複製到別處，session 仍用本地登入。
- 顯示登入狀態、方案（Max 標出 5x／20x），以及 5 小時／本週／各模型窗口的用量與 reset 時間；撞到限額的帳號標 ⛔ 直到該窗口 reset。

**Session**
- 建立時只有工作目錄必填；帳號留空會自動挑（週額度最快重置、且這個模型仍有餘量的帳號）。
- 可勾選「在獨立的 git worktree 中執行」（`claude --worktree`）：同一個 repo 的多個 session 各在自己的分支工作；換帳號、重啟都沿用同一個 worktree，worktree 不會自動刪除。
- 模型、effort、權限模式、系統提示附加檔、附加目錄、設定覆寫、啟動參數都能事後修改（不常用的收在「進階設定」），每次重啟自動還原。
- 主畫面是可互動的終端櫥窗：點卡片啟用，下方浮出輸入框（貼圖、拖檔、Shift/⌘+Enter 換行；訊息真的打進 claude 才清空，沒送出就留在框裡）；可拖拽排序、彈出獨立視窗。
- 新目錄的信任提示自動確認；預設不接 Remote Control、不同步到雲端（要上雲端在該 session 的設定 JSON 寫 `{"remoteControlAtStartup": true}` 或在 session 內打 `/rc`）。

**限額**
- 勾選「達到用量上限時自動切換帳號」（預設）：換到有餘量的帳號並送 continue（換帳號＝把 transcript 搬到目標帳號目錄再 `--resume`）。
- 不勾選：只發通知，由 Claude Code 自己等到額度重置後繼續。

**其他**
- 跨帳號 session 互通：所有帳號共用一份 session registry，`ListAgents`／`SendMessage` 不再侷限於同一帳號。
- 選單列常駐；退出時可選「背景執行」保留執行中的 session；系統通知（需處理／完成／限額／模型回退）；in-app 更新；繁簡中文＋英文、深淺色主題。
- 系統通知需要簽名版（0.2.30 起的安裝包）才是原生通知，點擊會跳到該 session；0.2.29 以前的未簽名安裝與開發版改以「Script Editor」名義顯示，點擊不會跳過去。從舊版升級要重新下載 DMG 安裝一次。

## 開發

需求：macOS、Node 22.18+、pnpm、已安裝 `claude` CLI。

```bash
pnpm install     # postinstall 會下載 Electron 執行檔，並把 node-pty 重建成 Electron 的 ABI
pnpm dev         # 開發模式（資料目錄 ~/.agent-s-dev，與正式版的 ~/.agent-s 分開）
pnpm typecheck
pnpm test        # 單元測試（Node 內建 test runner）
```

## 打包與發佈

```bash
pnpm release --dry-run           # 只建置、列出會上傳什麼
pnpm release --notes "修了 X"     # 熱更：只換 app.asar，使用者按「更新並重啟」即可
pnpm release --full --notes "…"  # 附簽名的 DMG/zip 並送 Apple 公證；換過 Electron／node-pty 時必須用
```

完整版在有 Developer ID 憑證與公證金鑰（`.env`）的 Mac 上發佈，上傳需要登入的 `gh`。細節見 `.claude/skills/release/SKILL.md`。

## 已知限制
- 閒置帳號的用量靠定期（每 15 分鐘，以及打開設定時）跑 `claude -p /usage` 取得；執行中的 session 由 statusline 即時回報。各模型（如 Fable）的窗口只有前者有。
- 限額橫幅、信任提示等偵測依賴 CLI 的畫面文字，CLI 改版可能需要跟著調整。
- 長效 token 以明文存在資料目錄的 `config.json`（只有本人可讀）。新增或貼上 token 時不會驗證它是否有效，失效要到 session 第一次請求才看得出來；重新生成不會撤銷舊 token，它會用到自己的到期日。
