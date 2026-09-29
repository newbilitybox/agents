---
name: release
description: 打包、簽名、發佈 Agent S 的 GitHub release（熱更或完整安裝包），或排查簽名、公證、in-app 更新器問題時使用。
---

# 打包與發佈（macOS）

## 現況
- 發佈版**未簽名、不公證**：`scripts/release.mjs` 的 `SIGN_OVERRIDES`（`-c.mac.identity=null -c.mac.notarize=false`）蓋掉 `electron-builder.yml` 的簽名設定。Developer ID 憑證 2026-07-21 撤銷，使用者目前沒有 Apple Developer 帳號。
- 所以在別台 Mac 第一次開要右鍵 →「打開」（或 `xattr -dr com.apple.quarantine "/Applications/Agent S.app"`）。

## 兩種發佈
- **熱更**：只換 `app.asar`（全部 JS＋依賴，跨架構同一包），使用者按「更新並重啟」即完成。
- **完整（`--full`）**：Electron 或 node-pty 版本變了時必須用，附 DMG/zip；更新器發現 `runtime` 指紋不符會引導使用者下載重裝。第一次發佈也必須 `--full`。

```bash
pnpm release --dry-run            # 只建置、產 manifest，列出會上傳什麼
pnpm release --notes "修了 X"      # 熱更
pnpm release --full --notes "…"   # 完整
```

- GitHub Actions 的 Release workflow（手動觸發）跑同一支腳本，勾「full」等同 `--full`。
- 腳本會擋：版本沒 bump、tag 已存在、native 變了卻沒帶 `--full`、第一次發佈沒帶 `--full`。上傳用 `gh release create`，失敗時印出手動指令。
- 熱更 release 的 manifest 沿用上一版的 `full.url`，讓「前往下載」永遠有效。
- `--full` 逐一 arch 先 `electron-rebuild` node-pty 再打包，並用 `lipo` 驗 `pty.node`／`spawn-helper` 的架構。arch 清單別寫進 `electron-builder.yml`：那會讓每次呼叫都建全部 arch，蓋掉交叉編譯好的 node-pty。
- 本機只想打個包試跑：`pnpm build && pnpm exec electron-builder --mac --dir -c.mac.identity=null -c.mac.notarize=false`（`pnpm package` 會照 yml 要求 Developer ID 簽名＋公證，目前沒有憑證會失敗）。

## 舊倉庫
專案 2026-09-28 從 `aria0509/agents` 搬到 `newbilitybox/agents`。舊倉庫的 v0.2.26（橋接熱更，asar 裡的更新來源已指向新倉庫）與 v0.2.9（它的 manifest 的 `full.url`）**不可刪**：尚未升級的舊安裝靠它們拿到新倉庫的更新。新倉庫從 v0.2.26（full）起算。

## 驗證更新器
- `AGENTS_UPDATE_MANIFEST_URL` 指向本地或測試用 manifest；`AGENTS_UPDATE_AUTO=1` 不跳對話框、自動套用後退出（0＝已套用或已最新、2＝失敗、3＝native 不符）；`AGENTS_USER_DATA_DIR` 隔離資料目錄與 single-instance lock。
- dev（未打包）不檢查更新，除非設了 manifest override。
- 複製 `.app` 做 e2e 要用 `cp -R`：node 的 `cpSync` 會弄壞 Electron framework 的 symlink（icudtl.dat not found、GPU 起不來）。

## 若日後有 Developer ID
1. 建 Developer ID Application 憑證（只有 Account Holder 能建：developer.apple.com → Certificates → ＋，或 Xcode → Settings → Accounts → Manage Certificates），`security find-identity -v -p codesigning` 要看得到。私鑰只在本機，換機前匯出 .p12 備份。
2. 公證憑證放專案根目錄的 `.env`（已 gitignore，`pnpm package` 會自動載入）：App Store Connect API key（`APPLE_API_KEY`＝`.p8` 路徑、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`），或 Apple ID＋App 專用密碼（`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`）。
3. 簽名的 team、公證的 team、API key 的 team 必須是同一個；然後拿掉 `release.mjs` 的 `SIGN_OVERRIDES`。
4. 驗證：`codesign --verify --deep --strict --verbose=2 "$APP"`、`spctl -a -vvv -t install "$APP"`（公證後應為 accepted、source=Notarized Developer ID）、`xcrun stapler validate <dmg>`。公證被拒用 `xcrun notarytool log <submissionId> …` 看原因，常見是某個執行檔沒開 hardened runtime 或沒簽到。
5. 熱更會改寫 asar，讓已簽名的 bundle 破封：macOS 只在首次開啟時做 Gatekeeper 深度驗證，已安裝的使用者不受影響，但重新分發一定要用 `--full` 產生的完整簽名包。
