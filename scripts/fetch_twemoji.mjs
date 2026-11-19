// 用 Twemoji 矢量插画替换占位图：按 word→emoji 映射把 emoji 转成 Twemoji
// 文件名（码点，去 fe0f），从 jsDelivr 下载 SVG 覆盖 public/img/en/... 同名文件。
// Twemoji 图形版权 Twitter/X，CC-BY 4.0，署名见 public/img/en/ATTRIBUTION.md。
// 用法：node scripts/fetch_twemoji.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORD_EMOJI } from './word-emoji-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = [
  'src/data/seed/questions-english.json',
  'src/data/seed/questions-english-g5.json',
  'src/data/seed/questions-english-g6.json',
];
const CDN = 'https://testingcf.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg';
const CONCURRENCY = 6;
const MAX_RETRY = 3;

/** emoji → twemoji 文件名码点（小写十六进制，去掉 fe0f 变体选择符，'-' 连接） */
function twemojiCode(emoji) {
  return [...emoji]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((cp) => cp !== 'fe0f')
    .join('-');
}

const CACHE_DIR = join(ROOT, 'scripts/.cache/twemoji');

async function download(code, attempt = 1) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${code}.svg`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf-8');
  const res = await fetch(`${CDN}/${code}.svg`);
  if (res.ok) {
    const text = await res.text();
    writeFileSync(cacheFile, text, 'utf-8');
    return text;
  }
  if (attempt >= MAX_RETRY) throw new Error(`HTTP ${res.status}`);
  await new Promise((r) => setTimeout(r, 800 * attempt));
  return download(code, attempt + 1);
}

// ---- 收集全部图片路径（media.image + 选项 image，.svg） ----
const paths = new Set();
for (const seed of SEEDS) {
  const bank = JSON.parse(readFileSync(join(ROOT, seed), 'utf-8'));
  for (const q of bank.questions) {
    if (q.media?.image) paths.add(q.media.image);
    for (const o of q.options ?? []) {
      if (o.image) paths.add(o.image);
    }
  }
}

// 同 emoji 只下载一次：word → code → svg 内容
const jobs = [...paths].map((p) => {
  const word = p.split('/').pop().replace(/\.svg$/, '');
  const emoji = WORD_EMOJI[word];
  if (!emoji) throw new Error(`缺少 emoji 映射：${word}`);
  return { path: p, code: twemojiCode(emoji) };
});

const uniqueCodes = [...new Set(jobs.map((j) => j.code))];
console.log(`图片路径 ${paths.size} 个，待下载 emoji ${uniqueCodes.length} 个`);

const svgByCode = new Map();
const failed = [];
for (let i = 0; i < uniqueCodes.length; i += CONCURRENCY) {
  const batch = uniqueCodes.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(async (code) => {
      try {
        svgByCode.set(code, await download(code));
      } catch (err) {
        failed.push(`${code}: ${err.message}`);
      }
    }),
  );
}

if (failed.length > 0) {
  console.error(`下载失败 ${failed.length} 个：\n${failed.join('\n')}`);
  process.exit(1);
}

let written = 0;
for (const job of jobs) {
  const out = join(ROOT, 'public', job.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svgByCode.get(job.code), 'utf-8');
  written += 1;
}

// 署名文件（CC-BY 4.0 要求）
const attribution = `本目录下的 .svg 图片来自 Twemoji（https://github.com/jdecked/twemoji）。
图形版权归 Twitter, Inc 及其他作者所有，依据 CC-BY 4.0 许可证使用：
https://creativecommons.org/licenses/by/4.0/
`;
writeFileSync(join(ROOT, 'public/img/en/ATTRIBUTION.md'), attribution, 'utf-8');

console.log(`完成：写入 ${written} 个文件，署名 public/img/en/ATTRIBUTION.md`);
