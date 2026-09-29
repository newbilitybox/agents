---
name: cli-behavior
description: claude CLI 改版後確認它的實際行為時使用——TUI 文案與畫面、旗標、hook／statusline payload、/usage 輸出、onboarding 與信任框。方法：反查 CLI binary、用 pty 實測、用 -p 跑本地命令，而且不污染使用者的真實帳號。
---

# 查 claude CLI 的實際行為

app 的偵測與旗標都釘在 CLI 的實作細節上（集中在 `src/main/claude-cli.ts`），CLI 改版常悄悄打破它們。先查證再改碼，並在碼旁的註解寫上查證的版本（`verified 2.1.xxx`）。

## 反查 binary
- 位置：`readlink ~/.local/bin/claude` → `~/.local/share/claude/versions/<版本>`。它是 Bun 單檔執行檔，JS 原始碼以字串形式存在裡面。
- `strings -n 8 <binary> > <scratchpad>/claude-strings.txt`，再用 Python 搜尋並印出前後文。這台機器的 `grep` 是 ugrep，`.{0,200}` 這類 pattern 會超過它的複雜度上限。
- 找到文案後往回看所在函式的條件。例：onboarding 只看 `.claude.json` 的 `hasCompletedOnboarding`；`claude auth login` 的 OAuth 路徑不會寫它。

## 不花額度的實測
- 本地 slash command 可以直接跑、不呼叫模型：`claude -p "/usage" --no-session-persistence`（`/cost` 等同理）。不加 `--no-session-persistence` 會在該帳號的 `projects/<cwd 編碼>/` 留下 transcript。
- 互動畫面用 pty 實測：`python3 .claude/skills/cli-behavior/pty_run.py <cwd> <configDir> <輸出檔> [claude 參數…] [-- 依序送出的輸入…]`。它等 TUI 就緒才送輸入、自動過信任框，把原始輸出寫進檔案。
- 新帳號的畫面（onboarding、信任框、未登入）用空的 `CLAUDE_CONFIG_DIR`（在 scratchpad 新建目錄）就看得到，不需要憑證。
- 在 claude session 裡跑 claude 要剝掉 `CLAUDE*`／`ANTHROPIC*`／`AI_AGENT` 等環境變數，否則會被當成 nested session 立刻退出（`pty_run.py` 已處理）。

## 別污染真實帳號
- 不打 `/model`、`/effort <level>`：TUI 會把它寫成該帳號的預設（`settings.json`）。
- 不用 `!cmd` bash 模式：輸出會交給模型，會花額度。
- 跑完刪掉自己在帳號目錄留下的東西（`projects/` 底下新建的目錄與 transcript）。互動跑過的新目錄還會在該帳號的 `.claude.json` 留一筆信任記錄。
