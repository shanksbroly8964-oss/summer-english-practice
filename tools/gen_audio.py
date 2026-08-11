# -*- coding: utf-8 -*-
"""
暑假英文學習計畫 — 發音 MP3 生成器（edge-tts, en-US-AriaNeural）
產出：
  - data/audio-manifest.json  （前端契約，所有 agent 依此開發）
  - audio/word|ex|grammar|writing|reading/*.mp3

用法：
  python tools/gen_audio.py --manifest-only     # 只產 manifest（秒級，供前端先開發）
  python tools/gen_audio.py                      # 產 manifest + 全部 mp3（跳過已存在，可續跑）
  python tools/gen_audio.py --limit 20           # 只生成前 20 個 mp3（煙霧測試）
  python tools/gen_audio.py --concurrency 12     # 併發數（預設 10）

命名規則（契約）：
  單字發音   audio/word/<wordId>_n.mp3      _s.mp3
  單字例句   audio/ex/<wordId>_n.mp3        _s.mp3
  文法例句   audio/grammar/<gId>_e<idx>_n.mp3   _s.mp3
  寫作例句   audio/writing/<week>-<idx>_n.mp3   _s.mp3
  文章逐句   audio/reading/<articleId>_s<idx>.mp3   （只正常速）
速度：正常 rate=+0%，慢速 rate=-25%
"""
import os, sys, json, re, asyncio, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
VOICE = "en-US-AriaNeural"
RATE_N = "+0%"
RATE_S = "-25%"

def load(name):
    with open(os.path.join(DATA, name), "r", encoding="utf-8") as f:
        return json.load(f)

def split_sentences(text):
    """把文章切成句子（保留標點），段落換行視為空白。標題另外由呼叫端加入。"""
    t = re.sub(r"\s+", " ", text.replace("\n", " ")).strip()
    parts = re.split(r"(?<=[.!?])\s+", t)
    return [p.strip() for p in parts if p.strip()]

def build_tasks_and_manifest():
    """回傳 (tasks, manifest)。tasks = [(text, rate, relpath), ...]"""
    tasks = []
    manifest = {"voice": VOICE, "rates": {"n": RATE_N, "s": RATE_S},
                "word": {}, "ex": {}, "grammar": {}, "writing": {}, "reading": {}}

    def add(text, rate, relpath):
        tasks.append((text, rate, relpath))
        return relpath

    # 單字 + 單字例句（慢速+正常）
    for w in range(1, 9):
        vw = load(f"vocab_w{w}.json")
        for day in vw["days"]:
            for word in day["words"]:
                wid = word["id"]
                manifest["word"][wid] = {
                    "n": add(word["en"], RATE_N, f"audio/word/{wid}_n.mp3"),
                    "s": add(word["en"], RATE_S, f"audio/word/{wid}_s.mp3"),
                }
                manifest["ex"][wid] = {
                    "n": add(word["ex"], RATE_N, f"audio/ex/{wid}_n.mp3"),
                    "s": add(word["ex"], RATE_S, f"audio/ex/{wid}_s.mp3"),
                }

    # 文法例句（慢速+正常）
    grammar = load("grammar.json")
    for g in grammar:
        gid = g["id"]
        arr = []
        for i, ex in enumerate(g.get("examples", [])):
            arr.append({
                "n": add(ex["en"], RATE_N, f"audio/grammar/{gid}_e{i}_n.mp3"),
                "s": add(ex["en"], RATE_S, f"audio/grammar/{gid}_e{i}_s.mp3"),
            })
        manifest["grammar"][gid] = arr

    # 寫作例句（慢速+正常）
    writing = load("writing.json")
    for wk in writing:
        for i, item in enumerate(wk["items"]):
            key = f"{wk['week']}-{i}"
            manifest["writing"][key] = {
                "n": add(item["model_en"], RATE_N, f"audio/writing/{key}_n.mp3"),
                "s": add(item["model_en"], RATE_S, f"audio/writing/{key}_s.mp3"),
            }

    # 文章逐句（正常速；sentences[0] = 標題）
    for w in range(1, 9):
        rw = load(f"reading_w{w}.json")
        for a in rw["articles"]:
            aid = a["id"]
            sents = [a["title"]] + split_sentences(a["text"])
            audio = []
            for i, s in enumerate(sents):
                audio.append(add(s, RATE_N, f"audio/reading/{aid}_s{i}.mp3"))
            manifest["reading"][aid] = {"sentences": sents, "audio": audio}

    return tasks, manifest

async def gen_one(sem, text, rate, relpath, stats):
    import edge_tts
    outpath = os.path.join(ROOT, relpath)
    if os.path.exists(outpath) and os.path.getsize(outpath) > 500:
        stats["skip"] += 1
        return
    async with sem:
        for attempt in range(3):
            try:
                comm = edge_tts.Communicate(text, VOICE, rate=rate)
                await comm.save(outpath)
                if os.path.getsize(outpath) > 500:
                    stats["ok"] += 1
                    if stats["ok"] % 100 == 0:
                        print(f"  ...{stats['ok']} generated", flush=True)
                    return
            except Exception as e:
                if attempt == 2:
                    stats["fail"] += 1
                    print(f"  FAIL {relpath}: {e}", flush=True)
                else:
                    await asyncio.sleep(1.5)

async def main_async(tasks, concurrency, limit):
    sem = asyncio.Semaphore(concurrency)
    stats = {"ok": 0, "skip": 0, "fail": 0}
    if limit:
        tasks = tasks[:limit]
    await asyncio.gather(*(gen_one(sem, t, r, p, stats) for (t, r, p) in tasks))
    return stats

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest-only", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--concurrency", type=int, default=10)
    args = ap.parse_args()

    tasks, manifest = build_tasks_and_manifest()
    with open(os.path.join(DATA, "audio-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    counts = {k: len(manifest[k]) for k in ("word", "ex", "grammar", "writing", "reading")}
    print(f"manifest written. entries={counts}, total mp3 tasks={len(tasks)}", flush=True)

    if args.manifest_only:
        return
    stats = asyncio.run(main_async(tasks, args.concurrency, args.limit))
    print(f"DONE gen: ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}", flush=True)
    # 寫完成標記
    with open(os.path.join(ROOT, "deliverables", "AUDIO.DONE"), "w", encoding="utf-8") as f:
        f.write(f"ok={stats['ok']} skip={stats['skip']} fail={stats['fail']} total_tasks={len(tasks)}\n")

if __name__ == "__main__":
    main()
