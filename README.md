# 趣味学习冒险（kids-learning-adventure）

面向小学生的语 / 数 / 英趣味闯关学习应用。Vue 3 + Vite 单页应用，纯前端、可离线使用。

## 功能

- **今日冒险**：每日自动生成闯关队列（复习题在前、新题在后），10 分钟一关、3 题一组
- **三个学科岛**：语文大陆（听写 / 拼音 / 形近字 / 多音字 / 词语搭配 / 成语 / 古诗文接龙）、
  数学王国（口算 / 填空 / 判断 / 选择 / 单位换算 / 几何）、英语岛（单词记忆卡）
- **激励体系**：答对得星星，星星开宝箱，收集 12 件宠物与装扮装点"我的小岛"
- **语音读音**：预生成神经网络语音（edge-tts）+ 浏览器 TTS 兜底，听写与单词发音即点即播

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 本地开发（默认 http://localhost:5173）
npm test          # 运行测试（vitest，204 个用例）
npm run build     # 构建产物到 dist/
```

## 资源生成脚本（已生成的产物在 public/ 下，无需重跑）

```bash
python scripts/generate_audio.py   # 生成词条读音 mp3（edge-tts，需联网）
node scripts/generate_images.mjs   # 生成单词占位图（SVG）
node scripts/fetch_twemoji.mjs     # 下载 Twemoji 矢量插画替换占位图
```

## 许可与署名

- 单词插图为 Twemoji（CC-BY 4.0），署名见 `public/img/en/ATTRIBUTION.md`
