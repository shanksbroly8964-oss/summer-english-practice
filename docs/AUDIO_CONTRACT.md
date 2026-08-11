# AUDIO_CONTRACT — 發音升級 模組契約（所有 Agent 必讀）

本檔是唯一契約來源。各 Agent **只能修改自己被指派的新檔**，透過本契約溝通，不 import 彼此實作。
專案根：`C:\OpenCode\202606\summer-english-app\`。純前端 vanilla JS（ES5 風格、無框架、無打包）。

## 0. 全庫既有慣例（沿用，勿破壞）
- 選擇題 `answer` 一律存「選項全文」，比對用字串 `===`。
- cache-busting：`index.html` 的 `window.APP_VERSION`；fetch 帶 `?v=APP_VERSION`。
- localStorage keys：`se_done / se_wrong / se_stats / se_settings / se_writing`。
- 既有即時朗讀模組：`window.SETts.speak(text, btnEl?, rateOverride?)` / `SETts.stop()`（en-US Web Speech）。
- 既有語速設定：`SEStore.getSettings().ttsNormal`（true=正常, false/undefined=慢速）。
- 禁止：開瀏覽器/Playwright 自我測試（會卡死）；讀二進位檔（.mp3）；改動非自己負責的檔。

## 1. 資料契約：`data/audio-manifest.json`（由 A0 產出，唯讀）
```jsonc
{
  "voice": "en-US-AriaNeural",
  "rates": { "n": "+0%", "s": "-25%" },
  "word":    { "<wordId>": { "n": "audio/word/<id>_n.mp3", "s": "audio/word/<id>_s.mp3" } },
  "ex":      { "<wordId>": { "n": "audio/ex/<id>_n.mp3",   "s": "audio/ex/<id>_s.mp3" } },
  "grammar": { "<gId>":   [ { "n": "...", "s": "..." }, ... ] },   // 陣列，index=例句序
  "writing": { "<week>-<idx>": { "n": "...", "s": "..." } },        // 例：'1-0'
  "reading": { "<articleId>": { "sentences": ["Title", "S1.", ...],
                                "audio":     ["audio/reading/<id>_s0.mp3", ...] } }  // 只正常速；index 對齊 sentences
}
```
- `wordId` 例：`w1d1a`；`gId` 例：`g1`；`articleId` 例：`r0706`。
- 路徑都是相對於網站根的相對路徑。**檔案可能還在生成中或缺漏**——前端一律要有「抓不到就退回 SETts 朗讀」的備援，不可報錯。

## 2. 音訊引擎契約：`window.SEAudio`（**A1 實作於 `js/audio.js`**；A3 消費此 API）
ES5、IIFE、掛 `window.SEAudio`。用單一 `HTMLAudioElement` 播放，同時只播一個。
```js
window.SEAudio = {
  ready: Promise,                 // manifest 載入完成
  init(): Promise,                // fetch data/audio-manifest.json?v=APP_VERSION，失敗也 resolve（進入純備援模式）
  currentSpeed(): 'n'|'s',        // 依 SEStore.getSettings().ttsNormal 推導（true→'n'，否則→'s'）
  src(scope, id, speed, idx): string|null,  // scope: 'word'|'ex'|'grammar'|'writing'|'reading'
                                            // grammar/reading 用 idx；查不到回 null
  // 播一個發音：優先 MP3，載入/播放失敗或 src 為 null → SETts.speak(fallbackText)
  play(opts): Promise,            // opts={ scope,id,idx?,speed?('n'|'s',預設 currentSpeed()),
                                  //        fallbackText, btnEl?(加 .speaking 樣式), onstart?(), onend?() }
  stop(): void,                   // 停 audio 與 SETts
  preload(scope, id, speed, idx): void,   // 預抓下一個，加速連播
  isPlaying(): boolean,
  // 連續播放（整課連播 / 文章逐句）：依序播 items，前一個 onend 觸發下一個
  playSequence(items, opts): { stop: fn },  // items=[{scope,id,idx?,fallbackText}]
                                            // opts={ speed?, onItem(index), onDone() }；回傳 controller.stop()
};
```
行為要求：
- `play` 優先 MP3；`audio.onerror` 或 fetch 404 或 `src()===null` → 呼叫 `SETts.speak(fallbackText, btnEl, speed==='s'?0.55:0.8)` 當備援，**永不 throw、永不卡死**。
- 播放時對 `btnEl` 加 `.speaking` class，結束/失敗移除。
- 同時只播一個：新 `play`/`playSequence` 前先 `stop()` 舊的。
- `preload`：建立隱藏 Audio 或 `<link rel=prefetch>` 皆可，抓不到靜默略過。
- 全站點擊代理：`js/audio.js` 要保留對既有 `[data-tts]` 按鈕的相容（可仍走 SETts），新按鈕改用 `SEAudio.play`。

## 3. 聽力題契約：`window.SEListening`（**A2 實作於 `js/listening-quiz.js`**；純邏輯，無 DOM）
```js
window.SEListening = {
  // 由單字池產生「聽音選字」題；播單字發音，選中文意思。相容既有 quiz 題目 schema。
  makeQuestions(words, n): Array<{
     k:  'l:'+wordId,          // 錯題本 key（前綴 l:）
     t:  'listening',          // 題型
     q:  '🔊 聽發音，選出正確的中文意思',
     audio: { scope:'word', id:wordId, fallbackText:en },  // 給 SEAudio.play 用
     options: [zh, zh, zh, zh], // 選項全文（中文意思），洗牌
     answer: zh,               // 正解全文（在 options 內）
     explain: en+' '+kk+' '+zh
  }>
  // words 元素形如 {id,en,kk,pos,zh,ex,ex_zh}；n=題數；干擾選項取自同池其他字的 zh
};
```
- **不碰 DOM、不改 quiz.js**。只輸出題目陣列。MAIN 會把它接進 quiz 引擎與錯題本（錯題 t='listening' 重練時由 quiz 引擎呼叫 `SEAudio.play(q.audio)`）。

## 4. 逐句跟讀契約：`window.SEReadingFollow`（**A3 實作於 `js/reading-follow.js`**；消費 SEAudio）
```js
window.SEReadingFollow = {
  // 把 manifest.reading[articleId] 的句子渲染成可高亮跟讀的區塊，插入 containerEl。
  render(containerEl, articleId): void,   // 讀 window.SEAudio 已載入的 manifest
  // 內含：整篇「播放/暫停」「上一句/下一句」控制；播到某句時該句 .rf-active 高亮並捲動到可見；
  //       點某句可從該句開始播；用 SEAudio.playSequence 串接，speed 固定正常('n')。
  stop(): void
};
```
- 句子與音檔一律取自 `SEAudio` 載入的 `manifest.reading[articleId].sentences / .audio`（**不要自己重切句**，以免和音檔對不齊）。
- 高亮用 class `.rf-active`（樣式由 MAIN 提供，agent 只要加/移除 class 與捲動）。

## 5. 測試契約：**A4 實作於 `tests/`**（Node，無瀏覽器）
產出 `tests/run-tests.js`（`node tests/run-tests.js` 可跑，退出碼非 0 代表失敗）與報告 `deliverables/A4_TESTS.md`。至少涵蓋：
1. `data/audio-manifest.json` 合法、五類 key 齊全；word/ex 數=336、grammar=16、writing=40、reading=56。
2. manifest 內每個 audio 路徑字串格式正確（`audio/<scope>/...mp3`）。
3. 抽樣檢查對應 mp3 檔存在（就地 `fs.existsSync`，抽每類前 5 筆；檔案可能仍在生成，缺檔僅 WARN 不 FAIL）。
4. 以 stub（假 `HTMLAudioElement`/`SETts`/`fetch`/`SEStore`）載入 `js/audio.js`，驗證：src() 查表正確、play() 在 src=null 時走 SETts 備援、playSequence 會依序呼叫。
5. 載入 `js/listening-quiz.js`，驗證 `SEListening.makeQuestions` 輸出 schema：answer∈options、options 長度 4、k 前綴 `l:`、t='listening'。
6. `node --check` 所有 `js/*.js`。

## 6. 邊界與交付（每個 agent 收尾必做）
| Agent | 只能改的檔 | 交付標記 |
|------|-----------|---------|
| A1 | `js/audio.js`（新） | 寫 `deliverables/A1.DONE`（一行結論） |
| A2 | `js/listening-quiz.js`（新） | 寫 `deliverables/A2.DONE` |
| A3 | `js/reading-follow.js`（新） | 寫 `deliverables/A3.DONE` |
| A4 | `tests/*`（新） | 寫 `deliverables/A4.DONE` |
| QA | 只新增 `deliverables/QA_REPORT.md`、`tests/qa_*.js`（不改別人程式，發現問題寫進報告） | 寫 `deliverables/QA.DONE` |
- 卡住就寫 `deliverables/<ID>.BLOCKED`（寫明原因），不要無限等。
- **禁止**改 `index.html / views.js / quiz.js / app.js / css/style.css / data/*`（這些整合由 MAIN 負責）。
- **禁止**開瀏覽器測試、讀 .mp3 二進位、動用網路生成音檔（音檔由 A0 產）。
- 完成時 `node --check` 自己的 js 檔要過。
