# 知乎黑客松「蛋养学习」游戏

帮助知乎用户把「收藏」变成「学习」的游戏化学习工具：用户收藏被 AI 聚类成「蛋」（兴趣主题），领养蛋后通过学课程、复习赚资源喂蛋成长，对抗「收藏即遗忘」。

## 关键文件路径

- 需求文档：`docs/requirements.md`
- 技术方案：`docs/tech.md`
- 设计规范：`docs/design.md`
- 执行步骤：`docs/plan.md`
- 文档索引：`docs/README.md`
- 开发日志：`dev-logs/YYYY-MM-DD.md`（每天一份，记录「已完成事项」和「待办事项」）

## 工作约定

1. **增量开发**：严格按 `docs/plan.md` 的分步计划推进，一次只做一个步骤，不一口气做完。
2. **每步验证**：完成一个步骤后，先本地验证通过，再进入下一步。
3. **日志先行**：每个开发日先在 `dev-logs/` 新建当天的日志文件，记录「已完成」和「待办」。
4. **安全**：App Key、Access Secret、OAuth Token、LLM API Key 一律放后端环境变量，绝不进入前端代码、Git 仓库、日志或回复。
5. **文档同步**：需求/设计/技术变更时，先更新 `docs/` 对应文档，再改代码，保持文档与实现一致。
6. **凭证不外泄**：不把 Access Secret 等凭证打印到输出或写入文件。

## 本地运行

```bash
cp .env.example .env   # 填入真实凭证；不填则登录走 Mock（仅开发）
npm install
npm run dev            # http://localhost:3000
```

## 参考

- 知乎开放平台能力见 `~/.claude/skills/zhihu/`（zhihu-cli Skill，含知识库、用户数据、黑客松接口文档）
  - OAuth 接入：`references/hackathon-oauth.md`、`references/oauth.md`、`references/hackathon-user-profile-api.md`
- 参赛信息：知乎黑客松 2026「校园新锐季」，作品提交截止 2026-09-15 10:00
