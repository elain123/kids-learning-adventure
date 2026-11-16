# Requirements Document

## Introduction

"趣味学习冒险"是一个面向小学 1-6 年级学生的网页版（H5）趣味学习记忆系统。系统将"记忆与复习"包装为"玩游戏"：通过艾宾浩斯间隔重复引擎自动安排每日练习内容，学生只需点击"今日冒险"按钮即可开始约 10 分钟的闯关练习。系统包含语文大陆、数学王国、英语岛三大主题入口，采用纯前端架构（Vue3 + Vite），学习数据存储于浏览器 localStorage，无需后端服务即可运行。第一期数学王国的练习内容覆盖人教版三、四年级全部单元知识点的数学练习（含口算速算与填空、判断、选择、单位换算、几何计算等题型），语文大陆覆盖人教版三、四年级基础字词，英语岛覆盖外研版三、四年级单词记忆卡；第一期内置题库种子内容仅覆盖三年级与四年级。本文档覆盖第一期（MVP）范围，并对第二、三期功能给出需求约束。

## Glossary

- **Learning_System（学习系统）**: 本趣味学习记忆系统整体，网页版 H5 应用
- **Adventure_Engine（冒险引擎）**: 负责组织"今日冒险"每日练习内容、编排题目顺序的模块
- **Review_Engine（复习引擎）**: 基于艾宾浩斯间隔重复算法安排题目复习时机的模块
- **Question_Bank（题库）**: 以结构化 JSON 组织的题目数据集合，按学科/年级/单元/题型分类
- **Mastery_Record（掌握度记录）**: 记录每个知识点答题历史与复习间隔的数据
- **Wrong_Set（错题集）**: 记录学生答错题目的集合
- **Star_Wallet（星星账户）**: 记录学生闯关获得星星数量的数据
- **Treasure_Box（宝箱）**: 学生消耗星星开启、产出随机奖励的游戏化组件
- **Island_Collection（小岛收藏）**: 学生已收集的宠物与小岛装扮的集合
- **Today_Session（今日练习）**: 冒险引擎为学生生成的当日练习计划
- **Hint（提示）**: 答错后系统给出的引导性线索，不直接给出答案
- **Streak（连胜）**: 学生连续答对题目的计数
- **Local_Store（本地存储）**: 浏览器 localStorage 持久化存储
- **MVP（第一期）**: 最小可行版本，范围见 Requirement 13
- **人教版**: 人民教育出版社小学语文教材版本
- **外研版**: 外语教学与研究出版社小学英语教材版本（三年级起点）

## Requirements

### Requirement 1: 今日冒险一键开始

**User Story:** 作为一名怕麻烦的小学生，我希望打开首页只点一个大按钮就能开始练习，这样我不需要做任何选择就能开始学习。

#### Acceptance Criteria

1. THE Learning_System SHALL 在首页展示"今日冒险"主按钮，且首页仅提供这一个练习入口，不展示需要学生在开始练习前做出选择的其他入口（如科目选择、难度选择）
2. WHEN 学生点击"今日冒险"按钮，THE Adventure_Engine SHALL 在 2 秒内完整展示第一道练习题并使其处于可作答状态，期间不展示任何中间选择页面
3. WHEN 学生点击"今日冒险"按钮且当日 Today_Session 中存在未完成题目，THE Adventure_Engine SHALL 直接展示该学生当日第一道未完成题目（"当日"按设备本地时间的自然日界定）
4. WHEN 学生点击"今日冒险"按钮且当日 Today_Session 尚未生成，THE Review_Engine SHALL 依据 Mastery_Record 自动生成当日 Today_Session
5. IF 当日 Today_Session 的全部题目已完成，THEN THE Learning_System SHALL 展示完成庆祝画面，并将"今日冒险"按钮展示为已完成状态；学生再次点击该按钮时展示完成庆祝画面而不进入练习
6. IF 生成当日 Today_Session 时学生无任何 Mastery_Record 或无到达复习时间的知识点，THEN THE Review_Engine SHALL 使用新知识点题目生成当日 Today_Session
7. IF Review_Engine 无法生成当日 Today_Session（如 Question_Bank 中无可用题目），THEN THE Learning_System SHALL 展示提示信息并保持学生停留在首页，不进入练习界面

### Requirement 2: 练习节奏与进度自动保存

**User Story:** 作为一名注意力短的小学生，我希望每次只玩一小会儿、随时可以停下，这样我不会觉得累。

#### Acceptance Criteria

1. THE Adventure_Engine SHALL 将 Today_Session 中的练习题目按每组 3 题依次编排，最后一个小组允许为 1 至 3 题
2. THE Adventure_Engine SHALL 自关卡第一题展示时起累计该关卡的进行时长，目标时长为 10 分钟
3. WHEN 学生完成一个小组内全部题目的作答，THE Learning_System SHALL 展示小组结算画面，画面提供"继续"与"休息"两个选项
4. WHEN 学生在练习中途退出页面，THE Learning_System SHALL 将当前关卡、下一道未作答题目的位置及已答题目的作答结果保存至 Local_Store
5. WHEN 学生在中断后重新进入练习，THE Adventure_Engine SHALL 从 Local_Store 恢复进度，并展示学生下一道未作答的题目
6. WHEN 一个关卡的进行时长达到 10 分钟，THE Learning_System SHALL 展示包含"继续"与"休息"选项的提示
7. WHEN 学生在小组结算画面选择"继续"，THE Learning_System SHALL 展示学生下一道未作答的题目
8. WHEN 学生选择"休息"，THE Learning_System SHALL 将当前练习进度保存至 Local_Store 并返回首页

### Requirement 3: 艾宾浩斯间隔重复引擎

**User Story:** 作为一个小学生，我希望系统自动帮我安排该复习什么，这样我不用自己记什么时候复习。

#### Acceptance Criteria

1. THE Review_Engine SHALL 为每个知识点维护一条 Mastery_Record，记录该知识点的当前间隔级别（共 5 级：10 分钟、1 天、3 天、7 天、15 天）、累计答对次数、累计答错次数与下次复习时间，并在学生每次作答该知识点后更新该记录
2. WHEN 学生答对一个累计答对次数为 0 的知识点，THE Review_Engine SHALL 将该知识点的当前间隔级别设为第 1 级（10 分钟），并将下次复习时间设为本次答题时间加 10 分钟
3. WHEN 学生答对一个累计答对次数大于 0、未标记为已掌握且当前间隔级别为第 1 至 4 级的知识点，THE Review_Engine SHALL 将该知识点的当前间隔级别按 10 分钟 → 1 天 → 3 天 → 7 天 → 15 天的序列递增一级，并将下次复习时间设为本次答题时间加递增后级别对应的间隔时长
4. IF 学生答错一个未标记为已掌握的知识点，THEN THE Review_Engine SHALL 将该知识点的当前间隔级别重置为第 1 级（10 分钟）、将下次复习时间设为本次答题时间加 10 分钟，并将该知识点追加到当日 Today_Session 练习队列中使其在当日练习中再次出现
5. WHILE 生成当日 Today_Session，THE Review_Engine SHALL 将下次复习时间不晚于当前时间的知识点按下次复习时间从最早到最晚的顺序排入练习队列，并全部置于新知识点题目之前
6. WHILE 生成当日 Today_Session，THE Review_Engine SHALL 将尚无 Mastery_Record 的新知识点题目补充在复习题目之后
7. IF 一个知识点的当前间隔级别为第 5 级（15 天）且学生再次答对该知识点，THEN THE Review_Engine SHALL 将该知识点标记为已掌握、清除其下次复习时间，并使其不再进入后续 Today_Session 练习队列
8. WHEN 学生在一个自然日内首次进入练习，THE Review_Engine SHALL 生成当日 Today_Session 练习队列
9. IF 当日 Today_Session 练习队列已生成，THEN THE Review_Engine SHALL 在学生当日再次进入练习时沿用该队列而不重新生成

### Requirement 4: 低挫败答题体验

**User Story:** 作为一个小学生，我希望答错了不会直接被批评，而是得到提示再试一次，这样我不会因为做错而不想玩。

#### Acceptance Criteria

1. WHEN 学生首次作答答错一道题，THE Learning_System SHALL 展示一条针对该题的 Hint，并保留同一道题供学生重试，重试次数限 1 次，且此时不得展示正确答案
2. WHEN 学生重试后仍答错，THE Learning_System SHALL 展示该题的正确答案与不超过 100 字的解析、一条不含批评或否定表述的鼓励性反馈文案，并提供进入下一题的操作入口
3. WHEN 学生重试后答对，THE Learning_System SHALL 按答错一次处理该知识点的 Mastery_Record
4. WHEN 学生首次作答答对一道题，THE Learning_System SHALL 将 Streak 计数加 1，并在答题界面实时展示当前 Streak 数值
5. WHEN 学生首次作答答错一道题，THE Learning_System SHALL 将 Streak 计数重置为 0
6. WHEN 学生首次作答答对一道题且 Streak 计数因此达到 3 的倍数，THE Learning_System SHALL 按该题应得星星数量的 2 倍向 Star_Wallet 发放星星，并展示星星加倍的反馈
7. IF 学生连续 3 道题首次作答答错（重试后答对仍计为答错），THEN THE Learning_System SHALL 将后续出题难度下调 1 个难度等级，下调后不得低于 Question_Bank 中该学科题目的最低难度等级
8. WHEN 学生首次作答答对一道题，THE Learning_System SHALL 将连续答错计数重置为 0

### Requirement 5: 收集与随机奖励

**User Story:** 作为一个小学生，我希望闯关能攒星星、开宝箱、收集宠物，这样我每次玩都有惊喜。

#### Acceptance Criteria

1. WHEN 学生答对一道题，THE Learning_System SHALL 向 Star_Wallet 发放 5 颗星星；WHERE Streak 加倍生效（见 Requirement 4 第 6 条），该题星星数量翻倍为 10 颗
2. WHEN 学生完成一个关卡，THE Learning_System SHALL 向 Star_Wallet 发放 10 颗关卡完成星星
3. THE Learning_System SHALL 提供 Treasure_Box，开启一次 Treasure_Box 固定消耗 30 颗星星，并在 Treasure_Box 开启入口旁向学生展示该消耗数量
4. WHEN 学生开启 Treasure_Box 且 Star_Wallet 余额不少于 30 颗，THE Learning_System SHALL 从 Star_Wallet 扣减 30 颗星星，并从 12 件可收集物品（6 件宠物、6 件小岛装扮）中随机产出 1 件
5. IF 学生开启 Treasure_Box 时 Star_Wallet 余额少于 30 颗，THEN THE Learning_System SHALL 阻止开启、保持 Star_Wallet 余额不变、展示提示信息表明星星不足，并提供继续闯关的引导入口
6. WHEN Treasure_Box 产出一件学生未拥有的物品，THE Learning_System SHALL 将该物品加入 Island_Collection
7. IF Treasure_Box 产出学生已拥有的物品，THEN THE Learning_System SHALL 将该物品折算为 5 颗星星返还至 Star_Wallet，且不向 Island_Collection 重复添加该物品
8. THE Learning_System SHALL 提供小岛展示页，展示 Island_Collection 中全部已收集的宠物与装扮，并展示已收集数量与可收集总数（共 12 件）
9. WHEN Star_Wallet 星星数量发生变化，THE Learning_System SHALL 在 1 秒内更新界面上展示的星星余额

### Requirement 6: 语文大陆（第一期范围：基础知识）

**User Story:** 作为一名小学生，我希望语文练习跟我课本学的内容一致，这样我在游戏里练的就是课堂上要考的。

#### Acceptance Criteria

1. THE Question_Bank SHALL 按人教版教材的年级（一年级至六年级）、册（每年级上、下两册）、单元组织语文题目
2. THE Question_Bank SHALL 包含生字听写、拼音选择、形近字辨析、多音字辨析、词语搭配、成语填空、古诗文接龙七类基础题型
3. WHEN 生字听写题展示时，THE Learning_System SHALL 自动播放该生字的读音一次
4. WHERE 学生作答七类基础题型中的任意题型，THE Learning_System SHALL 提供点选或拖拽的作答方式，不要求学生通过键盘打字输入
5. WHEN 学生提交语文题作答，THE Learning_System SHALL 在 1 秒内依据 Question_Bank 中的标准答案判定对错
6. WHEN 学生在生字听写题中请求重听读音，THE Learning_System SHALL 再次播放该生字读音，且不限制重听次数

### Requirement 7: 数学王国（第一期范围：三、四年级知识点练习）

**User Story:** 作为一名小学生，我希望数学练习覆盖我课本里三、四年级每个单元的知识点，不只是算得快，这样我在游戏里练的就是课堂上学的全部内容。

#### Acceptance Criteria

1. THE Question_Bank SHALL 按人教版教材的年级（一年级至六年级）、册（每年级上、下两册）、单元组织数学题目，第一期内置题目覆盖三、四年级全部单元的知识点：三年级（时分秒、测量、万以内加减法、倍的认识、多位数乘一位数、长方形和正方形的周长、分数的初步认识、位置与方向、除数是一位数的除法、两位数乘两位数、面积、年月日、小数的初步认识）、四年级（大数的认识、公顷和平方千米、角的度量、三位数乘两位数、平行四边形和梯形、除数是两位数的除法、四则运算、运算定律、小数的意义和性质、小数的加减法、三角形、平均数与条形统计图、数学广角鸡兔同笼）
2. THE Question_Bank 的第一期数学题目 SHALL 包含口算速算、填空、判断、选择、单位换算、几何计算（周长与面积）六类题型，全部题型均以点选数字、点选选项或拖拽方式作答，不要求学生打字输入算式
3. THE Learning_System SHALL 按知识点参数程序化生成口算速算类题目，每次出题的数值随机，其余题型的题目取自 Question_Bank
4. WHEN 学生开始口算速算关卡，THE Learning_System SHALL 展示 10 分钟倒计时
5. WHEN 口算速算关卡倒计时结束，THE Learning_System SHALL 自动结算本关，未作答的题目不计入本关答对题数
6. WHEN 口算速算关卡结算，THE Learning_System SHALL 展示本关答对题数与历史最佳纪录的对比
7. IF 本关答对题数超过历史最佳纪录，THEN THE Learning_System SHALL 在结算时将历史最佳纪录更新为本关答对题数并展示新纪录提示
8. IF 学生首次完成口算速算关卡，THEN THE Learning_System SHALL 将本关答对题数记录为历史最佳纪录
9. WHEN 学生进入非口算的数学知识点练习，THE Adventure_Engine SHALL 按 3 题一个小组编排该知识点的题目，最后一个小组允许为 1 至 3 题

### Requirement 8: 英语岛（第一期范围：单词记忆卡）

**User Story:** 作为一名小学生，我希望英语单词通过图片和声音来记，这样比背单词表有意思。

#### Acceptance Criteria

1. THE Question_Bank SHALL 按外研版（三年级起点）三年级至六年级教材的年级、册与 Module 组织英语题目
2. THE Question_Bank SHALL 第一期包含单词记忆卡题型，每张单词记忆卡包含图片、发音音频与拼写
3. WHEN 学生查看单词记忆卡，THE Learning_System SHALL 播放该单词的发音音频
4. WHEN 学生进行单词记忆卡练习，THE Learning_System SHALL 展示 4 个图片选项（1 张与所学单词匹配、3 张为干扰项）或 4 个拼写选项（1 个拼写正确、3 个为干扰项），供学生通过点选作答
5. WHEN 学生作答英语题，THE Learning_System SHALL 依据 Question_Bank 中的标准答案在 1 秒内判定对错
6. WHEN 学生点击单词记忆卡的发音重播按钮，THE Learning_System SHALL 重新播放当前单词的发音音频
7. IF 单词发音音频加载或播放失败，THEN THE Learning_System SHALL 显示音频播放失败的提示信息，且学生仍可查看该单词的图片与拼写并完成作答

### Requirement 9: 题库结构化组织

**User Story:** 作为内容维护者，我希望题目以统一结构管理，这样新增题目不需要修改系统代码。

#### Acceptance Criteria

1. THE Question_Bank SHALL 以 JSON 格式存储全部题目
2. THE Question_Bank 的每道题目 SHALL 包含学科、年级、单元、题型、题干、标准答案、难度与所属知识点字段，其中学科取值限于语文、数学、英语，年级取值为 1 至 6 的整数，难度取值为 1 至 5 的整数（1 为最易、5 为最难），题型取值限于 Requirement 6、7、8 已定义的题型
3. WHEN Learning_System 启动，THE Learning_System SHALL 加载 Question_Bank 的 JSON 数据，并校验每道题目的必需字段齐全且取值合法
4. IF 一道题目缺少必需字段或字段取值超出限定范围，THEN THE Learning_System SHALL 跳过该题目、记录标识该题目的错误日志，并正常加载其余题目
5. IF Question_Bank 的 JSON 数据整体无法解析，THEN THE Learning_System SHALL 记录错误日志、提示题库加载失败，并停止进入练习流程
6. WHEN 一道符合必需字段与取值要求的新题目被加入 Question_Bank 的 JSON 数据，THE Learning_System SHALL 在下一次启动时加载该题目，并将其纳入对应学科、年级与单元的出题范围

### Requirement 10: 学习数据本地持久化

**User Story:** 作为一个小学生，我希望关掉浏览器再打开进度还在，这样我不用重新开始。

#### Acceptance Criteria

1. THE Learning_System SHALL 将 Mastery_Record、Wrong_Set、Star_Wallet 与 Island_Collection 持久化至 Local_Store，使其在浏览器关闭与设备重启后仍然保留
2. WHEN 学生答题导致 Mastery_Record、Wrong_Set、Star_Wallet 或 Island_Collection 发生变化，THE Learning_System SHALL 在变化发生后 1 秒内将变化写入 Local_Store
3. WHEN 学生关闭浏览器后重新打开 Learning_System，THE Learning_System SHALL 在页面打开后 2 秒内从 Local_Store 恢复 Mastery_Record、Wrong_Set、Star_Wallet 与 Island_Collection，且恢复值与最后一次成功写入的值一致
4. IF Local_Store 中的数据无法解析或缺少必需数据字段，THEN THE Learning_System SHALL 以初始状态启动（Mastery_Record 为空、Wrong_Set 为空、Star_Wallet 余额为 0、Island_Collection 为空），并将损坏数据以独立备份副本保留在 Local_Store 中且本次会话内不被覆盖
5. WHILE Learning_System 页面已完成加载且设备无网络连接，THE Learning_System SHALL 支持学生完成答题、即时判定、进度保存、星星奖励发放与错题收集的全部练习流程
6. IF 写入 Local_Store 失败（存储不可用或空间不足），THEN THE Learning_System SHALL 提示学生本次进度可能无法保存，并保持当前会话内的答题进度在界面上可见

### Requirement 11: 多端浏览器适配

**User Story:** 作为一个小学生，我希望在手机上、平板上和电脑上都能玩，这样我用什么设备都可以学习。

#### Acceptance Criteria

1. THE Learning_System SHALL 以网页版 H5 形态运行，支持手机、平板与桌面设备访问，在 iOS Safari、Android Chrome、桌面 Chrome、Edge 与 Safari 浏览器的当前稳定版本上可完成全部核心功能
2. WHILE 屏幕宽度为 320 像素及以上，THE Learning_System SHALL 展示首页、练习与结算页面，且页面不出现横向滚动条
3. WHILE 屏幕宽度为 320 像素及以上，THE Learning_System SHALL 将答题控件完整展示在可视区域内，学生无需横向滚动即可完成点选与拖拽操作
4. THE Learning_System SHALL 支持学生仅使用触摸操作或仅使用鼠标操作完成全部答题交互，包括点选与拖拽
5. WHEN 学生旋转设备屏幕方向或改变浏览器窗口大小，THE Learning_System SHALL 自适应调整页面布局，且当前练习进度与答题状态保持不变

### Requirement 12: 视听反馈与卡通界面

**User Story:** 作为一个小学生，我希望界面像动画片一样好看、答对了有好听的声音，这样我觉得这是在玩而不是在学。

#### Acceptance Criteria

1. THE Learning_System SHALL 采用卡通风格界面，首页、学科入口页与练习页均展示卡通角色形象，且全部按钮采用圆角造型
2. THE Learning_System SHALL 将全部可点击交互元素的触控区域设置为不小于 44×44 像素
3. WHEN 学生答对题目，THE Learning_System SHALL 播放正确音效，并展示时长不超过 3 秒的庆祝动画
4. WHEN 学生答错题目，THE Learning_System SHALL 播放时长不超过 1 秒的提示音效，该音效不含人声语音且与答对音效不同
5. THE Learning_System SHALL 提供音效开关，音效默认状态为开启，学生可通过该开关关闭全部音效
6. WHEN 学生将音效开关切换为关闭状态，THE Learning_System SHALL 停止当前正在播放的音效，且后续答题与奖励场景均不再播放任何音效
7. WHEN 学生调整音效开关后重新打开 Learning_System，THE Learning_System SHALL 从 Local_Store 恢复音效开关的上次设置状态

### Requirement 13: 第一期（MVP）范围界定

**User Story:** 作为产品负责人，我希望第一期聚焦核心闭环，这样能快速验证"游戏化记忆"是否被孩子接受。

#### Acceptance Criteria

1. THE MVP SHALL 提供语文大陆、数学王国、英语岛三个主题入口，学生经任一入口可进入对应主题的练习内容
2. THE MVP 的练习内容 SHALL 仅包含语文基础字词（Requirement 6 所列七类基础题型）、数学三、四年级各知识点练习（Requirement 7 所列题型）与英语单词记忆卡三类
3. THE MVP SHALL 包含 Adventure_Engine 关卡闯关、Star_Wallet 星星奖励、Treasure_Box 宝箱与基于 Review_Engine 的错题自动复习功能
4. THE Question_Bank 的题型字段 SHALL 支持扩展表示语文阅读理解、英语跟读评分、数学多步骤文字应用题三类第二期题型
5. THE Learning_System SHALL 在 Local_Store 中以账号标识隔离存储学习数据，第一期使用单一默认账号标识，以支持第三期多孩子账号扩展
6. THE MVP 的用户界面 SHALL 仅展示第一期范围内的功能，不提供语文阅读理解、英语跟读评分、数学多步骤文字应用题、家长报告与多孩子账号的功能入口
7. IF Question_Bank 中存在第二期题型（语文阅读理解、英语跟读评分、数学多步骤文字应用题）的题目，THEN THE Learning_System SHALL 跳过该题目，不将其排入 Today_Session
8. THE MVP 的内置 Question_Bank 种子内容 SHALL 仅覆盖三年级与四年级（语文为人教版三四年级、数学为三四年级、英语为外研版三四年级），Question_Bank 结构 SHALL 支持后续扩充其他年级

