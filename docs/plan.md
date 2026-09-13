# 执行步骤（分步开发计划）

> 原则：**增量推进，一次只做一个步骤**。每步完成后本地验证通过，再进下一步，保证项目稳定、安全、有效推进。

## Step 0 — 项目初始化（已完成）

- 创建 `docs/` 标准文档、`dev-logs/` 开发日志、`CLAUDE.md` 工作约定
- 明确需求、技术、设计、执行步骤

## Step 1 — 前端骨架 + 设计落地（已完成）

- **目标**：搭出 5 个页面的静态 UI（蛋墙 / 领养 / 蛋主页 / 课程详情 / 复习），用假数据
- **产出**：前端项目骨架 + 5 页静态页面 + 知乎风格设计规范落地
- **验证**：本地打开能看到 5 个页面、能互相跳转、样式符合 `docs/design.md`
- **补充**：气泡墙 + 按 `design/2.md` 重构；经济系统统一为「金币」

## Step 2 — 后端 + 知乎登录（已完成 · 待真实凭证联调）

- **目标**：后端跑起来，完成 OAuth 登录，登录后显示用户昵称头像
- **产出**：
  - `package.json` / `.gitignore` / `.env.example`（凭证模板，无真实值）
  - `server/index.js`（Express：静态页 + API）
  - `server/auth.js`（OAuth 授权/回调/换 Token/取用户信息 + 会话 + state 校验）
  - `server/routes/auth.js`（`/api/auth/login|callback|logout`、`/api/me`）
  - 前端接入登录态（`/api/me` + 登录/退出按钮，后端未启动时回退假数据）
- **验证**：
  - ✅ Mock 模式全流程：未登录 401 → 登录 → `/api/me` 返回用户 → 退出 → 401（9 项 HTTP 检查通过）
  - ✅ state 安全性（7 项）：重复使用、跨会话复用、伪造、缺失、过期、非字符串一律拒绝
  - ✅ `uid` int64 无损解析（4 项）：避免超出安全整数范围导致不同用户塌缩为同一 ID
  - ⏳ **待办**：拿到 App ID / App Key 后，走通真实知乎授权联调（Mock 通过 ≠ 线上通过）

## Step 3 — 读收藏 + 聚类生成蛋（已完成 · 待真实凭证联调）

- **目标**：登录后读用户收藏，AI 聚类成主题蛋，蛋墙显示真实蛋
- **产出**：
  - `server/zhihu.js`：读「近期收藏」（`/api/v1/user/collections`），双凭证 `Authorization: Bearer <Access Secret>` + `X-OAuth-Token`；未配置凭证时用假收藏
  - `server/llm.js`：DeepSeek 聚类（`response_format: json_object`）；未配置 Key 或调用失败 → 降级为**规则聚类**（真实算法，不伪造内容）
  - `server/routes/eggs.js`：`GET /api/eggs`（按用户缓存 30 分钟，`?refresh=1` 强制重算）
  - 前端 `loadEggs()` 拉真实蛋墙；未登录/后端未启动时回退假数据；副标题如实标注数据来源
- **验证**：
  - ✅ 19 项聚类测试：规则聚类、冷启动推荐、LLM 正常返回、```json 围栏容错、重名主题去重、四种失败降级
  - ✅ 接口联调：未登录 401 → 登录 → 返回 6 颗蛋（含 size/tone/count）→ 缓存命中 → 强制刷新
  - ⏳ **待办**：配 `ZHIHU_ACCESS_SECRET` + `DEEPSEEK_API_KEY` 后读真实收藏

## Step 4 — 课程生成（已完成）

- **目标**：点蛋 → 取素材 → DeepSeek 整理成一篇系统课程 → 课程详情页
- **产出**：
  - `server/zhihu.js`：新增 `searchKnowledge()`（`POST /api/v1/knowledge/search`，`RecallScopes:["public"]`），拿知乎公开知识库正文片段
  - `server/llm.js`：新增 `COURSE_SYSTEM` / `generateCourse()` / `buildCourseFallback()`；`sanitizeCourse()` 用**素材 URL 白名单**挡住模型编造的参考链接
  - `server/routes/eggs.js`：新增 `GET /api/eggs/:id/course`，素材优先级「知识库检索 > 用户收藏」自动降级，内存缓存（`?refresh=1` 可绕过）
  - `public/js/app.js`：课程详情页改渲染后端真实课程；外部文本一律转义，参考链接只认 `http(s)`
  - `tests/course.test.js`（新增）：18 项，打桩 DeepSeek 不联网
- **验证**：
  - ✅ `npm test` 39/39 通过（game 21 + course 18）
  - ✅ 真实 DeepSeek：`/api/eggs/1/course` 返回 5 节《Python 入门到实用小工具》，`/api/eggs/2/course` 返回《心理学认知入门》——课程随主题变化，refs 全部来自素材
  - ✅ 缓存命中 / 未登录 401 / 他人蛋 404
  - ✅ **知识库检索主路径已通**（配好 `ZHIHU_ACCESS_SECRET` 后）：`source: 'knowledge'`、`mock: false`，素材为真实知识库正文，参考来源为真实知乎链接
  - ✅ 修复验证中发现的 2 个 bug：签名临时链接混进参考来源（会失效）、同一文档被重复召回
  - ⏳ **待办**：读真实收藏仍需 OAuth App ID / App Key

## Step 4.1 — 课程改为「0→1 分阶段学习计划」（已完成）

- **目标**：把课程从「概述 + 知识点分节」的平铺罗列，改成按学习顺序排出的递进阶段，读者照着从上往下走就能从零到能动手
- **依据**：`design/学习计划_通用模板.md` + `design/学习计划_配置指南.md`
- **范围**：核心版——分阶段课程 + 一句话核心原则 + 参考来源；复习卡片 / 艾宾浩斯节奏 / 进度表留到 Step 5.2
- **产出**：
  - `server/llm.js`：`COURSE_SYSTEM` 重写（阶段结构 + 三个排阶段维度：认知深度递进 / 行动门槛递进 / 主题匹配）；`sanitizeCourse()` 校验 `stages` 且**文章也走 URL 白名单**；`buildCourseFallback()` 产出同结构，素材按连续段切分保留相关性顺序
  - `public/js/app.js`：`renderCourse()` 阶段式渲染 + 行动任务复选框（存 `localStorage`）
  - `public/css/style.css`：`.stage` / `.stage-why` / `.task` 样式
  - `tests/course.test.js`：按新结构重写并新增断言
- **明确不做**：「赞同×1 + 评论×2」加权筛选 —— 知识库检索接口**不返回点赞/评论数据**，用户明确不据此筛
- **验证**：
  - ✅ `npm test` 48/48 通过
  - ✅ HTTP 走查（真实 DeepSeek + 真实知识库）：三颗蛋均返回 4 阶段计划、`refs` 无签名临时链接、无旧字段
  - ⏳ **待办**：浏览器点一遍（阶段排版、行动任务勾选后刷新保留）

## Step 4.2 — 课程详情按设计稿拆解：6 节课卡片 + 单节课详情页（已完成）

- **目标**：按 `design/5.png` 把课程详情从「一页连续长文」改为「6 张课卡的网格 + 单节课详情页」两层
- **产出**：
  - `server/llm.js`：数据结构 `stages`（3~5）→ `lessons`（固定 6，`MAX_LESSONS`）；`COURSE_SYSTEM` 改为要求 6 节课；`FALLBACK_LESSONS` 六档；`sanitizeCourse` 同步
  - `public/index.html`：新增 `#view-lesson` 单节课页
  - `public/js/app.js`：`renderCourse` 改课卡网格；新增 `openLesson` / `renderLesson`；`goBack` 加 `course` 分支
  - `public/css/style.css`：`.lesson-grid` / `.lesson-card` / `.lesson-card--lg` / `.doc-foot--split`
  - `tests/course.test.js`：按 `lessons` 更新 + 新增节数相关断言
- **范围外**：养成数值仍是**课程级**（+30 金币一次性，不按节计费）；单节课完成状态不上报后端
- **验证**：
  - ✅ `npm test` 51/51 通过
  - ✅ HTTP 走查（真实 DeepSeek + 真实知识库）：两颗蛋均返回 6 节、字段完整、无旧字段；课程级计费与 401/404 不变
  - ⏳ **待办**：浏览器点一遍（课卡网格排布、点卡进单节课、上/下一节边界、勾选后刷新保留）

## Step 5.1 — 核心养成链路 + 持久化（已完成）

- **目标**：把金币 / 苹果 / 水滴 / 成长值从内存搬进数据库，后端成为数值唯一权威
- **产出**：
  - `server/db.js`（新增）：Node 内置 `node:sqlite`（零原生依赖），`eggs` 表存「定义 + 养成进度」
  - `server/routes/eggs.js`（改造）：规则常量集中 + 新增 adopt / feed / exchange / course-done / quiz / 单个蛋查询；每个 `:id` 校验归属，不属于自己一律 404
  - `public/js/app.js`（改造）：新增 `api()` / `applyEgg()`，经济动作全部改为调后端
  - `tests/game.test.js`（新增）：21 项端到端断言
- **验证**：`npm test` 21/21 通过；HTTP 走查全链路通过；**重启进程后数据仍在**

## Step 5.2 — 养成闭环补全（待办）

- **目标**：复习题接真实课程内容、换装计费与持久化、会话持久化
- **产出（接 Step 4.1 的分阶段计划）**：
  - **复习卡片**：每阶段抽「核心概念 / Q&A / 我的行动」三类卡片，接真实课程内容
  - **艾宾浩斯复习节奏**：按 +1 / +3 / +7 / +21 天排复习时间点，到点提示
  - **进度追踪表**：行动任务勾选从 `localStorage` 搬到后端落库（现在只存前端，换设备就没了）
  - 学习者画像参数化（当前固定「0 基础入门」）
- **验证**：复习题与所学课程对应；换装配色刷新后不丢；服务重启后无需重新登录；行动任务勾选跨设备一致

## Step 5.3 — 全站像素风视觉改版（已完成）

- **目标**：把前端从知乎风格（`design/2.md`）整体改为**像素/复古游戏风**（`design/6.png` + `design/7.png`），全部页面统一
- **产出**：
  - `public/index.html`：新增 `#view-splash` 开屏；蛋主页顶栏改「我的宠物」；分区改「今天要做什么？」+ 4 个像素气泡卡（课程/复习/徽章/探索）
  - `public/css/style.css`：Token 整套换像素风（直角 / 深描边 / 硬投影 / 等宽字体 / 天空→海渐变），全组件重绘
  - `public/js/app.js`：新增 `eggSVG(tone)` 内联 SVG 蛋 sprite；开屏门控（`sessionStorage`）；气泡按 tone 上色；`switchTab` 支持 4 分区
  - `docs/design.md`：整篇重写为像素风规范（`design/2.md` 降级为历史版本）
- **约束**：**纯 CSS + 内联 SVG 手作**，不使用任何外部图片 / 精灵图 / webfont / 网络资源
- **范围外**：开屏多页轮播（只做单页，「1/6」仅装饰）；换装的像素外观集；后端与数值一律不动
- **验证**：
  - ✅ `node --check public/js/app.js` 语法通过
  - ✅ `npm test` 51/51（未触碰 server/tests）
  - ✅ 静态检查：`public/` 下无任何外部 URL / `<img>` / webfont / `url()` 引用
  - ✅ 8 屏截图逐屏走查（CDP 无头 Chrome）：像素风统一、蛋 sprite 随 tone 换色、苹果文案不变、开屏刷新后不重复出现
  - ✅ 键盘走查：全部交互元素有可见的焦点描边
  - ✅ `prefers-reduced-motion` 命中时动效关闭
  - ⏳ **待办**：用户自己在浏览器里点一遍

## Step 6 — 部署上线 + 验收

- **目标**：部署到公网，走通完整流程，准备提交材料
- **产出**：线上可访问 Demo + 产品说明
- **验证**：公网打开、登录、领养、学课程、复习、养成全流程可用
