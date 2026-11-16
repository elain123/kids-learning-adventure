// 批量生成单词占位图（SVG：渐变底 + 大 emoji，不含文字，避免图片选项题泄露答案）。
// 读取 src/data/seed/questions-english.json 中全部 media.image 与选项 image 路径，
// 按文件名查 word→emoji 映射生成 public/<path>（.svg），并把种子中的 .png 改为 .svg。
// 已存在的文件跳过（增量）；将来拿到真实图片时同名替换 public/img/... 即可。
// 用法：node scripts/generate_images.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'src/data/seed/questions-english.json');

/** word → emoji（覆盖题库全部 156 个图片单词） */
const WORD_EMOJI = {
  afternoon: '🕒', angry: '😠', apple: '🍎', art: '🎨', autumn: '🍂',
  bag: '🎒', basketball: '🏀', big: '🐘', bike: '🚲', birthday: '🎂',
  black: '⬛', blackboard: '🧑‍🏫', blue: '🟦', bread: '🍞', brother: '👦',
  cat: '🐱', chair: '🪑', chicken: '🐔', christmas: '🎄', cinema: '🎬',
  city: '🏙️', clean: '🧹', clever: '🦉', cloud: '☁️', cloudy: '🌥️',
  coat: '🧥', cook: '🍳', cool: '😎', cute: '🥰', day: '🌞',
  desk: '📚', dinner: '🍽️', door: '🚪', dress: '👗', duck: '🦆',
  dumpling: '🥟', ear: '👂', egg: '🥚', eight: '8️⃣', elephant: '🐘',
  evening: '🌆', eye: '👁️', face: '😀', family: '👨‍👩‍👧‍👦', famous: '🌟',
  far: '🔭', fast: '🚀', father: '👨', fish: '🐟', five: '5️⃣',
  foot: '🦶', football: '⚽', friend: '🧑‍🤝‍🧑', goodbye: '👋', grandma: '👵',
  grandpa: '👴', green: '🟩', halloween: '🎃', hand: '✋', happy: '😄',
  head: '👤', headache: '🤕', hello: '🙋', high: '⛰️', horse: '🐴',
  hospital: '🏥', house: '🏠', hundred: '💯', juice: '🧃', jump: '🦘',
  left: '⬅️', lion: '🦁', long: '🐍', lose: '😞', low: '🍄',
  maths: '🔢', meat: '🍖', metre: '📏', milk: '🥛', monkey: '🐵',
  month: '📅', morning: '🌅', mother: '👩', mouth: '👄', music: '🎵',
  name: '📛', naughty: '😜', near: '📍', newyear: '🎆', nice: '😊',
  night: '🌃', noodles: '🍜', nose: '👃', old: '🧓', panda: '🐼',
  park: '🏞️', pe: '🏅', phone: '📱', pig: '🐷', play: '🪀',
  potato: '🥔', rain: '🌧️', rainy: '☔', red: '🟥', rice: '🍚',
  ride: '🚴', right: '➡️', run: '🏃', sad: '😢', school: '🏫',
  science: '🔬', sheep: '🐑', ship: '🚢', short: '🤏', shy: '🙈',
  sister: '👧', six: '6️⃣', skip: '🤸', small: '🐜', snow: '❄️',
  snowy: '⛄', soup: '🍲', spring: '🌸', straight: '🧵', street: '🛣️',
  summer: '🏖️', sunny: '☀️', supermarket: '🛒', sweater: '🧶', swim: '🏊',
  table: '🏓', tall: '🦒', tea: '🍵', ten: '🔟', thirsty: '🥤',
  three: '3️⃣', tiger: '🐯', tomato: '🍅', trousers: '👖', tshirt: '👕',
  twelve: '1️⃣2️⃣', two: '2️⃣', village: '🏡', wash: '🧼', watch: '⌚',
  water: '💧', week: '🗓️', win: '🏆', wind: '🌬️', window: '🪟',
  windy: '💨', winter: '🌨️', year: '📆', yellow: '🟨', young: '🧒',
  zoo: '🦓',
};

/** 儿童友好的渐变底色（按单词哈希确定性地取一组） */
const PALETTES = [
  ['#FFE29A', '#FFB37A'], ['#A8E6CF', '#56C596'], ['#FFD3E0', '#FF8FAB'],
  ['#BDE0FE', '#6FB1FC'], ['#FFF3B0', '#FFD60A'], ['#E2C6FF', '#B388EB'],
  ['#C3FBD8', '#52D273'], ['#FFD6A5', '#FF9E5E'],
];

function emojiFor(word) {
  const emoji = WORD_EMOJI[word];
  if (!emoji) throw new Error(`缺少 emoji 映射：${word}（请在 WORD_EMOJI 中补充）`);
  return emoji;
}

function paletteFor(word) {
  let hash = 0;
  for (const ch of word) hash = (hash + ch.charCodeAt(0)) % 997;
  return PALETTES[hash % PALETTES.length];
}

function svgFor(word) {
  const [c1, c2] = paletteFor(word);
  const emoji = emojiFor(word);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#bg)"/>
  <circle cx="100" cy="100" r="74" fill="rgba(255,255,255,0.65)"/>
  <text x="100" y="130" font-size="88" text-anchor="middle">${emoji}</text>
</svg>
`;
}

// ---- 收集全部图片路径（media.image + 选项 image） ----
const bank = JSON.parse(readFileSync(SEED, 'utf-8'));
const paths = new Set();
for (const q of bank.questions) {
  if (q.media?.image) paths.add(q.media.image);
  for (const o of q.options ?? []) {
    if (o.image) paths.add(o.image);
  }
}

// ---- 生成 SVG（.png 路径 → .svg 文件） ----
let created = 0;
for (const p of paths) {
  const word = p.split('/').pop().replace(/\.png$/, '');
  const out = join(ROOT, 'public', p.replace(/\.png$/, '.svg'));
  if (existsSync(out)) continue;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svgFor(word), 'utf-8');
  created += 1;
}

// ---- 种子路径 .png → .svg ----
const raw = readFileSync(SEED, 'utf-8');
const pngCount = (raw.match(/\.png/g) ?? []).length;
writeFileSync(SEED, raw.replaceAll('.png', '.svg'), 'utf-8');

console.log(`图片路径 ${paths.size} 个，新生成 SVG ${created} 个；种子 .png 引用 ${pngCount} 处已改为 .svg`);
