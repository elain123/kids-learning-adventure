# Implementation Plan: kids-learning-adventure

## Overview

按设计文档的分层架构实施：先搭建 Vue 3 + Vite + TypeScript 工程与核心类型，再实现数据层（题库加载校验、Local_Store 适配器）与纯函数引擎层（复习引擎、口算生成器、冒险引擎、宝箱、判定），然后实现服务层（Audio_Service、视听反馈）与 UI 层（题型交互组件、六个页面），最后接入种子题库内容、响应式适配，并以集成/冒烟测试收尾。种子题库内容为独立数据文件，可与引擎、UI 任务并行执行。实现语言为 TypeScript，测试框架为 Vitest + fast-check（属性测试）+ @vue/test-utils（组件测试）。

## Tasks

- [x] 1. 项目脚手架与核心类型定义
  - [x] 1.1 初始化 Vue 3 + Vite + TypeScript 工程与测试框架
    - 创建 package.json、vite.config.ts、vitest.config.ts、tsconfig.json、index.html、src/main.ts、src/App.vue、src/router/index.ts（路由骨架：`/`、`/subject/:id`、`/practice`、`/box`、`/island`）
    - 安装并配置 Vitest、fast-check、@vue/test-utils、jsdom，验证 `vitest --run` 可执行
    - _Requirements: 11.1, 13.1_
  - [x] 1.2 定义核心类型与常量
    - 创建 src/types/index.ts：IntervalLevel、INTERVALS_MS、MasteryRecord、QuestionType（含二期 reading/word_problem/read_aloud）、Question、GeneratorParams、QueueItem、TodaySession、AnswerResult、StarWallet、IslandCollection、SessionConfig、COLLECTIBLE_ITEMS（6 宠物 + 6 装扮共 12 件常量）
    - _Requirements: 3.1, 5.4, 9.2_

- [x] 2. 题库加载与校验（Question_Bank）
  - [x] 2.1 实现题库加载、逐题校验与索引
    - 创建 src/data/questionBank.ts：validateQuestion（必需字段与取值域校验）、loadQuestionBank（整体解析失败返回 fatal）、按学科/年级/单元/知识点的索引、phase=2 题载入但标记不入队、错误日志缓冲
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 13.4, 13.7_
  - [x] 2.2 编写属性测试：题库校验过滤与整体损坏
    - 创建 tests/property/questionBank.props.spec.ts，fast-check 每个属性最少 100 次迭代，注释标签格式 `**Feature: kids-learning-adventure, Property {n}: {property_text}**`
    - **Property 20: 题库校验过滤**
    - **Validates: Requirements 9.3, 9.4, 9.6**
    - **Property 21: 题库整体损坏即失败**
    - **Validates: Requirements 9.5**

- [x] 3. Local_Store 本地存储适配器
  - [x] 3.1 实现命名空间读写、损坏备份自愈与写失败上报
    - 创建 src/data/localStore.ts：键格式 `kla:v1:{accountId}:{entity}`（一期 accountId 固定 default）、备份键 `backup:{entity}:{timestamp}`（会话内不覆盖）、各实体读取校验与初始态恢复、变化后 1 秒内写入、写失败抛出供 UI 提示
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 12.7, 13.5_
  - [x] 3.2 编写属性测试：读写往返、多账号隔离与损坏自愈
    - 创建 tests/property/localStore.props.spec.ts（内存 mock localStorage），fast-check 每个属性最少 100 次迭代
    - **Property 22: 存储读写往返与多账号隔离**
    - **Validates: Requirements 10.1, 10.2, 10.3, 12.7, 13.5**
    - **Property 23: 损坏数据自愈与备份保留**
    - **Validates: Requirements 10.4**

- [x] 4. 复习引擎（Review_Engine）
  - [x] 4.1 实现间隔状态机 applyAnswer
    - 在 src/engine/reviewEngine.ts 中实现 applyAnswer：首对建 1 级（10 分钟）、1-4 级答对升级、答错重置 1 级并 requeue=true、5 级答对标记掌握并清除 nextReviewAt；纯函数，时间参数注入
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7_
  - [x] 4.2 编写属性测试：间隔状态机
    - 创建 tests/property/reviewEngine.props.spec.ts，fast-check 每个属性最少 100 次迭代
    - **Property 4: 首次答对建立一级间隔**
    - **Validates: Requirements 3.2**
    - **Property 5: 答对升级间隔序列**
    - **Validates: Requirements 3.3**
    - **Property 6: 答错重置并当日重出**
    - **Validates: Requirements 3.4**
    - **Property 7: 五级答对即掌握且永不再入队**
    - **Validates: Requirements 3.7**
    - **Property 10: 重试答对按答错记**
    - **Validates: Requirements 4.3**
  - [x] 4.3 实现今日队列生成 buildTodayQueue
    - 在 src/engine/reviewEngine.ts 中追加 buildTodayQueue：到点复习题按 nextReviewAt 升序在前、新知识点题在后、跳过已掌握与 phase=2 题目、按本地自然日判定当日队列是否已生成（已生成则沿用）
    - _Requirements: 3.5, 3.6, 3.8, 3.9, 1.4, 1.6, 13.7_
  - [x] 4.4 编写属性测试：今日队列
    - 创建 tests/property/todayQueue.props.spec.ts，fast-check 每个属性最少 100 次迭代
    - **Property 8: 今日队列排序与分段**
    - **Validates: Requirements 3.5, 3.6, 1.4, 1.6**
    - **Property 9: 今日队列按自然日只生成一次**
    - **Validates: Requirements 3.8, 3.9**
    - **Property 24: 二期题型不入今日队列**
    - **Validates: Requirements 13.7**

- [x] 5. 数学口算生成器（Math_Generator）
  - [x] 5.1 实现 generateOralQuestion
    - 创建 src/engine/mathGenerator.ts：随机源注入、按 operands 范围取样、按 operation 计算真实答案、constraints 校验（减法非负/整除/小数位上限）、有限次重采后放宽
    - _Requirements: 7.3_
  - [x] 5.2 编写属性测试：口算生成器产出合法且答案正确
    - 创建 tests/property/mathGenerator.props.spec.ts，fast-check 最少 100 次迭代
    - **Property 17: 口算生成器产出合法且答案正确**
    - **Validates: Requirements 7.3**

- [x] 6. Checkpoint - 数据层与引擎基础完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 冒险引擎（Adventure_Engine）
  - [x] 7.1 实现会话编排：三题分组、nextUnanswered、会话序列化
    - 创建 src/engine/adventureEngine.ts：groupIntoGroups（每组 3 题、末组 1-3）、nextUnanswered、TodaySession 序列化/反序列化（供进度保存与恢复）
    - _Requirements: 2.1, 2.4, 2.5, 2.7, 2.8, 7.9, 1.3, 1.5_
  - [x] 7.2 编写属性测试：会话定位、分组与持久化往返
    - 创建 tests/property/session.props.spec.ts，fast-check 每个属性最少 100 次迭代
    - **Property 1: 下一未答题定位**
    - **Validates: Requirements 1.3, 1.5, 2.7**
    - **Property 2: 三题分组不变量**
    - **Validates: Requirements 2.1, 7.9**
    - **Property 3: 会话持久化往返**
    - **Validates: Requirements 2.4, 2.5, 2.8**
  - [x] 7.3 实现作答流程：首答/重试、连胜连错、难度下调、星星发放
    - 在 src/engine/adventureEngine.ts 中追加 applyFirstAnswer（streak/consecutiveWrong 计数转移、retryLeft=1）、applyRetry（重试答对按答错记）、awardAnswer（streak 达 3 的倍数翻倍为 10，否则 5）、shouldLowerDifficulty（连错 3 题降 1 级且不低于学科最低难度）
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1_
  - [x] 7.4 编写属性测试：作答计数转移、星星规则与难度调节
    - 创建 tests/property/answerFlow.props.spec.ts，fast-check 每个属性最少 100 次迭代
    - **Property 11: 首次作答计数转移**
    - **Validates: Requirements 4.1, 4.4, 4.5, 4.8**
    - **Property 12: 星星发放规则**
    - **Validates: Requirements 4.6, 5.1**
    - **Property 13: 连错降难度且不低于下限**
    - **Validates: Requirements 4.7, 4.8**
  - [x] 7.5 实现关卡计时与口算历史最佳纪录
    - 创建 src/engine/sessionClock.ts（10 分钟关卡计时，时钟注入，到点产出"继续/休息"事件）与 src/engine/oralBest.ts（updateOralBest：无纪录记本关、超过则更新并标记新纪录；关卡完成 +10 星星结算）
    - _Requirements: 2.2, 2.6, 5.2, 7.4, 7.5, 7.6, 7.7, 7.8_
  - [x] 7.6 编写属性测试：历史最佳纪录更新
    - 创建 tests/property/oralBest.props.spec.ts，fast-check 最少 100 次迭代
    - **Property 18: 历史最佳纪录更新**
    - **Validates: Requirements 7.6, 7.7, 7.8**

- [x] 8. 星星钱包与宝箱
  - [x] 8.1 实现宝箱开启 openTreasureBox
    - 创建 src/engine/rewards.ts：余额 ≥30 扣 30 并注入随机源产出 12 件之一、新物品入 Island_Collection、重复物品返 5 星且不重复入收藏、余额不足返回 insufficient 且双方不变
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 8.2 编写属性测试：宝箱守恒与余额不足
    - 创建 tests/property/rewards.props.spec.ts，fast-check 每个属性最少 100 次迭代
    - **Property 14: 宝箱开启守恒**
    - **Validates: Requirements 5.3, 5.4, 5.6, 5.7**
    - **Property 15: 星星不足不可开箱**
    - **Validates: Requirements 5.5**

- [x] 9. 作答判定与单词卡选项构造
  - [x] 9.1 实现作答判定服务
    - 创建 src/engine/judge.ts：按题型比对规则（choice/order/pairs/number/bool）判定作答与标准答案是否一致，纯本地判定
    - _Requirements: 6.5, 8.5_
  - [x] 9.2 编写属性测试：判定与标准答案一致
    - 创建 tests/property/judge.props.spec.ts，fast-check 最少 100 次迭代
    - **Property 16: 判定与标准答案一致**
    - **Validates: Requirements 6.5, 8.5**
  - [x] 9.3 实现单词卡 4 选项构造器
    - 创建 src/engine/wordCardOptions.ts：随机源注入，产出恰 4 个选项（1 正确 + 3 互不相同且不等于正确项的干扰项），支持图片与拼写两种模式
    - _Requirements: 8.4_
  - [x] 9.4 编写属性测试：单词卡选项构造
    - 创建 tests/property/wordCardOptions.props.spec.ts，fast-check 最少 100 次迭代
    - **Property 19: 单词卡选项构造**
    - **Validates: Requirements 8.4**

- [x] 10. Checkpoint - 引擎层全部完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Audio_Service 与视听反馈
  - [x] 11.1 实现 Audio_Service（Web Audio 音效、读音播放、失败降级）
    - 创建 src/services/audioService.ts：合成答对/答错（≤1 秒、无人声、与答对不同）/星星/宝箱音效，生字与单词读音播放与不限次重播，音频失败时抛出可捕获错误且不阻塞作答，音效不可用时静默降级
    - _Requirements: 6.3, 6.6, 8.3, 8.6, 8.7, 12.3, 12.4_
  - [x] 11.2 实现音效开关与答题反馈编排
    - 创建 src/services/feedback.ts（答对触发音效 + ≤3 秒庆祝动画事件、答错触发提示音效、首错给 Hint 不给答案、再错给答案 + ≤100 字解析 + 鼓励文案事件）与 src/data/encouragement.ts（无批评否定表述的鼓励文案库）；音效开关默认开、关闭即停当前音效且后续不播、状态经 Local_Store settings 持久化
    - _Requirements: 4.1, 4.2, 12.3, 12.4, 12.5, 12.6, 12.7_
  - [x] 11.3 编写单元测试：音频失败降级、开关行为与反馈时序
    - 创建 tests/unit/audioFeedback.spec.ts：mock Audio_Service 验证重听/重播不限次、失败时提示可见且图片拼写可用可作答、开关关闭停播且重启后恢复设置
    - _Requirements: 6.3, 6.6, 8.3, 8.6, 8.7, 12.5, 12.6, 12.7_

- [x] 12. 题型交互组件
  - [x] 12.1 实现 ChoicePad 点选组件
    - 创建 src/components/question/ChoicePad.vue：大号圆角选项卡（触控区域 ≥44×44px），点选高亮并提交判定，适用拼音选择/多音字/判断/选择/单词卡 4 选 1
    - _Requirements: 6.4, 7.2, 8.4, 12.2_
  - [x] 12.2 实现 DragMatch 拖拽组件
    - 创建 src/components/question/DragMatch.vue：Pointer Events 统一触摸/鼠标拖拽、目标槽吸附（≥44×44px），适用词语搭配/成语填空/形近字辨析/单位换算
    - _Requirements: 6.4, 7.2, 11.4, 12.2_
  - [x] 12.3 实现 NumericKeypad 数字键盘组件
    - 创建 src/components/question/NumericKeypad.vue：屏幕大数字键盘（0-9、小数点、删除、确认），不调用系统键盘，适用口算速算/填空/几何计算
    - _Requirements: 7.2, 11.4, 12.2_
  - [x] 12.4 实现 WordCard 单词卡组件
    - 创建 src/components/question/WordCard.vue：图片 + 拼写展示、展示时自动播放发音一次、重播按钮不限次、音频失败显示提示但图片拼写可用可作答，接 8.3 的选项构造器作答
    - _Requirements: 8.2, 8.3, 8.4, 8.6, 8.7_
  - [x] 12.5 实现 DictationCard 听写卡组件
    - 创建 src/components/question/DictationCard.vue：展示时自动播放读音一次、重听按钮不限次、以点选/拖拽拼合作答（不键盘输入）
    - _Requirements: 6.3, 6.4, 6.6_
  - [x] 12.6 编写组件单元测试
    - 创建 tests/unit/questionComponents.spec.ts：@vue/test-utils + jsdom 验证五类组件交互、44×44px 触控区域、音频失败降级展示
    - _Requirements: 8.7, 11.4, 12.2_

- [x] 13. 页面与路由
  - [x] 13.1 实现首页地图页
    - 创建 src/pages/HomePage.vue：卡通地图背景、"今日冒险"大按钮（唯一练习入口，无科目/难度前置选择，点击 2 秒内经冒险引擎直接展示第一题）、完成后"已完成"态与庆祝画面、星星余额（变化 1 秒内刷新）、宝箱/小岛入口、音效开关、题库加载失败与无可出题提示停留首页
    - _Requirements: 1.1, 1.2, 1.5, 1.7, 5.9, 9.5, 12.1, 12.5_
  - [x] 13.2 实现学科入口页
    - 创建 src/pages/SubjectPage.vue：语文大陆/数学王国/英语岛三主题卡通形象入口与学科今日进度，由"今日冒险"机制驱动对应学科会话，不提供科目外前置选择，不展示二期功能入口
    - _Requirements: 13.1, 13.2, 13.6_
  - [x] 13.3 实现练习页与小组/关卡结算弹层
    - 创建 src/pages/PracticePage.vue：按题型渲染 12.x 交互组件、Streak 实时计数、第 X 组第 Y 题进度、Hint 条与重试/再错反馈、口算关 10 分钟倒计时与到时自动结算、小组结算与 10 分钟提示的"继续/休息"两个大按钮（≥44×44px）、中途退出保存进度并在重进时恢复下一未答题、关卡结算 +10 星星与口算"本关答对 vs 历史最佳"及新纪录提示；全程经 Local_Store 在变化后 1 秒内持久化
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 4.2, 4.4, 5.2, 7.4, 7.5, 7.6, 7.7, 7.8, 10.2_
  - [x] 13.4 实现宝箱页
    - 创建 src/pages/BoxPage.vue：宝箱动画、"开启（30 星星）"按钮旁标注消耗、余额不足提示与"去闯关"引导、产出展示（新物品入收藏/重复返 5 星），接 8.1 的 openTreasureBox
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 13.5 实现小岛展示页
    - 创建 src/pages/IslandPage.vue：展示已收集宠物与装扮、"已收集 N/12"计数
    - _Requirements: 5.8_
  - [x] 13.6 编写页面单元测试
    - 创建 tests/unit/pages.spec.ts：首页仅"今日冒险"一个练习入口、宝箱入口旁 30 星星标注、小岛 N/12 计数、MVP 界面无二期功能入口、可点击元素触控区域 ≥44×44px
    - _Requirements: 1.1, 5.3, 5.8, 12.2, 13.6_

- [x] 14. 种子题库内容
  - [x] 14.1 编写语文种子题（人教版三四年级七类题型）
    - 创建 src/data/seed/questions-chinese.json：按年级/册/单元组织，覆盖生字听写、拼音选择、形近字辨析、多音字辨析、词语搭配、成语填空、古诗文接龙七类题型，字段符合题库 Schema（含 hint 与 ≤100 字解析），仅覆盖三四年级
    - _Requirements: 6.1, 6.2, 13.8_
  - [x] 14.2 编写数学种子题与口算生成器参数（三四年级全部单元、六类题型）
    - 创建 src/data/seed/questions-math.json（覆盖三年级 13 个单元与四年级 13 个单元知识点，含填空/判断/选择/单位换算/几何计算题型）与 src/data/seed/generators-math.json（各口算知识点的 GeneratorParams，含 operation 与 constraints）
    - _Requirements: 7.1, 7.2, 7.3, 13.8_
  - [x] 14.3 编写英语单词卡种子与 12 件收集品清单
    - 创建 src/data/seed/questions-english.json（外研版三起三四年级，按年级/册/Module 组织，每卡含图片/发音音频/拼写）与 src/data/seed/collectibles.json（6 宠物 + 6 装扮）
    - _Requirements: 8.1, 8.2, 5.4, 13.8_
  - [x] 14.4 编写种子数据契约测试
    - 创建 tests/unit/seedContract.spec.ts：种子经 2.1 校验全部合法、语文七类题型齐全、数学覆盖三四年级全部单元知识点与六类题型、英语卡含图片/音频/拼写、种子仅覆盖三四年级、题型枚举含二期三类且 phase=2 不入队
    - _Requirements: 6.1, 6.2, 7.1, 7.2, 8.1, 8.2, 13.4, 13.7, 13.8_

- [x] 15. 响应式与多端适配
  - [x] 15.1 实现响应式布局与横竖屏自适应
    - 创建 src/styles/responsive.css 并在各页面接入：320px 及以上宽度首页/练习/结算页无横向滚动、答题控件完整可视、触摸与鼠标均可完成点选与拖拽、旋转屏幕或改变窗口大小时布局自适应且练习进度与答题状态保持
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 12.2_
  - [x] 15.2 编写布局适配测试
    - 创建 tests/unit/responsive.spec.ts：jsdom 多视口（320/768/桌面宽度）断言无横向滚动与控件完整可视
    - _Requirements: 11.2, 11.3_

- [x] 16. 集成与冒烟测试
  - [x] 16.1 编写端到端主链路集成测试
    - 创建 tests/integration/mainFlow.spec.ts（jsdom + 内存 localStorage）：打开应用 → 今日冒险 → 答完全部题（含首错重试）→ 小组/关卡结算 → 星星到账 → 开宝箱 → 小岛查看 → 关闭重开恢复进度
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.4, 2.5, 3.1, 4.1, 4.2, 4.3, 5.1, 5.2, 5.4, 5.6, 10.1, 10.2, 10.3, 10.4_
  - [x] 16.2 编写断网冒烟与写失败提示测试
    - 创建 tests/integration/offlineSmoke.spec.ts：禁用网络完成一次完整练习流程（答题/判定/保存/星星/错题）；mock 写存储抛错验证提示"本次进度可能无法保存"且界面进度可见可继续
    - _Requirements: 10.5, 10.6_

- [x] 17. Final checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties（Property 1-24 全覆盖），均使用 fast-check 且每个属性最少 100 次迭代，注释标签格式为 `**Feature: kids-learning-adventure, Property {n}: {property_text}**`
- Unit tests validate specific examples and edge cases
- 引擎层与数据层为纯函数/可注入依赖实现（时间与随机源参数注入、存储内存 mock 注入），UI 层仅做薄壳接线，避免悬空代码
- 种子题库任务（14.1-14.3）为独立数据文件，可与引擎、UI 任务并行执行；其契约测试 14.4 依赖 2.1 的校验器
- 性能类需求（2 秒出题、1 秒判定/写入、多端真实浏览器验证）以示例断言与人工检查保障，不编写属性测试

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "14.1", "14.2", "14.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "5.1", "9.1", "9.3", "11.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.2", "4.3", "5.2", "9.2", "9.4", "14.4"] },
    { "id": 4, "tasks": ["4.4", "7.1", "7.5", "8.1", "11.2"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.6", "8.2", "11.3"] },
    { "id": 6, "tasks": ["7.4", "12.1", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 7, "tasks": ["12.6", "13.1", "13.2", "13.4", "13.5"] },
    { "id": 8, "tasks": ["13.3", "15.1"] },
    { "id": 9, "tasks": ["13.6", "15.2"] },
    { "id": 10, "tasks": ["16.1"] },
    { "id": 11, "tasks": ["16.2"] }
  ]
}
```
