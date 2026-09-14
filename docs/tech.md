# 技术方案（细化版）

## 当前课程约定：收藏摘要 Map-Reduce

- 本节取代此前混合知识库课程。每颗蛋只使用对应主题的收藏摘要：先逐篇提取知识点，再整合成 6 节 0→1 课程，参考来源集中置于末尾。
- 聚类保存 URL/标题的 SHA-256 成员标识用于课程归属。旧主题仅使用规则匹配或已有原文证据，无关帖子不补齐。
- 当前接口只有标题与摘要。有 AI 时逐篇总结摘要、校验 sourceId；无 AI 或输出不完整时回退该帖原摘要，明确标注，缺少摘要时显示空状态。
- 缓存随收藏同步时间失效，首页刷新清除前端课程缓存，课程页可主动重新整理。

## 收藏驱动学习更新（2026-09-14）

- 新主题与历史已领养蛋分开展示，聚类版本变化时重新读取；取消兜底大杂烩。主题保存成员链接的摘要值，不保存整批收藏正文。
- 课程必须先取得本主题对应的收藏；不调用公共知识库补充，收藏读取失败不得静默生成与收藏无关的课程。缓存随收藏更新时间失效。
- 从可用标题/摘要提取可核验的原句、院校线索、面试相关句及 HTTP(S) 资源链接。摘要不等于全文；未出现的信息不补写，不将少量帖子称为统计意义上的高频题。提取结果附来源。
- 复习从本课程收藏摘录生成填空选择题，后端判分；移除客户端自报 correct 路径，校验选项及试卷有效期，在事务内结算并执行每日额度。
- 外观阶段：Lv.1 完整蛋、Lv.2 裂纹、Lv.3 破壳、Lv.4+ 成长；前端每次收到等级更新后重绘，不改变现有升级数值。

## 收藏气泡修复（2026-09-13，本节取代旧版收藏来源描述）

- 范围：当前 OAuth 用户的公开范围近期收藏，最多 50 条，无分页，不代表完整收藏历史。
- 真实会话缺少凭证或接口失败必须报错；只有明确的开发 Mock 会话可使用示例收藏。
- 首页显示读取时间、条数、实际聚类方式和缓存来源；每个新主题展示命中条数和最多一条来源标题/链接，不保存完整收藏或摘要。
- 无 AI 时按标题关键词匹配，优先最长的具体匹配（如“概率论”“AI Coding”），主题按命中条数排序；未匹配内容以原收藏标题分组，最多 6 组，末组归为“其他近期收藏”，不再填充固定推荐。空数据返回空墙，保留已领养蛋并标明历史来源。
- 聚类结果与来源元信息在同一 SQLite 事务保存。失败保持上次成功结果；同一用户并发刷新合并。旧数据无来源记录时标为待核验。
- 复习安全与设计稿还原在后续步骤处理，本次不宣称已完成。

## 1. 技术栈（最终）

### MVP 课程范围（2026-09-15）

当前为 AI、财务/金融、学习与考试、生活与健康主题生成 0→1 课程和复习题。其他收藏主题继续展示分类、数量和来源证据，但课程接口返回“暂未获取到课程”。范围判断由后端统一执行，前端不能绕过。知乎收藏接口只返回标题、摘要和链接，不提供任意收藏帖全文，因此课程不把摘要冒充正文，也不默认检索公共知识库。

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | 原生 HTML + CSS + JS，单页应用 | 视图用 JS 切换，**无构建工具**，部署最简单；视觉为**像素风**，纯 CSS + 内联 SVG 手作，无外部图片/webfont |
| 后端 | Node.js + Express | 同一服务提供静态页 + JSON API |
| 数据库 | SQLite（`node:sqlite`，Node 内置） | 单文件，存蛋/进度，无需额外服务；**零原生依赖、零编译**，避免 Render 免费套餐上原生模块编译失败。要求 Node ≥ 22.5 |
| LLM | DeepSeek（`deepseek-chat`）✅ 已选定 | 做聚类/整理/出题，便宜、中文好、注册即得 |
| 部署 | Render（Node + 持久化磁盘） | Step 6 落地，公网可访问 |

## 2. 项目结构

```
miwusenlin/
├── CLAUDE.md
├── docs/                 # 标准文档
├── dev-logs/             # 开发日志
├── package.json          # 后端依赖
├── .env                  # 凭证（不提交）
├── .gitignore
├── server/
│   ├── index.js          # Express 入口：静态页 + 挂路由
│   ├── auth.js           # 知乎 OAuth（授权/回调/会话）
│   ├── zhihu.js          # 调用户数据 API + 知识库 API
│   ├── llm.js            # LLM 三步流水线（聚类/整理/出题）
│   ├── db.js             # SQLite 初始化 + 查询
│   └── routes/
│       ├── auth.js       # /api/auth/*
│       └── eggs.js       # /api/eggs/*
└── public/               # 前端静态文件
    ├── index.html        # 单页，视图容器（开屏 / 蛋墙 / 领养 / 蛋主页 / 课程 / 单节课 / 复习 / 兑换）
    ├── css/style.css     # 像素风设计规范落地（纯 CSS，无外部资源）
    └── js/app.js         # 视图切换 + 状态 + 调 API + 内联 SVG 绘制（蛋 sprite）
```

## 3. 后端 API 设计

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/` | 前端静态页 |
| GET | `/api/auth/login` | 跳知乎 OAuth 授权 |
| GET | `/api/auth/callback` | OAuth 回调：换 token、建会话 |
| GET | `/api/auth/logout` | 退出登录 |
| GET | `/api/me` | 当前用户信息（昵称/头像） |
| GET | `/api/eggs` | 我的蛋列表（读收藏 + 聚类，含每颗蛋的游戏状态） |
| POST | `/api/eggs/:id/adopt` | 领养蛋（幂等；首次领养发放新手礼包 50 金币 + 1 苹果 + 1 水滴） |
| GET | `/api/eggs/:id` | 单颗蛋状态（金币/苹果/水滴/成长/等级/进度） |
| GET | `/api/eggs/:id/course` | 该蛋的收藏专属课程（逐篇摘要 Map → 6 节课 Reduce；无模型时规则降级） |
| GET | `/api/eggs/:id/quiz` | 复习自测题（AI 出题） |
| POST | `/api/eggs/:id/feed` | 喂蛋 `{type: "apple"\|"water"}`，消耗 1 个对应资源 |
| POST | `/api/eggs/:id/exchange` | 金币兑换 `{item: "apple"\|"water"}` |
| POST | `/api/eggs/:id/course-done` | 标记课程学完，一次性 +30 金币 |
| POST | `/api/eggs/:id/quiz` | 提交 `{attemptId, answers}`；后端判分、原子结算、重复请求幂等 |

### 3.1 数值权威与鉴权

- **后端是数值的唯一权威**：客户端提交操作和答题选项，不接受自报成绩。复习试卷保存于 SQLite `quiz_attempts`，只向浏览器下发题干/选项；答案在结算后返回。试卷 24 小时有效，按用户和蛋隔离，同一未完成试卷可恢复。`quiz_daily` 记录北京时间当日最高成绩，仅奖励提升部分；成绩、金币、结算结果在同一个事务中写入。
- 每个 `:id` 路由先查该行 `user_id` 是否等于会话 uid，不匹配返回 **404**（不泄露资源是否存在）

## 4. 数据模型（SQLite）

```sql
eggs (id INTEGER PK AUTOINCREMENT, user_id TEXT, theme TEXT, desc TEXT,
      size TEXT, tone INT, count INT, source TEXT,
      adopted INT, coins INT, apples INT, water INT, growth INT, level INT,
      course_done INT, quiz_correct INT, created_at TEXT, updated_at TEXT,
      UNIQUE(user_id, theme))
```

- `coins`：唯一产出资源，学课程 / 复习获得（原 `xp`，已改名为金币并赋予购买力）
- `apples` / `water`：喂养资源，由 `coins` 兑换得到
- **`eggs` 表同时承担蛋的定义与养成进度**：首次聚类生成时按 `(user_id, theme)` 落库，`?refresh=1` 重新聚类时走 upsert，**只更新主题元信息（desc/size/tone/count），不动游戏状态列**，因此刷新不会重置玩家进度
- `users` / `progress` 两张表暂未拆出：昵称头像由会话持有，`course_done` / `quiz_correct` 直接并入 `eggs`（一颗蛋对应一套进度）。后续如要跨蛋统计再拆表

## 5. AI 流水线（三步，均在后端，可缓存）

1. **聚类蛋**：LLM 输入「收藏标题 + 摘要」→ 输出 JSON（3–6 个主题名）
2. **Map**：逐篇收藏摘要提取知识点与结论（`generateCollectionCourse()`）
3. **Reduce**：Map 结果 → 输出 JSON **6 节课的 0→1 课程**（`generateCourse()`）

   ```
   { title, principle,
     lessons: [ { name, goal, reason,
                  articles: [ { title, url, why } ],   // url 仅允许取自素材
                  actions: [ "行动1", "行动2" ] } ],   // 固定 6 节
     refs: [ { title, url } ] }                         // 仅长期有效链接
   ```

   - **排课的三个维度**（来自 `design/学习计划_通用模板.md`）：
     1. **认知深度递进**：知道是什么 → 能动手做，前面的课是后面的课的基础
     2. **行动门槛递进**：越靠前行动成本越低（纯阅读认知 → 动手实践 → 持续投入）
     3. **主题匹配**：每节课安排的文章，其内容主题要与该节课目标一致
   - 每节课带 `reason`（为什么排在这里）与 `articles[].why`（为什么选这篇）；`actions` 是可勾选的行动任务，前端存 `localStorage`，暂不上报后端
   - **节数固定 6**（`MAX_LESSONS`），与前端课卡网格的 6 张卡一一对应；模型给多了截断到 6
   - **不做「赞同×1+评论×2」加权筛选**：`/api/v1/knowledge/search` 只返回 `Content[]` / `DocName` / `OriginUrl` / `KnowledgeBaseID` / `RecallContentID`，**没有点赞评论数据**。改为沿用检索自身的相关性排序 + LLM 按主题匹配度分配阶段
   - **素材来源**：当前蛋的用户收藏（只有标题 + 摘要 + URL）；不调用公共知识库，不读取任意收藏帖全文
   - Map 失败、无模型或收藏无摘要时自动降级为规则课程，链路不中断
   - **文章与参考来源的 URL 只能取自素材，禁止让模型编造 URL** —— 由 `sanitizeCourse()` 的白名单强制：模型给的 URL 命中素材才保留，并把 `title`/`url` 还原成素材原文（顺带救回尾斜杠之类的差异）；对不上的整篇丢弃
   - **参考来源只收长期有效的收藏链接**；模型输出必须命中素材 URL 白名单
3. **出复习题**：课程内容 → 输出 JSON（3 道选择题）

- 结果按「用户 + 主题」缓存，避免重复调用和额度浪费
- LLM 调用失败 → 降级为 `buildCourseFallback()` 的规则课程（同结构、`by:'rules'`）：课节骨架用固定递进档位（`FALLBACK_LESSONS`，也是 6 节），文章一律是真实收藏素材且**保持收藏同步顺序**，不伪造内容

## 6. 安全

### 本地 OAuth 启动检查

直接运行 `node server/index.js`（或 `npm start`）时，若配置了知乎 OAuth，实际服务进程先进行一次无凭证 HTTPS 连通性检查，成功后才监听端口。检查失败时进程退出，不把首页 HTTP 200 当作登录链路正常的证明。该检查不验证密钥，也不代表用户已登录；测试使用 Mock，不访问外网。

本项目曾多次因在受限网络环境中重启 Node 而导致 Token 交换失败。代理重启真实 OAuth 服务必须申请在受限环境外执行，并核对启动日志中的 PID 与端口监听进程一致。不要验证后又用默认受限命令重新启动，也不要关闭 TLS 校验或防火墙。会话和 state 在内存中，重启后需要新授权；所有重启完成后再让用户确认授权。

- 凭证（Access Secret / OAuth App Key / LLM key）放 `.env`，`.gitignore` 忽略
- 浏览器只持有会话 Cookie（HttpOnly），OAuth Token 留服务端
- 收藏数据仅当场用、不长期存；课程保留原文来源

## 7. 需要你准备的外部依赖

| 依赖 | 说明 | 时机 |
|---|---|---|
| LLM API Key | DeepSeek，已选定，注册即得 | Step 4 前 |
| 知乎 OAuth App ID/Key | 赛事页面领取（领取方式需核实） | Step 2 前 |
| 部署账号 | Render / Railway 注册 | Step 6 前 |
