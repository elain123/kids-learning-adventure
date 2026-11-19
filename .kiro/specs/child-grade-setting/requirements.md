# Requirements Document

## Introduction

本规格是"趣味学习冒险"（kids-learning-adventure）的功能扩充规格，基于现有规格 kids-learning-adventure（见 .kiro/specs/kids-learning-adventure/）与 multi-grade-mistake-book（见 .kiro/specs/multi-grade-mistake-book/）定义"孩子年级"全局设置功能。

题库经 multi-grade-mistake-book 扩充至一至六年级后，首页"今日冒险"的每日练习队列从全部年级（一至六年级）的题库内容中出题，未按孩子所在年级过滤，低年级孩子会混入高年级内容。本规格新增由家长设置一次的全局"孩子年级"（Child_Grade），使"今日冒险"仅出年级属性小于或等于 Child_Grade 的题目（涵盖全部学科，并尊重各学科自身的可用年级范围，例如英语为三年级起点、无一二年级内容）。

本规格不改变学科入口页"先选年级再练习"的精确年级流程（multi-grade-mistake-book Requirement 1、3），不改变艾宾浩斯间隔重复规则、错题集记录与查看规则、星星与宝箱规则及媒体行为规则。除本规格明确修改的部分外，现有规格的全部约束继续有效。

## Glossary

沿用现有规格 kids-learning-adventure 与 multi-grade-mistake-book 的术语定义：

- **Learning_System（学习系统）**: 本趣味学习记忆系统整体，网页版 H5 应用
- **Adventure_Engine（冒险引擎）**: 负责组织练习内容、编排题目顺序的模块
- **Review_Engine（复习引擎）**: 基于艾宾浩斯间隔重复算法安排题目复习时机的模块，负责生成今日冒险练习队列
- **Question_Bank（题库）**: 以结构化 JSON 组织的题目数据集合，按学科/年级/单元/题型分类，每道题目具有年级属性（一至六年级整数）
- **Mastery_Record（掌握度记录）**: 记录每个知识点答题历史与复习间隔的数据，知识点标识由学科、年级与知识点唯一组合而成
- **Today_Session（今日会话）**: 今日冒险当日的练习会话，包含当日练习队列与作答进度
- **Grade_Selector（年级选择页）**: 学科入口页内展示可选年级列表、供学生选择练习年级的界面
- **Local_Store（本地存储）**: 浏览器 localStorage 持久化存储
- **外研版**: 外语教学与研究出版社小学英语教材版本（三年级起点）

本规格新增术语：

- **Child_Grade（孩子年级）**: 家长为孩子设置的全局年级，取值为一年级至六年级的单一整数，不按学科区分；未设置时不参与今日冒险出题过滤
- **Parent_Settings（家长设置）**: 首页的家长入口及进入后的孩子年级设置界面
- **家长确认**: 进入 Parent_Settings 前需完成的确认步骤，用于防止孩子误触修改设置

## Requirements

### Requirement 1: 家长设置入口与孩子年级设置

**User Story:** 作为一名家长，我希望能在首页的家长入口里为孩子设置一次所在年级，这样孩子每天练的内容不会超出他的年级。

#### Acceptance Criteria

1. THE Learning_System SHALL 在首页提供可见的 Parent_Settings 入口，该入口触控区域不小于 44×44 像素；首页"今日冒险"大按钮保持为首页唯一练习入口，点击 Parent_Settings 入口不得直接启动任何练习
2. WHEN 任何人点击 Parent_Settings 入口，THE Learning_System SHALL 先展示家长确认步骤，且仅在该家长确认步骤完成后才展示孩子年级设置界面，家长确认步骤完成前不得展示孩子年级设置界面中的任何年级选项
3. IF 家长确认步骤被取消或未通过，THEN THE Learning_System SHALL 不展示孩子年级设置界面并使界面停留在或返回首页，且 Local_Store 中已存储的 Child_Grade 保持不变
4. WHEN 家长完成家长确认步骤进入孩子年级设置界面，THE Learning_System SHALL 按一年级至六年级的升序展示共 6 个可点击的年级选项，每个年级选项的触控区域不小于 44×44 像素
5. IF Child_Grade 从未设置且家长进入孩子年级设置界面，THEN THE Learning_System SHALL 使全部 6 个年级选项均处于未选中状态，且在家长选择任一年级选项前不提供可触发的保存确认操作
6. WHEN 家长在年级选项中选择一个年级并确认保存，THE Learning_System SHALL 将所选年级作为 Child_Grade 持久化至 Local_Store，并在孩子年级设置界面展示当前已设置的 Child_Grade
7. WHEN Child_Grade 已设置后家长再次完成家长确认步骤进入孩子年级设置界面，THE Learning_System SHALL 允许家长重新选择年级并保存，使 Child_Grade 更新为新选择的年级并覆盖原值
8. IF Child_Grade 从未设置，THEN THE Learning_System SHALL 在 Parent_Settings 入口或孩子年级设置界面展示可见的未设置状态提示，引导家长完成设置
9. WHEN 孩子年级设置界面展示年级选项且 Child_Grade 已设置，THE Learning_System SHALL 在 Child_Grade 对应的年级选项上显示与其余年级选项可见区分的标记（颜色或图标存在可见差异）

### Requirement 2: 今日冒险按孩子年级过滤出题

**User Story:** 作为一名家长，我希望设置好孩子年级后，今日冒险只出不超过孩子年级的题，这样孩子不会遇到还没学过的内容。

#### Acceptance Criteria

1. WHEN Child_Grade 已设置为 1 至 6 的整数且 Review_Engine 生成今日冒险练习队列，THE Review_Engine SHALL 仅从年级不大于 Child_Grade 的内容中选取队列项：题目的数值年级属性（grade）不大于 Child_Grade，口算生成器的年级参数不大于 Child_Grade，知识点的年级（按 knowledgePointId 的年级段解析，例如 "cn.g5.zi.001" 解析为 5）不大于 Child_Grade
2. WHEN Child_Grade 已设置为 1 至 6 的整数且今日冒险练习队列已生成，THE Learning_System SHALL 使队列中每个队列项所关联的题目年级、口算生成器年级参数及知识点年级均不大于 Child_Grade
3. WHEN Child_Grade 已设置为 1 至 6 的整数且存在已到复习时间（nextReviewAt 不晚于当前时间）但知识点年级（按 knowledgePointId 年级段解析）大于 Child_Grade 的 Mastery_Record，THE Review_Engine SHALL 不将这些知识点纳入今日冒险练习队列的复习段
4. WHILE Child_Grade 小于某知识点的年级，THE Learning_System SHALL 保持该知识点的 Mastery_Record 全部数据内容不被删除或修改
5. IF Child_Grade 为 1 或 2，THEN THE Review_Engine SHALL 不在今日冒险练习队列中包含英语学科队列项（外研版教材为三年级起点，英语无一年级与二年级内容）
6. IF Child_Grade 已设置为 1 至 6 的整数且按本 Requirement 过滤后今日冒险练习队列的复习段与新知识点段均为空，THEN THE Learning_System SHALL 沿用现有规格 Requirement 1 第 7 条定义的无可用题行为（展示提示并使学生停留在首页，不进入练习界面）
7. WHEN Review_Engine 按本 Requirement 过滤生成今日冒险练习队列，THE Review_Engine SHALL 保持现有队列组织规则不变：复习段在前（按 nextReviewAt 从最早到最晚排序）且队列项数量不超过 50，新知识点段在后且队列项数量不超过 50
8. THE Learning_System SHALL 保持学科入口页 Grade_Selector 先选年级再练习的流程不变，学科页练习内容的年级范围仅由学科页所选年级决定，不受 Child_Grade 影响
9. WHEN Child_Grade 被修改，THE Review_Engine SHALL 在下次生成今日冒险练习队列时按修改后的 Child_Grade 应用本 Requirement 的过滤规则
10. WHEN Child_Grade 被调高至大于或等于某知识点的年级且该知识点已到复习时间（nextReviewAt 不晚于当前时间），THE Review_Engine SHALL 在下次生成今日冒险练习队列时将该知识点作为复习段候选项

### Requirement 3: 未设置默认行为与设置变更生效时机

**User Story:** 作为一名家长，我希望没设置年级时应用照常用、设置后能按预期时间生效，这样不会有奇怪的打断。

#### Acceptance Criteria

1. IF Child_Grade 处于未设置状态（从未设置，或按 Requirement 4 第 4、5 条以未设置状态启动），THEN THE Review_Engine SHALL 生成今日冒险练习队列时不按 Child_Grade 过滤，允许队列项的年级属性为 Question_Bank 中该学科的任一可用年级，并保持现有规格 Requirement 1、3 定义的今日冒险生成与当日续玩行为不变
2. WHILE 当日 Today_Session 尚未生成，WHEN Child_Grade 被设置或修改，THE Review_Engine SHALL 在当日首次生成今日冒险练习队列时即按新的 Child_Grade 过滤出题，使该队列中每个队列项的年级属性均小于或等于新的 Child_Grade（"当日"按设备本地时间的自然日界定）
3. WHILE 当日 Today_Session 已生成且尚未全部完成，WHEN Child_Grade 被设置或修改，THE Learning_System SHALL 保持当日已生成的练习队列与作答进度不变：学生当日继续练习时沿用原队列，展示的下一道未完成题目与设置变更前一致，年级属性大于新的 Child_Grade 的队列项仍保留在队列中且可正常作答
4. WHILE 当日 Today_Session 已全部完成，WHEN Child_Grade 被设置或修改，THE Learning_System SHALL 保持当日完成状态与完成庆祝行为不变：学生当日再次点击"今日冒险"按钮时仍展示完成庆祝画面而不进入练习，且当日不重新生成 Today_Session
5. WHEN Child_Grade 被设置或修改，THE Learning_System SHALL 使新的 Child_Grade 自下一次生成今日冒险练习队列（下一个自然日学生首次进入练习时触发生成）起生效，当日不重新生成 Today_Session，且下一次生成的队列中每个队列项的年级属性均小于或等于最新的 Child_Grade
6. WHEN Child_Grade 被设置或修改，THE Learning_System SHALL 保持设置变更前后全部 Mastery_Record、Wrong_Set、Star_Wallet、Island_Collection、Last_Grade 及各学科练习进度数据的内容完全一致，不因本次变更新增、删除或修改其中任何记录

### Requirement 4: 孩子年级数据持久化与兼容

**User Story:** 作为一名家长，我希望设置好的年级关掉浏览器也不会丢、不会被孩子以前的旧数据弄乱，这样设置一次就一直有效。

#### Acceptance Criteria

1. THE Learning_System SHALL 将 Child_Grade 持久化至 Local_Store，使每次写入完成后从 Local_Store 读出的 Child_Grade 与写入值相等，且在浏览器关闭与设备重启后仍然完整保留
2. WHEN Child_Grade 发生变化（家长设置或修改年级），THE Learning_System SHALL 在变化发生后 1 秒内将变化后的 Child_Grade 写入 Local_Store，且当 1 秒内发生多次变化时，最终写入 Local_Store 的值为最后一次变化后的 Child_Grade
3. WHEN 学生关闭浏览器后重新打开 Learning_System，THE Learning_System SHALL 在页面打开后 2 秒内从 Local_Store 恢复 Child_Grade，且恢复值与最后一次成功写入的值一致
4. IF Local_Store 中不存在 Child_Grade 数据，THEN THE Learning_System SHALL 将 Child_Grade 按未设置状态启动，且不创建备份副本
5. IF Local_Store 中 Child_Grade 的数据无法解析，或其值不是一年级至六年级的整数，THEN THE Learning_System SHALL 将 Child_Grade 按未设置状态启动，将损坏数据以独立备份副本保留在 Local_Store 中且本次会话内不被覆盖，其他未损坏实体的数据不受影响，且此后家长设置的新的 Child_Grade 仍按本 Requirement 第 2 条正常写入并持久化
6. THE Learning_System SHALL 将 Child_Grade 按账号标识隔离存储于 Local_Store，沿用现有规格的键命名空间规则，使一个账号标识下对 Child_Grade 的读取与写入不得读取到或改变另一账号标识下的对应数据
7. IF 写入 Local_Store 失败（存储不可用或空间不足），THEN THE Learning_System SHALL 在检测到写入失败后于界面上展示表明本次进度可能无法保存的提示，该提示不得阻断学生继续练习，并保持当前会话内已设置的 Child_Grade 在界面上可见
8. WHEN Learning_System 在本功能版本首次启动时检测到此前版本已存储的学习数据，THE Learning_System SHALL 保留全部既有 Mastery_Record、Wrong_Set、Star_Wallet、Island_Collection、Last_Grade 与各练习会话数据（今日冒险 Today_Session 与各学科年级练习进度），不因本功能升级而清除或重置上述任何数据，且此前已存在的今日冒险行为在 Child_Grade 设置前保持 Requirement 3 第 1 条定义的未设置不过滤行为不变
