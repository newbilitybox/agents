# src/renderer

## 慣例
- xterm 固定 5.5＋`@xterm/addon-webgl` 0.19，別升 6：webgl 穩定版不支援 xterm 6，6 只剩 DOM renderer，全螢幕重繪會卡
- 終端對 claude 查詢的回覆（XTVERSION 等）只在 main 的 `pty-manager` 代答：renderer 每次重掛終端都會重播 ring buffer 裡的舊查詢
- 拖放／貼上的檔案與圖片在 preload 統一攔截、轉成路徑（`webUtils.getPathForFile` 只在 preload 的 File 上有效，且 xterm 有 focus 時 renderer 收不到 paste）；renderer 只經 `onFileDrop` 收路徑
- 用量一律經 `components/usage-lines.tsx`（`UsageLines`／`useUsageLines()`）顯示：reset 已過的窗口讀作 0%、park 顯示 ⛔，並每 30 秒隨時間重算——這些值會變，卻沒有 state 推送觸發重繪

## 坑
- 中文輸入法按 Enter 確認組字（例如直接輸出英文字母）卻觸發了送出 → Chromium 把這個 Enter 也報成 key `'Enter'` → 送出／確認類的 Enter 處理要先排除 `e.nativeEvent.isComposing`
