# Requirements Document

## Introduction

本规格是"趣味学习冒险"（kids-learning-adventure）的功能扩充规格，基于现有规格 kids-learning-adventure（见 .kiro/specs/kids-learning-adventure/）定义第二期扩充内容，包含三项能力：

1. **题库年级扩充**：将内置题库种子内容由三、四年级扩充至一至六年级。语文为人教版一年级至六年级，数学为人教版一年级至六年级，英语为外研版（三年级起点）三年级至六年级。本规格生效后，现有规格 Requirement 13 第 8 条中"内置 Question_Bank 种子内容仅覆盖三年级与四年级"的约束即由本规格 Requirement 2 取代。
2. **科目后选择年级**：调整学科入口页的导航流程。现有流程为学生进入学科入口页后直接进入练习；本规格生效后，学生进入学科入口页（语文大陆/数学王国/英语岛）后先选择年级，再进入该学科所选年级的练习。首页"今日冒险"入口保持不变。
3. **错题集查看**：现有规格已定义 Wrong_Set（错题集）数据实体与持久化，但未提供查看界面。本规格新增错题集的记录规则与查看功能，错题集入口放置在"我的小岛"（小岛展示页）中。

除本规格明确修改的部分外，现有规格的全部约束继续有效（包括艾宾浩斯间隔重复引擎、低挫败答题体验、星星与宝箱、题库 JSON 结构与校验、多端适配与视听反馈等）。

## Glossary

沿用现有规格 kids-learning-adventure 的术语定义：

- **Learning_System（学习系统）**: 本趣味学习记忆系统整体，网页版 H5 应用
- **Adventure_Engine（冒险引擎）**: 负责组织练习内容、编排题目顺序的模块
- **Review_Engine（复习引擎）**: 基于艾宾浩斯间隔重复算法安排题目复习时机的模块
- **Question_Bank（题库）**: 以结构化 JSON 组织的题目数据集合，按学科/年级/单元/题型分类
- **Mastery_Record（掌握度记录）**: 记录每个知识点答题历史与复习间隔的数据
- **Wrong_Set（错题集）**: 记录学生答错题目的集合
- **Star_Wallet（星星账户）**: 记录学生闯关获得星星数量的数据
- **Island_Collection（小岛收藏）**: 学生已收集的宠物与小岛装扮的集合
- **Local_Store（本地存储）**: 浏览器 localStorage 持久化存储
- **人教版**: 人民教育出版社小学语文、数学教材版本
- **外研版**: 外语教学与研究出版社小学英语教材版本（三年级起点）

本规格新增术语：

- **Grade_Selector（年级选择页）**: 学科入口页内展示可选年级列表、供学生选择练习年级的界面
- **Last_Grade（最近年级）**: 记录学生在每个学科最近一次所选年级的数据
- **Island_Page（我的小岛）**: 小岛展示页，展示 Island_Collection 并提供错题集入口
- **Wrong_Set_View（错题集页）**: 展示 Wrong_Set 中错题的页面，支持查看答案解析与重新作答
- **已掌握错题**: Wrong_Set 中对应知识点的 Mastery_Record 已被 Review_Engine 标记为已掌握的错题

## Requirements

### Requirement 1: 学科入口年级选择

**User Story:** 作为一名小学生，我希望选了科目之后能选我所在的年级，这样我练的内容跟我上课学的一样。

#### Acceptance Criteria

1. WHEN 学生进入语文大陆或数学王国学科入口页，THE Grade_Selector SHALL 按一年级至六年级的升序展示共 6 个可点击的年级选项
2. WHEN 学生进入英语岛学科入口页，THE Grade_Selector SHALL 按三年级至六年级的升序展示共 4 个可点击的年级选项，且不展示一年级和二年级选项（外研版教材为三年级起点）
3. WHEN 学生点击一个年级选项，THE Adventure_Engine SHALL 进入该学科所选年级的练习界面并展示第一道练习题，练习范围按 Requirement 3 界定，除年级外不要求学生在开始练习前做出其他选择
4. THE Grade_Selector 的每个年级选项触控区域 SHALL 不小于 44×44 像素
5. WHEN 学生在某学科选择过年级后再次进入该学科入口页，THE Grade_Selector SHALL 在该学生该学科的 Last_Grade 对应选项上显示与其余年级选项可见区分的标记（颜色或图标存在可见差异），且每个学科至多标记一个年级选项
6. IF 学生进入某学科入口页且从未在该学科选择过年级，THEN THE Grade_Selector SHALL 以相同样式展示全部年级选项且不显示任何 Last_Grade 标记
7. THE Learning_System SHALL 保留首页"今日冒险"入口及其现有行为，Grade_Selector 仅出现在学科入口页的练习流程中

### Requirement 2: 题库扩充至一至六年级

**User Story:** 作为一名低年级或高年级的小学生，我希望题库里有我这个年级的题，这样我也能玩这个游戏。

#### Acceptance Criteria

1. THE Question_Bank 的内置种子语文题目 SHALL 覆盖人教版一年级至六年级共 12 册（每年级上、下两册），每个年级的上册与下册均至少包含 1 道题目，且全部题目按年级、册与单元组织
2. THE Question_Bank 的内置种子数学题目 SHALL 覆盖人教版一年级至六年级共 12 册（每年级上、下两册）各单元知识点，每个年级的上册与下册均至少包含 1 道题目，且全部题目按年级、册与单元组织
3. THE Question_Bank 的内置种子英语题目 SHALL 覆盖外研版（三年级起点）三年级至六年级共 8 册（每年级上、下两册），每个年级的上册与下册均至少包含 1 道题目，且全部题目按年级、册与 Module 组织
4. THE Question_Bank 扩充后 SHALL 保留现有的三、四年级全部种子题目，且这些题目的题干、选项、答案、题型及媒体引用内容不发生变更
5. THE Question_Bank 扩充的各年级题目 SHALL 沿用现有规格 Requirement 9 定义的 JSON 结构与字段校验规则，题型取值限于现有规格 Requirement 6、7、8 已定义的题型
6. THE Question_Bank 的内置种子内容 SHALL 使语文与数学的一年级至六年级、英语的三年级至六年级中每个年级每个学科通过字段校验的题目数量不少于 20 道
7. IF 任一扩充种子题目未通过现有规格 Requirement 9 定义的字段校验规则，THEN THE Question_Bank SHALL 不加载该题目，且其余通过校验的题目的加载不受影响
8. WHERE 扩充年级的题目包含读音音频、发音音频或图片等媒体资源，THE Learning_System SHALL 对这些题目应用与三、四年级题目相同的媒体行为规则（展示时自动播放一次、重听或重播不限次数、媒体加载失败时展示提示且不影响作答）

### Requirement 3: 按年级组织练习

**User Story:** 作为一名小学生，我希望我选了几年级就只练几年级的题，不会混进其他年级的题。

#### Acceptance Criteria

1. WHEN 学生选择学科与年级进入练习，THE Adventure_Engine SHALL 仅以该学科该年级的题目与口算生成器参数生成练习队列，且队列中每道题目的学科属性与年级属性均等于学生所选学科与年级
2. THE Review_Engine SHALL 按知识点维护 Mastery_Record，每条 Mastery_Record 的知识点标识由学科、年级与知识点唯一组合而成，不同年级的同名知识点具有互不相同的知识点标识，且更新任一年级知识点的 Mastery_Record 不得改变其他学科或年级知识点的 Mastery_Record
3. WHEN 学生在练习进行中切换至其他学科或年级，THE Learning_System SHALL 将当前练习进度（含当前练习队列与已作答位置）以所选学科与年级组合为标识保存至 Local_Store，且不同学科与年级组合的进度数据相互独立存储，保存任一组合的进度不得覆盖或修改其他组合的进度数据
4. IF 学生所选学科与年级在 Question_Bank 中无可用题目（可用题目数量为 0），THEN THE Learning_System SHALL 展示表明该学科该年级暂无可用题目的提示信息，并使学生停留在 Grade_Selector，不进入练习界面
5. WHEN 学生在所选学科年级的练习中首次作答答错一道题，THE Learning_System SHALL 按 Requirement 4 的记录规则将该题记入 Wrong_Set，并由 Review_Engine 按现有规格的间隔重复规则更新该题所属学科年级对应知识点的 Mastery_Record

### Requirement 4: 错题集记录规则

**User Story:** 作为一名小学生，我希望我做错的题都能被自动记下来，这样我知道哪些还没学会。

#### Acceptance Criteria

1. WHEN 学生在一道题被呈现后提交该次作答的首个答案且答案错误，THE Learning_System SHALL 将该题记入 Wrong_Set
2. WHEN 一道题被记入 Wrong_Set，THE Learning_System SHALL 记录该题的题目引用、学科、年级、知识点标识、答错时间与答错次数，首次记入时答错次数为 1、答错时间为本次答错发生的时间，且同一题目引用在 Wrong_Set 中最多存在一条记录
3. WHEN 学生对已存在于 Wrong_Set 的一道题再次提交该次作答的首个答案且答案错误，THEN THE Learning_System SHALL 将该题的答错时间更新为本次答错发生的时间、答错次数在原值基础上加 1，而不在 Wrong_Set 中重复添加该题
4. WHEN 学生对已记入 Wrong_Set 的一道题在重试中提交非首个答案（无论答对或答错），THE Learning_System SHALL 不修改该题在 Wrong_Set 中的答错时间与答错次数
5. WHEN 学生对已记入 Wrong_Set 的一道题重试后答对，THE Learning_System SHALL 将该题保留在 Wrong_Set 中
6. WHEN Wrong_Set 中一道题对应的知识点被 Review_Engine 标记为已掌握，THE Learning_System SHALL 将该题标记为已掌握错题，使该标记在查看时可与未掌握错题区分，并将该题保留在 Wrong_Set 中供查看

### Requirement 5: 我的小岛错题集查看与重练

**User Story:** 作为一名小学生，我希望在我的小岛上能看到错题集，还能把做错的题再做对。

#### Acceptance Criteria

1. THE Learning_System SHALL 在 Island_Page（我的小岛）提供错题集入口，并在该入口旁展示 Wrong_Set 中当前未掌握错题的数量，未掌握错题数量为 0 时显示 0
2. WHEN 学生点击错题集入口，THE Learning_System SHALL 展示 Wrong_Set_View，按学科分组展示 Wrong_Set 中的错题，且同一学科分组内的错题按最近一次答错时间由近到远排序
3. WHEN Wrong_Set_View 展示错题列表，THE Learning_System SHALL 为每条错题展示题干、所属学科、年级与最近一次答错时间（显示格式为年-月-日 时:分），并以"已掌握"或"未掌握"文字标识区分每条错题的掌握状态
4. WHEN 学生点击错题列表中的一条错题，THE Learning_System SHALL 展示该题的正确答案与不超过 100 个字符的解析
5. WHEN 学生对一条未掌握错题选择重新作答，THE Learning_System SHALL 以原题呈现作答界面，并按与闯关练习一致的规则判定作答对错
6. IF Wrong_Set 为空，THEN THE Wrong_Set_View SHALL 展示空状态提示，并提供前往闯关练习的引导入口
7. THE Learning_System SHALL 在 Island_Page 保留 Island_Collection 的宠物与装扮展示及已收集数量计数，错题集入口的加入不改变现有收集展示行为
8. WHEN 学生在错题重练中答对题目，THE Review_Engine SHALL 按间隔重复规则更新该题对应知识点的 Mastery_Record
9. IF 学生在错题重练中再次答错题目，THEN THE Learning_System SHALL 保持该题为未掌握状态，并将该题的最近一次答错时间更新为本次作答时间

### Requirement 6: 扩充数据本地持久化与兼容

**User Story:** 作为一名小学生，我希望我选的年级和错题集关掉浏览器也不会丢，新版本也不会弄丢我以前攒的星星和宠物。

#### Acceptance Criteria

1. THE Learning_System SHALL 将学生各学科的 Last_Grade 与全部 Wrong_Set 错题记录持久化至 Local_Store，使其在浏览器关闭与设备重启后仍然完整保留
2. WHEN Last_Grade 或 Wrong_Set 发生变化（学生在某学科选择年级、错题按 Requirement 4 首次记入、错题答错时间与次数更新、错题被标记为已掌握），THE Learning_System SHALL 在变化发生后 1 秒内将变化后的完整数据写入 Local_Store
3. WHEN 学生关闭浏览器后重新打开 Learning_System，THE Learning_System SHALL 在页面打开后 2 秒内从 Local_Store 恢复各学科的 Last_Grade 与全部 Wrong_Set 错题记录，且恢复值与最后一次成功写入的值一致
4. IF Local_Store 中不存在 Last_Grade 或 Wrong_Set 数据，THEN THE Learning_System SHALL 将该实体按初始状态启动（Last_Grade 为空、Wrong_Set 为空），且不创建备份副本
5. IF Local_Store 中 Last_Grade 或 Wrong_Set 的数据无法解析，或缺少必需内容（Last_Grade 的学科与年级对应关系，或 Wrong_Set 错题按 Requirement 4 第 2 条定义的题目引用、学科、年级、知识点标识、答错时间或答错次数；本功能版本首次启动时发现的旧版本数据除外，按第 6 条处理），THEN THE Learning_System SHALL 仅将该实体按初始状态启动（Last_Grade 为空、Wrong_Set 为空），将损坏数据以独立备份副本保留在 Local_Store 中且本次会话内不被覆盖，且其他未损坏实体的数据不受影响
6. WHEN Learning_System 在本功能版本首次启动时检测到此前版本已存储的学习数据，THE Learning_System SHALL 保留全部既有 Mastery_Record、Wrong_Set、Star_Wallet 与 Island_Collection 数据，使得 Star_Wallet 余额与累计数不变、Island_Collection 收藏内容不变、Mastery_Record 记录不变、此前已存在的错题记录仍保留并可在 Wrong_Set_View 中查看，不因题库扩充或功能升级而清除或重置上述任何数据
7. THE Learning_System SHALL 将 Last_Grade 与 Wrong_Set 按账号标识隔离存储于 Local_Store，沿用现有规格的键命名空间规则，使一个账号标识下对 Last_Grade 或 Wrong_Set 的读取与写入不得读取到或改变另一账号标识下的对应数据
8. IF 写入 Local_Store 失败（存储不可用或空间不足），THEN THE Learning_System SHALL 在界面上提示学生本次进度可能无法保存，该提示不得阻断学生继续练习，并保持当前会话内已选年级与错题集内容在界面上可见
