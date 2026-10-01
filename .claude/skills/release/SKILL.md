---
name: release
description: 打包、簽名、公證、發佈 Agent S 的 GitHub release（熱更或完整安裝包），或排查簽名、公證、in-app 更新器問題時使用。
---

# 打包與發佈（macOS）

## 現況
- **2026-10-01：下面這張 Developer ID 憑證已被 Apple 撤銷**（`security find-identity -v -p codesigning` 標 `CSSMERR_TP_CERT_REVOKED`，`spctl` 回報公證已撤銷）。用它簽的安裝（0.2.30 起的完整版）裡，macOS 會擋掉 node-pty 的 `spawn-helper`，claude 一律起不來，熱更修不了這個。熱更不受影響。換到有效的憑證前，完整版用 `pnpm release --full --unsigned` 發（0.2.34 起）：ad-hoc 簽名、不公證、不需要 `.env`；`--full` 單獨用會被腳本擋下（憑證無效）。ad-hoc 簽的是「封條有效」的包（`-c.mac.identity=-`），不是 `identity=null`：後者留下 Electron 原本的 linker 簽名卻沒有封條，`codesign --verify` 會報 `code has no resources but signature indicates they must be present`。代價：下載的人第一次打開要到「系統設定 → 隱私權與安全性」按「仍要打開」（未實測這個畫面）；沒有 team 簽名，通知走 osascript（Script Editor 名義，實測送得出去）。
- 這個 team 從未公證成功：`notarytool history` 裡 0.2.30 的三次送件全是 Rejected，`notarytool log` 的原因是 status 7000「Team is not yet configured for notarization」，要先聯絡 Apple Developer Programs Support 開通。不是下面寫的「送件卡在 Apple」。換新憑證後先確認這點，否則簽了也公證不過。
- 完整版（`--full`）用這台 Mac 鑰匙圈裡的 Developer ID Application 憑證（Huu Vinh Luong，team T9Q4RGHKDD）簽名，上傳前把 zip 送 Apple 公證、**不等結果**：新帳號頭幾次送件可能在 Apple 卡一小時以上；審過之後 Gatekeeper 會上網查到這份檔案的公證，不用重新上傳，審完前下載的人第一次打開仍會被擋。熱更只要 `app.asar`，它的 `--dir` 建置不簽名、不需要憑證。
- 公證金鑰放在主目錄的 `.env`（gitignored；`pnpm release`、`pnpm package` 會自動載入）：`APPLE_API_KEY`＝`build/AuthKey_<id>.p8` 的絕對路徑、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。在 worktree 裡發佈，先 `set -a; . /Users/kimi/work/agents/.env; set +a`。
- 上傳用 `gh`，先 `gh auth login`。GitHub Actions 沒有憑證與金鑰，只能發熱更；完整版在這台 Mac 上發。
- 0.2.29 以前的安裝是未簽名的，熱更換不掉已安裝 app 的簽名，要手動下載新的 DMG 重裝一次才有原生通知。未簽名的 build（含 dev）發不出原生通知：Electron 43 走 UNUserNotificationCenter，只接受帶 team 的簽名，ad-hoc 也不行（實測），`src/main/index.ts` 啟動時用 `codesign` 判斷，未簽名就改走 osascript。

## 兩種發佈
- **熱更**：只換 `app.asar`（全部 JS＋依賴，跨架構同一包），使用者按「更新並重啟」即完成。
- **完整（`--full`）**：Electron 或 node-pty 版本變了時必須用，附簽名＋公證的 DMG/zip；更新器發現 `runtime` 指紋不符會引導使用者下載重裝。第一次發佈也必須 `--full`。

```bash
pnpm release --dry-run            # 只建置、產 manifest，列出會上傳什麼
pnpm release --notes "修了 X"      # 熱更
pnpm release --full --notes "…"   # 完整（簽名＋公證，約多幾分鐘）
pnpm release --full --unsigned --notes "…"   # 完整，沒有有效憑證時（ad-hoc 簽名、不公證）
```

- 腳本會擋：版本沒 bump、tag 已存在、native 變了卻沒帶 `--full`、第一次發佈沒帶 `--full`、`--full` 缺憑證或公證金鑰。上傳用 `gh release create`，它把 tag 打在遠端的預設分支上，所以**先把 main 推上去再發佈**；上傳失敗時會印出手動指令。
- 熱更 release 的 manifest 沿用上一版的 `full.url`，讓「前往下載」永遠有效。
- `--full` 逐一 arch 先 `electron-rebuild` node-pty 再打包，並用 `lipo` 驗 `pty.node`／`spawn-helper` 的架構。arch 清單別寫進 `electron-builder.yml`：那會讓每次呼叫都建全部 arch，蓋掉交叉編譯好的 node-pty。
- 只想在本機打一個包試跑：`pnpm package`（當前架構，簽名＋公證）；不要簽名時用 `pnpm build && pnpm exec electron-builder --mac --dir -c.mac.identity=null -c.mac.notarize=false`。

## 舊倉庫
專案 2026-09-28 從 `aria0509/agents` 搬到 `newbilitybox/agents`。舊倉庫的 v0.2.26（橋接熱更，asar 裡的更新來源已指向新倉庫）與 v0.2.9（它的 manifest 的 `full.url`）**不可刪**：尚未升級的舊安裝靠它們拿到新倉庫的更新。新倉庫從 v0.2.26（full）起算。

## 驗證
- 簽名與公證：`codesign --verify --deep --strict --verbose=2 "$APP"`、`spctl -a -vvv -t install "$APP"`（公證通過後為 accepted、source=Notarized Developer ID；未公證是 rejected、Unnotarized Developer ID）。送件狀態：`xcrun notarytool history --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"`；被拒用同樣參數跑 `xcrun notarytool log <submissionId>` 看原因，常見是某個執行檔沒開 hardened runtime 或沒簽到。
- 熱更之後，簽名 bundle 的 `codesign --verify` 會報 `a sealed resource is missing or invalid`，但 app 照常啟動、原生通知照常（2026-09-29 實測，本機未帶 quarantine 的安裝）。
- 更新器：`AGENTS_UPDATE_MANIFEST_URL` 指向本地或測試用 manifest；`AGENTS_UPDATE_AUTO=1` 不跳對話框、自動套用後退出（0＝已套用或已最新、2＝失敗、3＝native 不符）；`AGENTS_USER_DATA_DIR` 隔離資料目錄與 single-instance lock。dev（未打包）不檢查更新，除非設了 manifest override。
- 發佈後幾分鐘內，`releases/latest/download/latest.json`（更新器讀的就是它）的轉址仍被 GitHub 快取在上一版（2026-09-30 發 0.2.31 實測約 2 分 40 秒），已安裝的 app 這段時間也還看不到新版：當下改讀 `releases/download/v<版本>/latest.json` 驗內容，Latest 標記用 `gh api repos/newbilitybox/agents/releases/latest --jq .tag_name` 確認，不必重發。
- 複製 `.app` 做 e2e 要用 `cp -R`：node 的 `cpSync` 會弄壞 Electron framework 的 symlink（icudtl.dat not found、GPU 起不來）。

## 憑證與金鑰
- 簽名憑證：Xcode → Settings → Accounts → Manage Certificates → ＋ Developer ID Application（只有 Account Holder 能建）。`security find-identity -v -p codesigning` 要看得到。私鑰只在這台 Mac：從鑰匙圈存取的 login → My Certificates 匯出 .p12 備份（換機、在 CI 簽名都要它）。
- 公證金鑰：App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys。Individual Key 沒有 Issuer ID，`@electron/notarize` 不收。`.p8` 只能下載一次。
- 簽名憑證與公證金鑰必須屬於同一個 team。
