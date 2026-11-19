# Implementation Plan: child-grade-setting

## Overview

按设计文档在一、二期已落地的 Vue 3 + Vite + TypeScript 工程上增量实施：先实现纯函数模块（Parent_Gate 门禁挑战生成/校验）与 Local_Store 的 childGrade 实体登记（校验器 isChildGrade、初始态 null、损坏备份自愈沿用既有机制），再给 Review_Engine 的 buildTodayQueue 增加可选 childGrade 过滤参数（kpId 年级段解析复用既有 kpIdGrade，fail-closed），然后完成 App_State 接线（childGrade 响应式引用、setChildGrade 立即写入、startAdventure 生成分支传参），最后实现 /parent-settings 路由与页面（家长确认 → 年级选择两步状态机）与首页 Parent_Settings 入口按钮（未设置角标），以集成与升级冒烟测试收尾。实现语言为 TypeScript（设计已给出具体类型签名），测试框架为 Vitest + fast-check（属性测试，每属性最少 100 次迭代）+ @vue/test-utils（组件测试）。

## Tasks

- [x] 1. Parent_Gate 门禁模块（纯函数）
  - [x] 1.1 实现家长确认挑战生成与答案校验
    - 创建 src/engine/parentGate.ts：ParentGateChallenge 类型（a/b/answer，answer 恒等于 a+b）、GATE_OPERAND_MIN=12 与 GATE_OPERAND_MAX=49 常量
    - createParentGateChallenge(rand?)：a、b 为 [12,49] 内整数，answer=a+b，随机源注入（默认 Math.random）
    - checkParentGateAnswer(challenge, input)：输入去除首尾空白后须为十进制整数字符串且数值等于 answer；空串、非数字、错误数值均返回 false
    - _Requirements: 1.2, 1.3_
  - [x]* 1.2 编写属性测试：家长确认挑战生成与校验
    - 创建 tests/property/parentGate.props.spec.ts：任意随机源序列生成的挑战 a、b ∈ [12,49] 且 answer=a+b；正确作答字符串恒通过，任意不等于 answer 的整数输入、空串、非数字字符串恒不通过；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 13: 家长确认挑战生成与校验**`
    - **Property 13: 家长确认挑战生成与校验**
    - **Validates: Requirements 1.2, 1.3**

- [x] 2. Local_Store childGrade 实体登记
  - [x] 2.1 升级 src/data/localStore.ts 新增 childGrade 实体
    - EntityTypeMap 新增 childGrade（number | null，初始态工厂 () => null）
    - 新增并导出校验器 isChildGrade（接受 null 或 1-6 整数；非整数、越界、对象、字符串等视为损坏），isValidEntityValue 分发新增 case 'childGrade'
    - 沿用既有 kla:v1:{accountId}: 键命名空间、损坏备份 backupCorrupted 自愈（会话内不覆盖）、缺失键按初始态返回且不建备份、账号隔离与 LocalStoreWriteError 写失败上报契约
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6_
  - [x]* 2.2 编写属性测试：孩子年级持久化读写往返
    - 创建 tests/property/childGradeStore.props.spec.ts：任意合法 Child_Grade 值（null 或 1-6 整数）写入后再读出相等；以同一底层内存存储创建新适配器实例（模拟关闭浏览器后重开）后读出仍与最后一次成功写入一致；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 8: 孩子年级持久化读写往返**`
    - **Property 8: 孩子年级持久化读写往返**
    - **Validates: Requirements 4.1, 4.3**
  - [x]* 2.3 编写属性测试：缺失数据按未设置启动且无备份
    - 创建 tests/property/childGradeMissing.props.spec.ts：任意不含 childGrade 键的存储读取返回 null，且读取后不产生任何 backup:childGrade 备份键；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 10: 缺失数据按未设置启动且无备份**`
    - **Property 10: 缺失数据按未设置启动且无备份**
    - **Validates: Requirements 4.4**
  - [x]* 2.4 编写属性测试：损坏数据自愈、备份保留且此后可正常写入
    - 创建 tests/property/childGradeCorrupt.props.spec.ts：任意无法解析为合法 Child_Grade 的存储值（非法 JSON 串，或 JSON 合法但值非 null/1-6 整数，如 7、2.5、"3"、{}、[]、true）：读取返回 null；原值复制到独立备份键且同会话内再次读取不覆盖；其他实体键值不受影响；此后写入新合法值仍正常持久化并可读回；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 11: 损坏数据自愈、备份保留且此后可正常写入**`
    - **Property 11: 损坏数据自愈、备份保留且此后可正常写入**
    - **Validates: Requirements 4.5**
  - [x]* 2.5 编写属性测试：孩子年级账号隔离
    - 创建 tests/property/childGradeAccount.props.spec.ts：任意两个不同账号标识 A≠B 与任意合法 Child_Grade 值：A 写入后读 A 相等，读 B 得 null，A 的写入不改变 B 下已存任何值；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 12: 孩子年级账号隔离**`
    - **Property 12: 孩子年级账号隔离**
    - **Validates: Requirements 4.6**

- [x] 3. Review_Engine childGrade 过滤参数
  - [x] 3.1 为 buildTodayQueue 增加可选 childGrade 过滤
    - 修改 src/engine/reviewEngine.ts：新增内部谓词 gradeWithinLimit(grade, childGrade)（childGrade 为 null/undefined 恒 true；grade 为 null 时 fail-closed 排除；否则要求 grade ≤ childGrade）
    - buildTodayQueue 签名追加可选参数 childGrade: number | null = null；过滤施加于候选枚举点：复习段到点记录追加 gradeWithinLimit(kpIdGrade(rec.knowledgePointId), childGrade)；新知识点段题库枚举要求 gradeWithinLimit(q.grade, childGrade)；生成器枚举要求 gradeWithinLimit(g.grade, childGrade)；pickItemForKnowledgePoint 内部取题/取生成器同样施加谓词
    - 其余语义不变：复习段按 nextReviewAt 升序在前、新知识点段在后、各段上限不变；childGrade=null 时输出与既有五参调用完全一致；保持纯函数、不修改入参
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 3.1_
  - [x]* 3.2 编写属性测试：按孩子年级过滤的队列纯净
    - 创建 tests/property/childGradeQueue.props.spec.ts：生成任意 Mastery_Record 集合、题库索引（kpId 按契约形态生成并混入少量畸形 kpId）、生成器集合、now、会话配置与任意 childGrade ∈ 1-6；断言每个 kind='bank' 队列项题目 grade ≤ childGrade、每个 kind='generated' 队列项生成器 grade ≤ childGrade、每个队列项 kpIdGrade 可解析且 ≤ childGrade，且年级超限或不可解析的到点复习知识点不出现在复习段、年级超限的可入队题/生成器知识点不出现在新知识点段；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 1: 按孩子年级过滤的队列纯净**`
    - **Property 1: 按孩子年级过滤的队列纯净**
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [x]* 3.3 编写属性测试：过滤后队列组织规则保持
    - 创建 tests/property/childGradeOrder.props.spec.ts：与 3.2 相同输入域且 childGrade ∈ 1-6，断言复习段按对应记录 nextReviewAt 非递减升序、任意复习段项排在任意新知识点段项之前、复习段项数 ≤ maxReviewPerSession、新知识点段项数 ≤ maxNewPerSession；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 2: 过滤后队列组织规则保持**`
    - **Property 2: 过滤后队列组织规则保持**
    - **Validates: Requirements 2.7**
  - [x]* 3.4 编写属性测试：过滤不修改掌握度记录
    - 创建 tests/property/childGradeReadonly.props.spec.ts：任意 childGrade（含 null 与 1-6）调用 buildTodayQueue 后入参 records 与调用前深相等，题库索引与生成器集合同样不被修改；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 3: 过滤不修改掌握度记录**`
    - **Property 3: 过滤不修改掌握度记录**
    - **Validates: Requirements 2.4**
  - [x]* 3.5 编写属性测试：未设置与既有行为等价
    - 创建 tests/property/childGradeUnset.props.spec.ts：buildTodayQueue(..., generators, null) 输出与既有五参调用深相等，且 buildTodayQueue(..., generators, 6) 输出与未过滤输出深相等；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 4: 未设置与既有行为等价**`
    - **Property 4: 未设置与既有行为等价**
    - **Validates: Requirements 3.1**
  - [x]* 3.6 编写属性测试：过滤单调性与调高再纳入
    - 创建 tests/property/childGradeMonotonic.props.spec.ts：任意两个年级 gLow ≤ gHigh，gLow 队列知识点集合是 gHigh 队列的子集、后者又是未过滤队列的子集；任意年级高于 gLow 而不高于 gHigh 的到点未掌握知识点在 gLow 队列缺席而在 gHigh 队列（有可用题/生成器时）出现于复习段；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 5: 过滤单调性与调高再纳入**`
    - **Property 5: 过滤单调性与调高再纳入**
    - **Validates: Requirements 2.10**
  - [x]* 3.7 编写单元测试：英语排除与既有调用方回归
    - 创建 tests/unit/childGradeFilter.spec.ts：以真实种子题库与生成器调用 buildTodayQueue，childGrade=1 与 2 时输出队列不含任何 subject='english' 队列项，并断言全部英语题目与生成器 grade ≥ 3（Req 2.5，与 multi-grade 契约同口径）；既有五参调用方与一期队列属性测试回归通过（Req 3.1）
    - _Requirements: 2.5, 3.1_

- [x] 4. App_State 接线（childGrade 响应式引用、setChildGrade、startAdventure）
  - [x] 4.1 修改 src/stores/appState.ts 完成接线
    - AppState 接口新增 readonly childGrade: Ref<number | null> 与 setChildGrade(grade: number): void；createAppState 内部以 const childGrade = ref(store.read('childGrade')) 启动恢复（Req 4.3）
    - setChildGrade：非法年级（非 1-6 整数）防御性忽略；合法时同步更新响应式引用并调用 store.write('childGrade', grade) 立即落盘（Req 1.6、1.7、4.1、4.2）；写失败捕获 LocalStoreWriteError 汇入 writeError，内存态保持已选年级可见（Req 4.7）
    - startAdventure 仅在"当日会话需要新生成"分支读取 store.read('childGrade') 并作为第六参传入 buildTodayQueue；当日已生成会话不读、不重建（Req 2.9、3.2、3.3、3.4、3.5）；过滤后两段均空时沿用既有无可用题行为（提示并停留首页，Req 2.6）
    - _Requirements: 1.6, 1.7, 2.6, 2.9, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.7_
  - [x]* 4.2 编写属性测试：设置变更的生效时机
    - 创建 tests/property/childGradeTiming.props.spec.ts：内存存储 + 注入时钟 + 真实种子题库；任意 g1、g2（1-6）、任意当日会话形态（无会话/当日进行中/当日已完成/昨日会话）与任意时钟：setChildGrade(g2) 后——当日会话已存在时再次 startAdventure 不改变已存储会话（进行中续练队列深等于变更前且下一道未完成题不变，已完成返回 done 不重新生成）；当日会话不存在时其后生成的队列每项年级 ≤ g2；时钟推进到下一自然日后生成的队列每项年级 ≤ g2；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 6: 设置变更的生效时机（App_State 接线）**`
    - **Property 6: 设置变更的生效时机（App_State 接线）**
    - **Validates: Requirements 2.9, 3.2, 3.3, 3.4, 3.5**
  - [x]* 4.3 编写属性测试：设置孩子年级不触碰其他实体
    - 创建 tests/property/childGradeIsolation.props.spec.ts：任意存储内容（mastery/wrongSet/wallet/collection/session:today/session:subjects/oralBest/settings/lastGrade 任意合法值组合）与任意 g ∈ 1-6，调用 setChildGrade(g) 后存储中除 childGrade 键外全部键值与调用前逐一深相等；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 7: 设置孩子年级不触碰其他实体**`
    - **Property 7: 设置孩子年级不触碰其他实体**
    - **Validates: Requirements 3.6**
  - [x]* 4.4 编写属性测试：1 秒内写入且最后写入生效
    - 创建 tests/property/childGradeLastWrite.props.spec.ts：任意长度 ≥1 的 1-6 整数变化序列依次调用 setChildGrade 后，Local_Store 读出的 childGrade 恒等于序列最后一个值，且单次变化在调用返回后即可读出（立即写入满足 1 秒时限）；fast-check 最少 100 次迭代，注释标签 `**Feature: child-grade-setting, Property 9: 1 秒内写入且最后写入生效**`
    - **Property 9: 1 秒内写入且最后写入生效**
    - **Validates: Requirements 4.2, 1.7**
  - [x]* 4.5 编写单元测试：启动恢复、写失败与升级保留
    - 创建 tests/unit/childGradeAppState.spec.ts：预置已写 childGrade 的内存存储创建 App_State，childGrade 引用立即恢复为已存值（Req 4.3）；注入 setItem 抛错的存储，setChildGrade 后 writeError 有提示、childGrade 引用保持新值、startAdventure 仍可用（Req 4.7）；构造过滤后两段均空场景（仅高年级内容 + childGrade=1），startAdventure 返回 empty 且首页提示停留（Req 2.6）；存入 childGrade 后学科页年级流程（filterBankForGrade + 五参 buildTodayQueue + session:subjects）输出与存入前完全一致（Req 2.8）；预置一期/二期各实体数据（无 childGrade 键）启动后逐键断言既有数据不变、childGrade 为 null、今日冒险按未设置不过滤生成（Req 4.8、3.1）
    - _Requirements: 2.6, 2.8, 3.1, 4.3, 4.7, 4.8_

- [x] 5. Checkpoint - 纯函数模块、存储实体与 App_State 接线完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. ParentSettingsPage 页面与路由
  - [x] 6.1 新增 /parent-settings 路由与页面（家长确认 → 年级选择）
    - src/router/index.ts 新增路由 { path: '/parent-settings', name: 'parent-settings' }；创建 src/pages/ParentSettingsPage.vue，内部两步状态机 step: 'gate' | 'picker'，初始为 gate
    - gate 步骤：挂载时经 1.1 的 createParentGateChallenge 生成挑战，展示"请家长回答：a + b = ?"、数字输入框、确认/取消按钮，不渲染任何年级选项（Req 1.2）；答错显示"回答不正确，请再试一次"并自动更换新题、停留门禁（Req 1.3）；取消直接 router.push('/')，全程不读写 childGrade（Req 1.3）；checkParentGateAnswer 通过才进入 picker
    - picker 步骤：6 个年级按钮按一年级至六年级固定升序，每个触控区域 ≥44×44px（Req 1.4）；Child_Grade 未设置时全部不选中、显示"还未设置孩子年级"提示且保存按钮禁用（Req 1.5、1.8）；已设置时当前年级按钮带差异化标记（颜色 + ✓ 图标，Req 1.9），可重新选择并保存覆盖原值（Req 1.7）
    - 选择后保存可用；保存调用 4.1 的 setChildGrade 并展示"当前设置：X 年级"与"自明天起的今日冒险生效"说明（Req 1.6、3.5）
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 3.5_
  - [x]* 6.2 编写组件单元测试：ParentSettingsPage 行为
    - 创建 tests/unit/parentSettingsPage.spec.ts：挂载后仅展示门禁、DOM 中无任何年级选项（Req 1.2）；答对进入年级选择；答错显示错误提示、更换新题、停留门禁且 childGrade 存储不变（Req 1.3）；取消返回首页且存储不变（Req 1.3）；6 个年级按钮升序且每个触控区域 ≥44×44px（Req 1.4）；未设置时全部未选中、保存禁用且显示未设置提示（Req 1.5、1.8）；已设置时当前年级按钮差异化标记（参数化抽查若干年级，Req 1.9）；选择保存后存储值与"当前设置"展示一致并展示"自明天起生效"说明（Req 1.6、3.5）；已设置后重新选择保存覆盖原值（Req 1.7）
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 3.5_

- [x] 7. 首页 Parent_Settings 入口按钮
  - [x] 7.1 改造 src/pages/HomePage.vue 新增家长入口
    - 顶栏右侧（音效开关旁）新增 Parent_Settings 入口按钮（👨‍👩‍👧 图标 + "家长"文字，触控区域 ≥44×44px，Req 1.1）
    - Child_Grade 未设置时按钮带可见未设置标记（红点/角标，Req 1.8），已设置后不显示
    - 点击仅 router.push('/parent-settings')，不启动任何练习；"今日冒险"大按钮保持首页唯一练习入口，其余区块（学科入口、宝箱小岛、庆祝层、提示条）不变
    - _Requirements: 1.1, 1.8_
  - [x]* 7.2 编写单元测试：首页入口行为与回归
    - 修改 tests/unit/pages.spec.ts 追加：Parent_Settings 入口按钮存在且触控区域 ≥44×44px（Req 1.1）；点击入口仅导航 /parent-settings、不调用 startAdventure，"今日冒险"仍是唯一练习入口（Req 1.1）；childGrade 未设置时入口显示未设置标记、已设置后不显示（Req 1.8）
    - _Requirements: 1.1, 1.8_

- [x] 8. 集成与冒烟测试
  - [x]* 8.1 编写家长设置主链路集成测试
    - 创建 tests/integration/childGradeFlow.spec.ts（jsdom + 内存 localStorage）：首页点击 Parent_Settings 入口 → 完成家长确认 → 选择三年级保存 → 首页入口未设置标记消失 → 注入时钟推进到次日 → 今日冒险队列各项年级 ≤ 3 → 关闭重开（新 App_State 实例）后设置仍生效
    - _Requirements: 1.1, 1.2, 1.6, 1.8, 2.1, 3.5, 4.3_
  - [x]* 8.2 编写当日不受扰链路集成测试
    - 创建 tests/integration/sameDayUndisturbed.spec.ts（jsdom + 内存 localStorage + 注入时钟）：当日生成并作答部分题目 → 家长修改年级 → 当日续练队列与下一道未完成题不变（年级超限项仍保留可作答）→ 时钟推进到次日 → 新队列按新年级过滤
    - _Requirements: 2.9, 3.3, 3.5_
  - [x]* 8.3 编写升级冒烟测试
    - 创建 tests/integration/childGradeUpgradeSmoke.spec.ts：预置一期/二期格式全部实体（mastery/wrongSet/wallet/collection/session:today/session:subjects/oralBest/settings/lastGrade，无 childGrade 键）→ 启动 → 既有数据逐键不变、错题集/星星/掌握度可见、childGrade 为 null 且今日冒险按未设置不过滤生成
    - _Requirements: 3.1, 4.4, 4.8_

- [x] 9. Final checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties（设计 Property 1-13 全覆盖），均使用 fast-check 且每个属性最少 100 次迭代，注释标签格式为 `**Feature: child-grade-setting, Property {n}: {property_text}**`
- Unit tests validate specific examples and edge cases（英语排除示例、过滤后无可用题、学科页不受扰、启动恢复、写失败、升级保留、页面组件行为等不以属性覆盖的需求）
- 新增纯函数模块 parentGate 时间与随机源参数注入、存储经内存 mock 注入，UI 层仅做薄壳接线，避免悬空代码
- 3.1 的过滤内置于 buildTodayQueue 可选参数（默认 null），未设置时与既有代码路径逐字节一致，一期既有调用方与测试（Property 7/8/9/24）不受影响
- 4.1 的 setChildGrade 采用立即写入（store.write）而非调度写入（store.schedule），消除"设置后当日首次生成读到旧值"的窗口；"1 秒内写入"与"多次变化取最后值"由立即写入平凡成立
- 属性测试生成器约定：kpId 按 {cn|math|en}.g{N}.{后缀} 形态生成（N ∈ 1-6），按种子契约使题目 grade、生成器 grade 与 kpId 年级段一致，并混入少量畸形 kpId（缺年级段、N 越界、无前缀）覆盖 fail-closed 分支
- 入口与选项触控尺寸（≥44×44px）、标记/角标视觉差异、未设置提示文案、门禁步骤 DOM 切换、导航跳转、"2 秒内恢复"时延阈值等不编写属性测试，按设计以组件示例测试与集成冒烟覆盖
- 学科入口页 Grade_Selector 先选年级再练习流程与 Child_Grade 完全正交（Req 2.8），本期不改名、不改签名、不改行为

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "2.4", "2.5", "3.7", "4.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 3, "tasks": ["6.1", "7.1"] },
    { "id": 4, "tasks": ["6.2", "7.2"] },
    { "id": 5, "tasks": ["8.1", "8.2", "8.3"] }
  ]
}
```
