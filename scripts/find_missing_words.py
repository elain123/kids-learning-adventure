# -*- coding: utf-8 -*-
"""临时：找出 g5/g6 英语题卡引用的图片单词中，不在 word-emoji-map 里的词。"""
import json
import re
from pathlib import Path

mapped = set(
    re.findall(
        r"(\w+):",
        Path('scripts/word-emoji-map.mjs').read_text(encoding='utf-8'),
    )
)

missing = []
for seed in ['src/data/seed/questions-english-g5.json', 'src/data/seed/questions-english-g6.json']:
    data = json.loads(Path(seed).read_text(encoding='utf-8'))
    imgs = set()
    for q in data['questions']:
        media = q.get('media') or {}
        if media.get('image'):
            imgs.add(media['image'])
        for o in q.get('options', []):
            if o.get('image'):
                imgs.add(o['image'])
    for p in sorted(imgs):
        word = p.split('/')[-1].replace('.svg', '').replace('.png', '')
        if word not in mapped:
            missing.append((seed.split('-')[-1], word, p))

lines = ['%s | %s | %s' % m for m in missing]
Path('missing-words.txt').write_text('\n'.join(lines) if lines else '(无缺失)', encoding='utf-8')
print('done, missing:', len(missing))
