# -*- coding: utf-8 -*-
"""
批量生成题库读音音频（edge-tts 神经网络语音，输出真实 mp3）。

读取 src/data/seed/questions-chinese.json 与 questions-english.json，
对每道带 media.audio 的题目提取"应朗读文本"：
- 听写题（answer.order）：按序拼接字卡文本，如 绒+毛 -> "绒毛"
- 单词卡（answer.choice）：正确选项文本，如 "hello"

输出到 public/<media.audio>（与种子数据引用路径一致，Vite 将 public 原样发布）。
已存在的文件跳过，可重复运行（增量生成）。生成需要联网（仅生成时）。

用法：python scripts/generate_audio.py
"""

import asyncio
import json
import re
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent

# (种子文件, TTS 语音) —— 中文用晓晓，英文用 Aria，语速放慢 10% 方便儿童听辨
SEEDS = [
    (ROOT / "src" / "data" / "seed" / "questions-chinese.json", "zh-CN-XiaoxiaoNeural"),
    (ROOT / "src" / "data" / "seed" / "questions-english.json", "en-US-AriaNeural"),
]

TTS_RATE = "-10%"
MAX_RETRY = 3


# 图片型卡片题干引号提取（与 src/engine/wordCardOptions.ts 的
# extractWordCardSpelling 正则一致：“word”/"word"/「word」）
QUOTE_RE = re.compile(r'[“"「]([^”"」]+)[”"」]')


def spoken_text(question: dict) -> str:
    """按判定数据还原题目应朗读的文本；无法还原时返回空串。"""
    options = {o["id"]: o for o in question.get("options", [])}
    answer = question.get("answer", {})
    if answer.get("order"):
        return "".join((options.get(i) or {}).get("text", "") for i in answer["order"])
    if answer.get("choice"):
        text = (options.get(answer["choice"][0]) or {}).get("text", "")
        if text:
            return text
    # 图片型卡片（选项只有图片）：从题干引号中提取单词
    match = QUOTE_RE.search(question.get("stem", ""))
    return match.group(1) if match else ""


async def synthesize(text: str, voice: str, out_path: Path) -> None:
    communicate = edge_tts.Communicate(text, voice, rate=TTS_RATE)
    await communicate.save(str(out_path))


async def main() -> int:
    jobs = []
    for seed_path, voice in SEEDS:
        data = json.loads(seed_path.read_text(encoding="utf-8"))
        for q in data["questions"]:
            audio = (q.get("media") or {}).get("audio")
            if not audio:
                continue
            text = spoken_text(q)
            if not text:
                print(f"SKIP {q['id']}: 无法还原朗读文本")
                continue
            out_path = ROOT / "public" / audio
            if out_path.exists():
                continue
            out_path.parent.mkdir(parents=True, exist_ok=True)
            jobs.append((q["id"], text, voice, out_path))

    print(f"待生成 {len(jobs)} 个音频文件")
    failed = 0
    for qid, text, voice, out_path in jobs:
        for attempt in range(1, MAX_RETRY + 1):
            try:
                await synthesize(text, voice, out_path)
                print(f"OK   {qid} -> {out_path.relative_to(ROOT)} [{text}]")
                break
            except Exception as exc:  # noqa: BLE001 - 批量任务记录后继续
                if attempt == MAX_RETRY:
                    failed += 1
                    print(f"FAIL {qid}: {exc}")
                else:
                    await asyncio.sleep(1.5 * attempt)

    print(f"完成：成功 {len(jobs) - failed}，失败 {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
