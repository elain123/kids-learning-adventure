# -*- coding: utf-8 -*-
"""
批量生成题库读音音频（edge-tts 神经网络语音，输出真实 mp3）。

读取 src/data/seed/ 下全部 questions-*.json（含各年级分册），对每道带
media.audio 的题目提取"应朗读文本"：
- 听写题（answer.order）：按序拼接字卡文本，如 绒+毛 -> "绒毛"
- 单词卡（answer.choice）：正确选项文本，如 "hello"
- 听问句 / 听句子（题干以"听问句"/"听句子"开头）：朗读题干引号中的句子；
  补全题用正确选项替换句中 ____ 后再朗读
- 图片型卡片（选项只有图片）：从题干引号中提取单词

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
SEED_DIR = ROOT / "src" / "data" / "seed"

TTS_RATE = "-10%"
MAX_RETRY = 3


# 图片型卡片题干引号提取（与 src/engine/wordCardOptions.ts 的
# extractWordCardSpelling 正则一致：“word”/"word"/「word」）
QUOTE_RE = re.compile(r'[“"「]([^”"」]+)[”"」]')
BLANK_RE = re.compile(r"_{2,}")


def iter_seeds():
    """按文件名识别语种：chinese -> 晓晓，english -> Aria；
    math 等无 media.audio 的种子文件自然不产生任务。"""
    for path in sorted(SEED_DIR.glob("questions-*.json")):
        if "chinese" in path.name:
            yield path, "zh-CN-XiaoxiaoNeural"
        elif "english" in path.name:
            yield path, "en-US-AriaNeural"


def spoken_text(question: dict) -> str:
    """按判定数据还原题目应朗读的文本；无法还原时返回空串。"""
    options = {o["id"]: o for o in question.get("options", [])}
    answer = question.get("answer", {})
    stem = question.get("stem", "")

    # 听问句 / 听句子：朗读题干引号中的句子本身（而非正确答语）；
    # 补全题先把 ____ 替换成正确选项文本，保证读到的是完整句子
    if stem.startswith(("听问句", "听句子")):
        match = QUOTE_RE.search(stem)
        if not match:
            return ""
        sentence = match.group(1)
        if BLANK_RE.search(sentence) and answer.get("choice"):
            word = (options.get(answer["choice"][0]) or {}).get("text", "")
            if word:
                sentence = BLANK_RE.sub(word, sentence)
        return sentence

    if answer.get("order"):
        return "".join((options.get(i) or {}).get("text", "") for i in answer["order"])
    if answer.get("choice"):
        text = (options.get(answer["choice"][0]) or {}).get("text", "")
        if text:
            return text
    # 图片型卡片（选项只有图片）：从题干引号中提取单词
    match = QUOTE_RE.search(stem)
    return match.group(1) if match else ""


async def synthesize(text: str, voice: str, out_path: Path) -> None:
    communicate = edge_tts.Communicate(text, voice, rate=TTS_RATE)
    await communicate.save(str(out_path))


async def main() -> int:
    jobs = []
    for seed_path, voice in iter_seeds():
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
