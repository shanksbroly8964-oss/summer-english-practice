// QA Agent 自抽查：對每類 audio 抽 3 筆（取自 manifest 的 key/hash 決定性，非完全隨機以利複現）
// 規則：讀 data/audio-manifest.json，用第一筆/中間一筆/最後一筆 為抽樣點
// 檢查：fs.existsSync 且 size > 500 bytes
// exit code 非 0 → 至少一項 FAIL
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, 'data', 'audio-manifest.json');
const MIN_SIZE = 500;

function fail(msg) { console.error('[FAIL]', msg); process.exitCode = 1; }
function warn(msg) { console.warn('[WARN]', msg); }
function pass(msg) { console.log('[PASS]', msg); }

if (!fs.existsSync(MANIFEST)) {
  fail('manifest 不存在：' + MANIFEST);
  process.exit(1);
}
const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

function sample(section, want) {
  if (!m[section] || typeof m[section] !== 'object') {
    fail(`manifest.${section} 不是物件或不存在`);
    return [];
  }
  const keys = Object.keys(m[section]);
  if (keys.length === 0) {
    fail(`manifest.${section} 為空`);
    return [];
  }
  const out = [];
  const positions = [0, Math.floor(keys.length / 2), keys.length - 1];
  for (let i = 0; i < want; i++) {
    const k = keys[positions[i] || 0];
    out.push({ id: k, val: m[section][k] });
  }
  return out;
}

function gatherPaths(section, items) {
  const out = [];
  for (const it of items) {
    const v = it.val;
    if (section === 'grammar') {
      // 陣列；取 [0].n、 [0].s、 [最後].n 各算一筆
      if (!Array.isArray(v) || v.length === 0) continue;
      out.push({ id: it.id + ':[0].n', p: v[0] && v[0].n });
      out.push({ id: it.id + ':[0].s', p: v[0] && v[0].s });
      const last = v[v.length - 1];
      out.push({ id: it.id + ':[' + (v.length - 1) + '].n', p: last && last.n });
    } else if (section === 'reading') {
      if (!v || !Array.isArray(v.audio)) continue;
      // 取 [0]、[Math.floor(len/2)]、[最後]
      const len = v.audio.length;
      const idxs = [0, Math.floor(len / 2), len - 1];
      for (const idx of idxs) {
        out.push({ id: it.id + ':audio[' + idx + ']', p: v.audio[idx] });
      }
    } else {
      // word/ex/writing 為 {n, s}
      out.push({ id: it.id + '.n', p: v && v.n });
      out.push({ id: it.id + '.s', p: v && v.s });
      // 第三筆取 .n 即可（無第三項）
    }
  }
  return out;
}

let totalChecked = 0;
let totalPass = 0;
let totalFail = 0;
const summary = {};

for (const section of ['word', 'ex', 'grammar', 'writing', 'reading']) {
  const items = sample(section, 3);
  const paths = gatherPaths(section, items);
  let passCount = 0;
  let failCount = 0;
  for (const chk of paths) {
    if (!chk.p) {
      warn(`${section}:${chk.id} 路徑為空，跳過`);
      continue;
    }
    const abs = path.join(ROOT, chk.p);
    if (!fs.existsSync(abs)) {
      fail(`${section}:${chk.id} 缺失 → ${chk.p}`);
      failCount++;
      continue;
    }
    const sz = fs.statSync(abs).size;
    if (sz <= MIN_SIZE) {
      fail(`${section}:${chk.id} 太小 size=${sz}（${chk.p}）`);
      failCount++;
    } else {
      pass(`${section}:${chk.id} size=${sz} bytes (${chk.p})`);
      passCount++;
    }
    totalChecked++;
  }
  summary[section] = { pass: passCount, fail: failCount, checked: passCount + failCount };
  totalPass += passCount;
  totalFail += failCount;
}

console.log('\n========== QA 抽樣彙整 ==========');
for (const k of Object.keys(summary)) {
  console.log(`${k}: PASS=${summary[k].pass}, FAIL=${summary[k].fail}, checked=${summary[k].checked}`);
}
console.log(`\nTOTAL: PASS=${totalPass} FAIL=${totalFail} checked=${totalChecked}`);
if (totalFail > 0) process.exit(1);
