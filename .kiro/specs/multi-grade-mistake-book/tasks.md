# Implementation Plan: multi-grade-mistake-book

## Overview

按设计文档在一期 Vue 3 + Vite + TypeScript 工程上增量实施：先实现纯函数模块（年级配置、题库年级过滤与组合会话键、Wrong_Set v2 记录模块、v1→v2 迁移模块），再升级 Local_Store 适配器（新增 lastGrade 与 session:subjects 实体、wrongSet 同键原地升级）并切换 PracticePage 错题记账（修复 appendWrongSet 重复入账），然后扩充一至六年级种子题库并接入聚合加载，最后改造学科入口页（Grade_Selector）、练习页学科年级流程、新增错题集查看页与小岛入口，以集成与升级冒烟测试收尾。种子题库为独立数据文件，可与纯函数模块并行执行。实现语言为 TypeScript（设计已给出具体类型签名），测试框架为 Vitest + fast-check（属性测试，每属性最少 100 次迭代）+ @vue/test-utils（组件测试）。

## Tasks

- [x] 1. 年级配置模块（Grade_Selector 纯函数）
  - [x] 1.1 实现年级选项与 Last_Grade 标记计算
    - 创建 src/engine/gradeSelector.ts：SUBJECT_GRADES 常量（chinese/math 为 [1,2,3,4,5,6]，english 为 [3,4,5,6]）、LastGrade 类型（Partial<Record<Subject, number>>）
    - gradeOptionsFor(subject)：返回学科可选年级升序列表（与 SUBJECT_GRADES 一致）
    - markedGrade(lastGrade, subject)：该学科 Last_Grade 记录属于本学科可选年级时返回该年级，否则返回 null（含空 Last_Grade 与越界年级形态）
    - _Requirements: 1.1, 1.2, 1.5, 1.6_
  - [ ]* 1.2 编写属性测试：年级选项配置
    - 创建 tests/property/gradeOptions.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 1: 年级选项配置**`
    - **Property 1: 年级选项配置**
    - **Validates: Requirements 1.1, 1.2**
  - [ ]* 1.3 编写属性测试：Last_Grade 标记唯一性
    - 创建 tests/property/markedGrade.props.spec.ts，生成任意 Last_Grade 形态（含缺失学科、越界年级、无关键），fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 2: Last_Grade 标记唯一性**`
    - **Property 2: Last_Grade 标记唯一性**
    - **Validates: Requirements 1.5, 1.6**

- [x] 2. 题库年级过滤与组合会话键（纯函数）
  - [x] 2.1 实现按学科+年级过滤、kpId 解析与组合会话更新
    - src/data/questionBank.ts 追加 filterBankForGrade(index, subject, grade)（结果中每道题 subject 与 grade 均等于入参）与 filterGeneratorsForGrade(generators, grade)
    - 创建 src/engine/kpId.ts：kpIdSubject（cn→chinese、math→math、en→english，无法识别返回 null）、kpIdGrade（解析第二段 g{N}，无法解析返回 null）
    - 创建 src/engine/subjectSession.ts：SubjectGradeKey 类型（"{subject}:{grade}"）、subjectGradeKey(subject, grade)、saveSubjectSession(all, key, session)（写入 key 对应会话，其余组合键逐值保持不变）
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]* 2.2 编写属性测试：年级练习队列纯净
    - 创建 tests/property/gradeQueue.props.spec.ts：过滤后调用既有 buildTodayQueue，断言每个 kind='bank' 队列项题目 subject=s 且 grade=g、每个 kind='generated' 队列项生成器参数 grade=g、无可用题时输出空队列；fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 4: 年级练习队列纯净**`
    - **Property 4: 年级练习队列纯净**
    - **Validates: Requirements 3.1**
  - [ ]* 2.3 编写属性测试：掌握度跨标识更新隔离
    - 创建 tests/property/masteryIsolation.props.spec.ts：对标识 A 应用 applyAnswer 写回后任意 B≠A 的记录与更新前完全相等；kpIdGrade 解析结果唯一且不同年级段标识互不相等；fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 5: 掌握度跨标识更新隔离**`
    - **Property 5: 掌握度跨标识更新隔离**
    - **Validates: Requirements 3.2**
  - [ ]* 2.4 编写属性测试：组合会话独立保存
    - 创建 tests/property/subjectSessions.props.spec.ts：saveSubjectSession 写入 K1 后 K2≠K1 及其余键逐值不变，且映射经 Local_Store session:subjects 实体写入再读出后与写入前等价（依赖 5.1 的实体与 isSubjectSessionMap 校验器）；fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 6: 组合会话独立保存**`
    - **Property 6: 组合会话独立保存**
    - **Validates: Requirements 3.3**

- [x] 3. Wrong_Set v2 记录模块（纯函数）
  - [x] 3.1 实现错题记录、派生状态、分组与重练定盘
    - 创建 src/engine/wrongSet.ts：v2 类型（WrongSetItem 含 questionRef/subject/grade/knowledgePointId/wrongAt/wrongCount/generated?，GeneratedSnapshot 含 paramsId/stem/operands/answer，FirstWrongEntry）
    - recordFirstWrong（questionRef 不存在则追加 wrongAt=now、wrongCount=1 的新记录；已存在则更新 wrongAt=now、wrongCount+1，不新增记录）
    - applyRetryToWrongSet（恒等：无论重试答对或答错均原样返回集合）
    - isMasteredWrong（派生：mastery[knowledgePointId]?.mastered ?? false）、unmasteredCount（未掌握条数，空集合为 0）
    - buildWrongSetGroups（学科按 chinese→math→english 固定序、空分组不出现、组内按 wrongAt 降序、全部错题恰好出现一次）、formatWrongAt（本地时区 'YYYY-MM-DD HH:mm'）
    - applyReAnswerCorrect（掌握度写回复用既有 applyAnswer(rec, true, now)，Wrong_Set 不变）、applyReAnswerWrong（applyAnswer(rec, false, now) 重置未掌握，该题 wrongAt=now、wrongCount+1，不新增记录）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.8, 5.9_
  - [ ]* 3.2 编写属性测试：首错入账建档
    - 创建 tests/property/firstWrongCreate.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 7: 首错入账建档**`
    - **Property 7: 首错入账建档**
    - **Validates: Requirements 4.1, 4.2, 3.5**
  - [ ]* 3.3 编写属性测试：重复首错更新不重复
    - 创建 tests/property/firstWrongDedup.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 8: 重复首错更新不重复**`
    - **Property 8: 重复首错更新不重复**
    - **Validates: Requirements 4.3**
  - [ ]* 3.4 编写属性测试：重试不改错题集
    - 创建 tests/property/retryIdentity.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 9: 重试不改错题集**`
    - **Property 9: 重试不改错题集**
    - **Validates: Requirements 4.4, 4.5**
  - [ ]* 3.5 编写属性测试：已掌握派生标记与未掌握计数
    - 创建 tests/property/masteredWrong.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 10: 已掌握派生标记与未掌握计数**`
    - **Property 10: 已掌握派生标记与未掌握计数**
    - **Validates: Requirements 4.6, 5.1**
  - [ ]* 3.6 编写属性测试：错题分组与排序
    - 创建 tests/property/wrongSetGroups.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 11: 错题分组与排序**`
    - **Property 11: 错题分组与排序**
    - **Validates: Requirements 5.2**
  - [ ]* 3.7 编写属性测试：答错时间显示格式
    - 创建 tests/property/formatWrongAt.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 12: 答错时间显示格式**`
    - **Property 12: 答错时间显示格式**
    - **Validates: Requirements 5.3**
  - [ ]* 3.8 编写属性测试：重练判定与闯关一致
    - 创建 tests/property/reanswerJudge.props.spec.ts：同一题同一作答的重练判定与既有 judgeQuestion/judgeGenerated 结果完全一致；fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 13: 重练判定与闯关一致**`
    - **Property 13: 重练判定与闯关一致**
    - **Validates: Requirements 5.5**
  - [ ]* 3.9 编写属性测试：重练答对掌握度更新
    - 创建 tests/property/reanswerCorrect.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 14: 重练答对掌握度更新**`
    - **Property 14: 重练答对掌握度更新**
    - **Validates: Requirements 5.8**
  - [ ]* 3.10 编写属性测试：重练答错定盘
    - 创建 tests/property/reanswerWrong.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 15: 重练答错定盘**`
    - **Property 15: 重练答错定盘**
    - **Validates: Requirements 5.9**

- [x] 4. Wrong_Set v1→v2 迁移模块（纯函数）
  - [x] 4.1 实现 migrateWrongSetV1 形状检测与迁移
    - 创建 src/engine/wrongSetMigration.ts：形状检测（任一元素缺 wrongCount 即视为旧版数据）；学科/年级推导顺序 kpId 推导（2.1 的 kpIdSubject/kpIdGrade）→ 题库 byId 查找 → 生成器参数查找（gen: 引用）
    - 同一 questionRef 多条旧记录合并为一条：wrongCount=合并条数、wrongAt=各条最大值；无法推导学科或年级的元素丢弃并记迁移日志；已是 v2 形状时原样返回（migrated=false）
    - _Requirements: 6.6_
  - [ ]* 4.2 编写属性测试：Wrong_Set v1→v2 迁移不变量
    - 创建 tests/property/wrongSetMigration.props.spec.ts，生成任意 v1 形状 wrongSet（含重复引用与无法推导元素），fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 19: Wrong_Set v1→v2 迁移不变量**`
    - **Property 19: Wrong_Set v1→v2 迁移不变量**
    - **Validates: Requirements 6.6**

- [x] 5. Local_Store 扩充与练习页错题记账切换
  - [x] 5.1 升级 src/data/localStore.ts（新实体与 wrongSet 同键原地升级）
    - EntityTypeMap 新增 lastGrade（LastGrade，初始态 {}）与 session:subjects（Record<SubjectGradeKey, TodaySession>，初始态 {}）；wrongSet 实体类型切换为 3.1 的 v2 WrongSet（保留 WrongSetItem 再导出以兼容既有 import）
    - 新增校验器 isLastGrade（键限三学科、值为 1-6 整数）、isWrongSetV2（必需字段齐全且合法，generated 可选但存在时须结构合法）、isSubjectSessionMap（键符合 {subject}:{grade}、值过 isTodaySession）
    - read('wrongSet') 在 JSON 解析成功后做形状检测：v1 形状调用 4.1 的 migrateWrongSetV1 迁移并调度写回 v2 后返回（Req 6.6 优先于备份重置）；仅当既非 v2 亦非可识别 v1 形状时才走既有备份自愈；迁移只读写 wrongSet 键，其余实体读取行为不变
    - 新实体沿用 kla:v1:{accountId}: 键命名空间、1 秒 schedule 落盘与 LocalStoreWriteError 写失败上报契约
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [x] 5.2 切换 PracticePage.vue 错题记账（修复 appendWrongSet 重复入账）
    - 删除追加式 appendWrongSet；首错定盘改调 3.1 的 recordFirstWrong（FirstWrongEntry 由当前题快照构造；口算生成题携带 GeneratedSnapshot：paramsId/stem/operands/answer）
    - 重试定盘（重对与重错）改调 applyRetryToWrongSet（恒等，不再向 Wrong_Set 追加任何记录），修复一期同一题被重复添加的问题
    - 其余掌握度记账（applyAnswer）、会话保存与 1 秒落盘口径不变
    - _Requirements: 3.5, 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 5.3 编写属性测试：扩充实体存储读写往返
    - 创建 tests/property/storeRoundTripV2.props.spec.ts（内存 mock localStorage；模拟关闭重开以同一底层存储创建新适配器实例），fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 16: 扩充实体存储读写往返**`
    - **Property 16: 扩充实体存储读写往返**
    - **Validates: Requirements 6.1, 6.3**
  - [ ]* 5.4 编写属性测试：缺失数据初始态且无备份
    - 创建 tests/property/storeMissingV2.props.spec.ts，fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 17: 缺失数据初始态且无备份**`
    - **Property 17: 缺失数据初始态且无备份**
    - **Validates: Requirements 6.4**
  - [ ]* 5.5 编写属性测试：损坏数据自愈与备份保留
    - 创建 tests/property/storeCorruptV2.props.spec.ts（任意无法解析为合法 v2 亦非可识别 v1 形状的存储值），fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 18: 损坏数据自愈与备份保留**`
    - **Property 18: 损坏数据自愈与备份保留**
    - **Validates: Requirements 6.5**
  - [ ]* 5.6 编写属性测试：扩充实体账号隔离
    - 创建 tests/property/storeAccountV2.props.spec.ts（任意账号标识 A≠B），fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 20: 扩充实体账号隔离**`
    - **Property 20: 扩充实体账号隔离**
    - **Validates: Requirements 6.7**
  - [ ]* 5.7 编写单元测试：持久化时机、写失败与升级回归
    - 创建 tests/unit/persistenceUpgrade.spec.ts：fake timers 验证 lastGrade/wrongSet 变化经 schedule 在 1 秒内落盘（Req 6.2）、重开后 2 秒内恢复且与最后一次成功写入一致（Req 6.3）；mock 写抛错验证提示"本次进度可能无法保存"且不阻断练习（Req 6.8）
    - 升级回归：预置一期各实体数据（mastery/wallet/collection/session:today/oralBest/settings）与 v1 wrongSet，启动迁移后逐键断言既有值不变（余额与累计不变、收藏不变、掌握度不变），v1 错题迁移后仍保留可查（Req 6.6）
    - _Requirements: 6.2, 6.3, 6.6, 6.8_

- [x] 6. Checkpoint - 纯函数模块与存储层完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 种子题库扩充（一至六年级）
  - [x] 7.1 编写语文新增年级种子
    - 创建 src/data/seed/questions-chinese-g1.json、-g2.json、-g5.json、-g6.json：人教版按年级/册/单元组织，每个文件对应年级上册（volume=A）与下册（volume=B）均至少 1 题，每文件通过 validateQuestion 的题目 ≥20 道，题型限一期已定义枚举，kpId 形如 cn.g{N}.{zi|ci|cy|shi}.{序号} 且年级段等于 grade 字段，题 id 沿用 cn-g{N}{a|b}-u{单元}-{类型}-{序号} 且与既有 id 不冲突
    - _Requirements: 2.1, 2.5, 2.6_
  - [x] 7.2 编写数学新增年级种子与口算生成器参数
    - 创建 src/data/seed/questions-math-g{1,2,5,6}.json（每个年级上下册各 ≥1 题、每文件过校验 ≥20 道，kpId 形如 math.g{N}.{主题}[.{子主题}]）与 src/data/seed/generators-math-g{1,2,5,6}.json（GeneratorParams 含 operation 与 constraints，grade 字段与 kpId 年级段一致）
    - _Requirements: 2.2, 2.5, 2.6_
  - [x] 7.3 编写英语新增年级种子
    - 创建 src/data/seed/questions-english-g5.json、-g6.json：外研版（三年级起点）按年级/册/Module 组织，每个年级上下册各 ≥1 题、每文件过校验 ≥20 道，kpId 形如 en.g{N}.{类别}.{序号}；媒体引用沿用既有目录约定（音频 public/audio/en/g{N}/、图片 public/img/en/g{N}/），媒体行为规则与三四年级一致
    - _Requirements: 2.3, 2.5, 2.6, 2.8_
  - [ ]* 7.4 扩展种子契约测试
    - 修改 tests/unit/seedContract.spec.ts 追加：语文/数学 1-6 年级、英语 3-6 年级每年级上下册各 ≥1 题（Req 2.1-2.3）；每学科每年级过校验题数 ≥20（Req 2.6）；全部新种子题过 validateQuestion 且题型限一期枚举（Req 2.5）；每道种子题与每个生成器的 kpId 年级段等于其 grade 字段（Req 3.2 契约）；现有三、四年级种子题目 id 集合与各题字段逐值不变（Req 2.4，快照比对）；新增题 id 与既有 id 无冲突
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2_

- [x] 8. 题库聚合加载升级
  - [x] 8.1 改造 loadSeedBank 聚合全部种子文件
    - 修改 src/stores/appState.ts：loadSeedBank 聚合 7.x 新增的全部题目文件与生成器文件（含既有三、四年级文件，其内容不变），统一 loadQuestionBank + buildQuestionIndex；单题校验失败跳过并记错误日志、整体失败 fatal 的一期行为不变
    - _Requirements: 2.7_
  - [ ]* 8.2 编写属性测试：扩充题库校验过滤
    - 创建 tests/property/bankExpansion.props.spec.ts：合法与非法题任意混合（含各年级扩充题），载入数 + 错误数 = 总数，全部合法题可按学科/年级/单元索引检索到；fast-check 最少 100 次迭代，注释标签 `**Feature: multi-grade-mistake-book, Property 3: 扩充题库校验过滤**`
    - **Property 3: 扩充题库校验过滤**
    - **Validates: Requirements 2.7**

- [x] 9. 学科入口页 Grade_Selector 改造
  - [x] 9.1 改造 src/pages/SubjectPage.vue 为年级选择流程
    - 英雄区下方展示年级网格：语文/数学 6 个、英语 4 个年级按钮（接 1.1 的 gradeOptionsFor，升序，触控区域 ≥44×44px）；保留主题吉祥物/口号/星星余额/题库 fatal 处理
    - 读取 lastGrade 实体并以 1.1 的 markedGrade 计算标记：对应按钮显示"上次 ⭐"标记与差异化配色，其余按钮样式一致，至多标记一个；无 Last_Grade 时全部按钮样式一致且无任何标记
    - 点击年级按钮：schedule 写入 lastGrade（1 秒内落盘）→ 读取 session:subjects["{subject}:{grade}"] → 今日已完成展示庆祝画面 / 有未答题进入续练 / 否则经 2.1 的 filterBankForGrade + filterGeneratorsForGrade 过滤后调用既有 buildTodayQueue 生成新会话并写入组合键 → 导航 /practice?subject={s}&grade={g}
    - 队列为空（该年级无可用题）时提示"该年级暂无可用题目"并停留在 Grade_Selector，不进入练习界面（Req 3.4）
    - 移除独立"开始冒险"按钮，除年级外不要求其他前置选择；首页"今日冒险"入口不在本页改动范围
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.3, 3.4_
  - [ ]* 9.2 编写单元测试：Grade_Selector 页面行为
    - 创建 tests/unit/gradeSelectorPage.spec.ts：语文/数学渲染 6 个升序按钮、英语渲染 4 个且无一二年级（Req 1.1、1.2）；按钮触控区域 ≥44×44px（Req 1.4）；Last_Grade 按钮差异化标记且其余一致（Req 1.5）；无 Last_Grade 无任何标记（Req 1.6）；点击年级写入 lastGrade 并导航 /practice?subject&grade（Req 1.3）；构造无题年级显示"暂无可用题目"提示且不跳转（Req 3.4）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.4_
  - [ ]* 9.3 编写首页回归测试
    - 修改 tests/unit/pages.spec.ts 追加：首页仍仅"今日冒险"一个练习入口、点击行为与一期一致（读写 session:today）、页面无 Grade_Selector（Req 1.7）
    - _Requirements: 1.7_

- [x] 10. 练习页学科年级流程
  - [x] 10.1 PracticePage.vue 支持 ?subject=&grade= 参数
    - 带参数进入学科年级流程：会话读写 session:subjects 对应组合键（经 2.1 的 subjectGradeKey/saveSubjectSession），题目解析仍走既有题库索引；中途退出/休息按组合键保存进度（与一期 Req 2.4 同一机制）
    - 年级不属于该学科可选范围（非法学科/年级组合）时回退到对应学科入口页
    - 不带参数时为"今日冒险"流程，读写 session:today，行为与一期完全一致
    - _Requirements: 1.3, 3.1, 3.3_
  - [ ]* 10.2 编写单元测试：学科年级会话隔离与回归
    - 创建 tests/unit/practiceSubjectGrade.spec.ts：不同学科年级组合的进度相互独立（写 K1 不覆盖 K2）、无参数时行为与一期一致、非法参数回退学科入口页
    - _Requirements: 3.3_

- [x] 11. Checkpoint - 年级选择与学科练习流程完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 错题集查看页与小岛入口
  - [x] 12.1 新增路由与 Wrong_Set_View 页面
    - src/router/index.ts 新增路由 { path: '/island/wrong', name: 'wrong-set' }；创建 src/pages/WrongSetPage.vue
    - 分组列表经 3.1 的 buildWrongSetGroups 构建：学科按 语文→数学→英语 固定顺序、空分组不显示、组内按最近一次答错时间由近到远；每条展示题干、学科、年级、formatWrongAt 格式化时间与"已掌握/未掌握"文字标识（Req 5.2、5.3）
    - 点击条目弹出详情层展示正确答案与 ≤100 字解析（Req 5.4）
    - 未掌握错题提供"重新作答"：题库题经 bank.byId 取原题按 type 复用 ChoicePad/DragMatch/NumericKeypad/WordCard/DictationCard 并以既有 judgeQuestion 判定；口算生成题优先以错题记录 generated 快照还原原题（NumericKeypad + judgeGenerated），无快照的历史生成题错题降级为按 paramsId 取生成器参数重新生成一题（mock 随机源可测）；不提供 Hint 与重试，一次提交定盘：答对走 applyReAnswerCorrect、答错走 applyReAnswerWrong（Req 5.5、5.8、5.9）；已掌握错题仅可查看答案解析，不提供重新作答（Req 4.6）
    - Wrong_Set 为空时展示空状态提示与"去闯关"引导入口（Req 5.6）；错题引用在题库中找不到时展示"题目已下架"兜底文案且不提供重新作答，记录保留
    - 重练与列表的媒体行为（自动播放一次、重听/重播不限次、失败降级提示且不影响作答）与闯关练习一致（Req 2.8）
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 2.8, 4.6_
  - [x] 12.2 改造 src/pages/IslandPage.vue 增加错题集入口
    - 顶部新增"📖 错题集"入口卡，入口旁徽标经 3.1 的 unmasteredCount 展示未掌握错题数量（0 时显示 0，Req 5.1）；点击导航 /island/wrong
    - 保留 Island_Collection 宠物/装扮展示与"已收集 N/12"计数不变，与收藏数据同一刷新机制（轮询 + storage 事件）（Req 5.7）
    - _Requirements: 5.1, 5.7_
  - [ ]* 12.3 编写组件单元测试：错题集页与小岛入口
    - 创建 tests/unit/wrongSetView.spec.ts：空集合空状态与"去闯关"引导（Req 5.6）；列表项展示题干/学科/年级/格式化时间与掌握文字标识（Req 5.3）；点击条目详情层展示答案与 ≤100 字解析（Req 5.4）；已掌握条目不提供重新作答；错题引用缺失时兜底文案且不可重练；小岛入口徽标数字与未掌握计数一致（0 显示 0，Req 5.1）且宠物/装扮展示与 N/12 计数不变（Req 5.7）；mock Audio_Service 验证媒体失败提示且可作答、生成题快照还原与无快照降级重新生成（Req 2.8）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 2.8_

- [ ] 13. 集成与冒烟测试
  - [ ]* 13.1 编写端到端主链路集成测试
    - 创建 tests/integration/multiGradeFlow.spec.ts（jsdom + 内存 localStorage）：进入学科页 → 选年级 → 答完全部题（含首错）→ 错题按首错规则入账 → 小岛查看错题集徽标计数 → 打开错题集分组列表 → 查看答案解析 → 重练答对（掌握度递进、条目仍在集合中）→ 关闭重开恢复 Last_Grade 与 Wrong_Set
    - _Requirements: 1.3, 3.1, 3.3, 3.5, 4.1, 5.1, 5.2, 5.5, 5.8, 6.1, 6.3_
  - [ ]* 13.2 编写升级冒烟测试
    - 创建 tests/integration/upgradeSmoke.spec.ts：以一期格式预置 localStorage（v1 wrongSet + mastery/wallet/collection/session:today/oralBest/settings）→ 启动 → 旧错题仍可在 Wrong_Set_View 查看，星星余额与累计、收藏、掌握度逐键不变（Req 6.6）
    - _Requirements: 6.6_

- [x] 14. Final checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties（设计 Property 1-20 全覆盖），均使用 fast-check 且每个属性最少 100 次迭代，注释标签格式为 `**Feature: multi-grade-mistake-book, Property {n}: {property_text}**`
- Unit tests validate specific examples and edge cases（Grade_Selector 页面行为、种子契约、持久化时机与升级回归、错题集页组件行为等不以属性覆盖的需求）
- 新增纯函数模块（gradeSelector/kpId/subjectSession/wrongSet/wrongSetMigration）时间与随机源参数注入、存储经内存 mock 注入，UI 层仅做薄壳接线，避免悬空代码
- 种子题库任务（7.1-7.3）为独立数据文件，可与纯函数模块任务并行执行；其契约测试 7.4 依赖 7.1-7.3 与既有 validateQuestion
- 现有 4 个种子文件（questions-chinese/math/english.json、generators-math.json）内容不变（Req 2.4），由 7.4 快照比对强制
- 5.1 将 wrongSet 实体切换为 v2 类型后，PracticePage 旧 appendWrongSet 在 5.2 完成前处于过渡状态（写入的 v1 形状数据会被迁移钩子识别处理）；5.2 完成后首错去重与重试恒等语义生效
- 2.4 的组合会话存储往返依赖 5.1 的 session:subjects 实体与校验器，故安排在 5.1 之后执行
- 年级按钮触控尺寸、标记视觉差异、媒体播放行为、1 秒/2 秒时延阈值、多端布局适配等不编写属性测试，按设计以示例测试、契约断言与冒烟测试覆盖

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "7.1", "7.2", "7.3"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "7.4", "8.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1", "8.2"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["2.4", "5.2", "5.3", "5.4", "5.5", "5.6", "9.1"] },
    { "id": 5, "tasks": ["5.7", "9.2", "9.3", "10.1"] },
    { "id": 6, "tasks": ["10.2", "12.1"] },
    { "id": 7, "tasks": ["12.2"] },
    { "id": 8, "tasks": ["12.3"] },
    { "id": 9, "tasks": ["13.1", "13.2"] }
  ]
}
```
