// 資料完整性驗證（部署前必跑）
const fs = require('fs');
const path = require('path');
const D = p => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', p), 'utf8'));

let errors = [];
const plan = D('plan.json');
const grammar = D('grammar.json');
const writing = D('writing.json');

// 1. 日期覆蓋：2026-07-06 起 56 天
const dates = [];
const start = new Date(2026, 6, 6);
for (let i = 0; i < 56; i++) {
  const d = new Date(start.getTime() + i * 86400000);
  dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

const allWordIds = new Set();
const vocabByWeek = {};
for (let w = 1; w <= 8; w++) {
  const vw = D(`vocab_w${w}.json`);
  const rw = D(`reading_w${w}.json`);
  vocabByWeek[w] = [];
  if (vw.days.length !== 7) errors.push(`vocab_w${w}: days=${vw.days.length}`);
  if (rw.articles.length !== 7) errors.push(`reading_w${w}: articles=${rw.articles.length}`);

  vw.days.forEach((day, di) => {
    const expect = dates[(w - 1) * 7 + di];
    if (day.date !== expect) errors.push(`vocab_w${w} day${di}: date ${day.date} != ${expect}`);
    if (day.words.length !== 6) errors.push(`vocab_w${w} ${day.date}: words=${day.words.length}`);
    day.words.forEach(word => {
      ['id', 'en', 'kk', 'pos', 'zh', 'ex', 'ex_zh'].forEach(k => {
        if (!word[k]) errors.push(`vocab_w${w} ${day.date} ${word.id || '?'}: missing ${k}`);
      });
      if (allWordIds.has(word.id)) errors.push(`duplicate word id: ${word.id}`);
      allWordIds.add(word.id);
      vocabByWeek[w].push(word.en.toLowerCase());
    });
  });

  rw.articles.forEach((a, ai) => {
    const expect = dates[(w - 1) * 7 + ai];
    if (a.date !== expect) errors.push(`reading_w${w} art${ai}: date ${a.date} != ${expect}`);
    if (!a.id || !a.title || !a.text) errors.push(`reading_w${w} ${a.date}: missing fields`);
    if (a.questions.length !== 3) errors.push(`reading_w${w} ${a.id}: questions=${a.questions.length}`);
    a.questions.forEach((q, qi) => {
      if (q.options.length !== 4) errors.push(`${a.id} q${qi}: options=${q.options.length}`);
      if (!q.options.includes(q.answer)) errors.push(`${a.id} q${qi}: answer not in options!`);
    });
  });
}

// 2. 文法
if (grammar.length !== 16) errors.push(`grammar: ${grammar.length} != 16`);
grammar.forEach(g => {
  if (!g.examples || g.examples.length < 3) errors.push(`${g.id}: examples<3`);
  (g.quiz || []).forEach((q, i) => {
    if (!q.options.includes(q.answer)) errors.push(`${g.id} quiz${i}: answer not in options!`);
  });
});
plan.weeks.forEach(w => {
  w.grammar.forEach(gid => {
    if (!grammar.find(g => g.id === gid)) errors.push(`plan w${w.week}: grammar ${gid} not found`);
  });
});

// 3. 寫作：8 週、每週 3 單字+2 文法，重點單字需在當週單字庫
if (writing.length !== 8) errors.push(`writing: ${writing.length} != 8`);
writing.forEach(w => {
  const vTargets = w.items.filter(i => i.type === 'vocab');
  const gTargets = w.items.filter(i => i.type === 'grammar');
  if (vTargets.length !== 3) errors.push(`writing w${w.week}: vocab items=${vTargets.length}`);
  if (gTargets.length !== 2) errors.push(`writing w${w.week}: grammar items=${gTargets.length}`);
  vTargets.forEach(i => {
    if (!vocabByWeek[w.week].includes(i.target.toLowerCase()))
      errors.push(`writing w${w.week}: target "${i.target}" not in vocab_w${w.week}`);
    if (!i.refs || i.refs.length < 2) errors.push(`writing w${w.week} ${i.target}: refs<2`);
  });
});

console.log(`單字總數: ${allWordIds.size}`);
console.log(`文章總數: 56, 文法: ${grammar.length}, 寫作週: ${writing.length}`);
if (errors.length) {
  console.log(`\n❌ ${errors.length} 個問題:`);
  errors.forEach(e => console.log(' - ' + e));
  process.exit(1);
} else {
  console.log('✅ 全部驗證通過');
}
