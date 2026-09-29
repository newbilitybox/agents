# src/renderer

## 慣例
- xterm 固定 5.5＋`@xterm/addon-webgl` 0.19，別升 6：webgl 穩定版不支援 xterm 6，6 只剩 DOM renderer，全螢幕重繪會卡
- 終端對 claude 查詢的回覆（XTVERSION 等）只在 main 的 `pty-manager` 代答：renderer 每次重掛終端都會重播 ring buffer 裡的舊查詢
- 拖放／貼上的檔案與圖片在 preload 統一攔截、轉成路徑（`webUtils.getPathForFile` 只在 preload 的 File 上有效，且 xterm 有 focus 時 renderer 收不到 paste）；renderer 只經 `onFileDrop` 收路徑
- 用量一律經 `components/usage-lines.tsx`（`UsageLines`／`useUsageLines()`）顯示：reset 已過的窗口讀作 0%、park 顯示 ⛔，並每 30 秒隨時間重算——這些值會變，卻沒有 state 推送觸發重繪
