# 抽取 Wiki 调试过程

更新时间：2026-04-18

## 0. 背景与目标
当前项目在复杂医学指南文档上出现两个核心问题：
1. 页面能生成，但关系层质量不稳定。
2. 早期版本会触发 `Quality gate failed: too many auto stubs`，导致任务失败。

本次目标：
1. 不引入重型图数据库。
2. 在现有管线上接入轻量图谱 sidecar（`.llm-wiki/graph.json`）。
3. 先保证“关系不丢失、可追溯、可持续优化”。

---

## 1. 问题定位（本轮）
### 1.1 现象
一次 ingest 返回：
- `3 files written, 39 links fixed, 0 stubs created, 17 unresolved captured`

但用户观察到：
- 三个页面（1 source + 2 entities）之间没有形成稳定关系网络。

### 1.2 核心原因
1. `replaceUnresolvedWithText=true` 时，未解析 `[[...]]` 会被替换成纯文本，关系信息丢失。
2. 轻图谱最初只从正文 `wikilink` 抽边，不读取 frontmatter `related`。
3. unresolved 候选边在部分场景下因 source 节点键不匹配（如 `_processed` 命名差异）未能挂接。

---

## 2. 方案决策
采用“轻量图谱 + 非破坏性链接修复”策略：
1. 禁用自动 stub（避免伪页面膨胀）。
2. unresolved 不降级成纯文本（保留关系线索）。
3. 从 `wikilink + frontmatter.related` 双来源建边。
4. unresolved 统一沉淀为 candidate edges，并记录 evidence。
5. 修复 source 节点锚定逻辑，避免候选边丢挂。

---

## 3. 实施记录
### 3.1 改造 auto-link-repair（策略可配置）
文件：`apps/web/src/lib/auto-link-repair.ts`

新增：
1. `AutoLinkRepairOptions`：
   - `createStubs?: boolean`
   - `replaceUnresolvedWithText?: boolean`
2. `autoRepairWikiLinks()` 支持按选项运行：
   - 可关闭 stub 生成。
   - 可选择是否将 unresolved link 降级为文本。

目的：
1. 将“修复策略”从硬编码变为可控配置。
2. 为后续不同阶段的策略切换提供基础。

### 3.2 新增轻量图谱模块
文件：`apps/web/src/lib/light-graph.ts`

新增能力：
1. sidecar 图谱存储：`.llm-wiki/graph.json`
2. 数据结构：
   - `nodes`
   - `edges`
   - `evidence`
3. 入图逻辑：
   - 解析正文 `wikilink`
   - 解析 frontmatter `related`
   - unresolved 写入 candidate edges
4. source 节点锚定增强：
   - 支持 `_processed` 命名差异候选匹配
   - source 节点缺失时自动创建 fallback source node

目的：
1. 不依赖重型图数据库，快速落地关系层。
2. 让关系沉淀从“靠页面链接”升级为“有结构、有证据”。

### 3.3 接入 ingest 主流程
文件：`apps/web/src/lib/ingest.ts`

改动：
1. ingest 后调用 `autoRepairWikiLinks()` 时设置：
   - `createStubs: false`
   - `replaceUnresolvedWithText: false`
2. 写入后调用 `mergeLiteGraphFromIngest()`，同步 nodes/edges/evidence。
3. 在 Activity detail 中输出：
   - unresolved captured
   - graph candidate 计数

目的：
1. 避免关系信息被“文本降级”吞掉。
2. 让每次 ingest 都有关系层增量沉淀。

---

## 4. 验证记录
已执行：
1. `npm run build`（apps/web）

结果：
1. TypeScript 编译通过。
2. Vite build 通过。

说明：
1. 代码层面无类型错误和构建阻塞。
2. 业务层仍需继续以真实文档做回归验证（重点看 `graph.json` 的 edges/evidence 持续增长）。

---

## 5. 当前状态判断
已解决：
1. “自动 stub 导致失败”的主路径。
2. unresolved 关系直接丢失的问题。
3. source 节点挂接不稳定的问题（通过候选匹配 + fallback 节点）。

仍需继续优化：
1. 关系语义仍以 `mentions` 为主，缺少更细粒度关系类型（如 causes/treats/complicates）。
2. alias 归一规则仍偏轻量，医学术语缩写与同义表达仍有提升空间。
3. 需增加自动评估指标与回归基线（confirmed ratio、candidate ratio、unresolved rate）。

---

## 6. 下一步计划（建议）
1. 引入“页面计划器”（先计划后生成）降低漏页率。
2. 增加 frontmatter `aliases` 的自动补全策略，提高实体归一命中率。
3. 给图谱加一个只读调试视图（节点、边、证据三联展示），提升调试效率。

---

## 7. 端到端实测回归（2026-04-16）
### 7.1 实测步骤
1. 启动前后端并验证接口连通性。
2. 通过 `POST /api/llm/chat` 实测 MiniMax：
   - provider=`minimax`
   - endpoint=`https://api.minimaxi.com/anthropic`
   - model=`MiniMax-M2.7`
   - 返回 `minimax-ok`，说明 key/endpoint 可用。
3. 在前端导入同名文件时，系统提示“跳过同名文件”。
4. 在未配置 LLM 时导入新文件，提示“未自动入队（缺少 API Key/Provider）”。
5. 配置 Settings 后再次导入新文件（`..._processed_e2e2.md`），自动入队成功并触发 ingest。

### 7.2 本轮关键现象
1. 旧失败任务仍在队列中：`Quality gate failed: too many auto stubs (10)`。
2. 新任务最终失败为：`Quality gate failed: templated fenced-frontmatter detected in 3 page(s)`。
3. 失败后生成内容未回滚，wiki 中新增/覆盖了页面（包含模板化内容）。

### 7.3 失败根因（本轮新增）
质量门禁命中“fenced frontmatter”并非偶然噪声，而是模型输出形态问题：
1. 页面顶部已经有规范 frontmatter（系统归一化注入）。
2. 页面正文中又出现一段：
   - ```yaml
   - ---
   - type/title/related/sources...
   - ---
   - ```
3. 这会导致“同一页面双 frontmatter（正文内模板残留）”，触发质量门禁。

### 7.4 结构化指标快照
项目：`backend/projects/first-wiki`
1. `ingest-queue.json`：
   - 1 个历史失败（auto stubs）。
   - 1 个本轮失败（templated fenced-frontmatter）。
2. `graph.json`：
   - nodes = 20
   - edges = 0
   - evidence = 0
3. `source -> entity` 关系边数量 = 0（关系层未形成）。

### 7.5 结论
1. MiniMax 接入链路已可用（不是 key 问题）。
2. 当前主阻断点是“生成质量门禁 + 失败后页面残留”。
3. 在该问题未修复前，图谱层会持续缺边（`edges=0`），关系质量无法提升。

---

## 8. 本质修复实现（2026-04-16）
针对“页面有实体但没关系”的根因（模型链接漂移、`related` 空置、图层仅依赖 wikilink），本轮完成三项结构性改造：

### 8.1 轻图谱增加“正文提及关系抽取”（不依赖 `[[link]]`）
文件：`apps/web/src/lib/light-graph.ts`

改动：
1. 在 `mergeLiteGraphFromIngest()` 增加正文 mention 扫描：
   - 对已存在页面节点提取可用别名（title/baseName/aliases）。
   - 在正文中匹配别名命中后，写入 `confirmed` 边并附 evidence 片段。
2. 抽边上限控制（每页最多 24 条 mention 边），避免噪声爆炸。

价值：
1. 即使模型写出错误 slug（如拼音）或未写 wikilink，关系仍可由正文语义提及恢复。
2. 关系层不再单点依赖“模型链接格式正确”。

### 8.2 新增 `syncRelatedFromLiteGraph()`：图到页面的确定性回填
文件：`apps/web/src/lib/light-graph.ts`

改动：
1. 新增 `syncRelatedFromLiteGraph(projectPath, writtenPaths)`。
2. 将图中 confirmed 边按置信度/证据数排序，回填到页面 frontmatter `related`。
3. 与已有 `related` 做并集，统一为规范 inline YAML 列表。

价值：
1. 页面关系由程序确定性生成，不再依赖模型是否主动写 `related`。
2. Graph 与 Markdown 的关系数据保持一致。

### 8.3 Graph 视图改为“wikilink + related”双通道建边
文件：`apps/web/src/lib/wiki-graph.ts`

改动：
1. 新增 frontmatter 数组解析，读取 `related`。
2. 建图时将 `links + related` 统一作为候选边。
3. `resolveTarget()` 增强：支持 `entities/xxx` 这类路径式 target 的 basename 解析。

价值：
1. 即使正文 wikilink 缺失，只要 `related` 回填成功，图视图也能稳定展示关系。
2. 关系展示与存储一致，避免“graph 有边但 UI 无边”。

### 8.4 ingest 主流程接入回填闭环
文件：`apps/web/src/lib/ingest.ts`

改动：
1. 在 `mergeLiteGraphFromIngest()` 后调用 `syncRelatedFromLiteGraph()`。
2. Activity detail 新增 `related synced N page(s)` 指标。
3. chat 驱动写入流程也接入同样闭环。

结果：
1. 形成“写页面 -> 入图 -> 回填 related -> 图展示”的闭环。
2. 关系抽取从“模型自由生成”升级为“程序主导的结构化沉淀”。

---

## 9. Graph-first 编译管线上线（2026-04-17）
本轮不是继续补丁，而是把 ingest 主链路改成“结构化抽取 -> 编译输出”。

### 9.1 新增结构化抽取协议
文件：
1. `apps/web/src/lib/ingest-prompts.ts`
2. `apps/web/src/lib/graph-first-ingest.ts`

改动：
1. 新增 `buildGraphExtractionPrompt()`，强制 LLM 返回严格 JSON（`source/nodes/edges/open_questions`）。
2. 新增 `parseStructuredExtractionResponse()`：
   - 支持 code fence JSON 提取；
   - 兼容 `nodes/entities/concepts` 与 `edges/relations/triples` 多种字段；
   - 做节点去重、别名归一、关系规范化、置信度归一；
   - 在显式关系缺失时，基于节点摘要做 mention 推断补边。

价值：
1. 将“模型直接写 Markdown”改为“模型只负责结构化抽取”。
2. 输出边界清晰，可校验、可回放、可持续优化。

### 9.2 新增确定性 Wiki 编译器
文件：
1. `apps/web/src/lib/graph-first-ingest.ts`

改动：
1. 新增 `compileStructuredGraphToWiki()`：
   - 固定输出 `wiki/sources|entities|concepts`；
   - frontmatter 统一写入 `type/title/created/updated/tags/related/sources/aliases`；
   - `related` 来自关系图计算，不依赖模型临场发挥；
   - 正文关系节带 `relation + confidence`；
   - Source 页自动汇总实体、概念和主要关系。

价值：
1. 从根因消除“跑到 Other 目录”的不确定性。
2. 关系字段由程序控制，避免“有页无关系”。

### 9.3 ingest 主流程改造
文件：
1. `apps/web/src/lib/ingest.ts`

改动：
1. `autoIngest` 改为两步：
   - Step 1: Extract structured graph
   - Step 2: Compile wiki pages
2. 新增 `writeCompiledFiles()` 事务式写入。
3. 新增 `pruneStaleSourcePages()`：
   - 同一来源旧页面若不再产出且仅绑定该来源，会自动删除，避免历史脏页残留。
4. 新增 `upsertSupplementalPages()`：
   - 自动重建 `wiki/index.md`；
   - 自动追加 `wiki/log.md`；
   - 自动更新 `wiki/overview.md`（不存在则创建，存在则追加更新块）。
5. unresolved 统一合并进入轻图谱候选池，保持后续治理入口一致。

价值：
1. 把“多次重跑导致旧脏页叠加”改为“每次 ingest 收敛到当前结构”。
2. 让索引/日志与页面产物保持同步。

### 9.4 验证
本轮已通过：
1. `npm run test`（新增 `graph-first-ingest` 单测）。
2. `npm run build`（TypeScript + Vite 构建通过）。

---

## 10. P0 语义治理落地（2026-04-17）
本轮针对“方向反了、噪声边太多、related 脏数据”的核心问题，完成第一阶段本质修复。

### 10.1 关系本体与方向校验
文件：
1. `apps/web/src/lib/graph-first-ingest.ts`

改动：
1. 新增关系标准化：`causes/treats/diagnoses_treats/complication_of/sequela_of/may_progress_to/associated_with`。
2. 新增节点语义分类（pathogen/drug/procedure/disease/complication/severity_stage/...）。
3. 新增关系合法性校验（domain/range）与自动反向纠正：
   - 若正向不合法、反向合法，自动反转；
   - `may_progress_to` 按严重度分值纠偏方向；
   - `complication_of/sequela_of` 发生双向冲突时保留更合理方向。

效果：
1. `may_progress_to` 和 `complication_of` 的反向错误显著降低。

### 10.2 低置信噪声边降噪
文件：
1. `apps/web/src/lib/graph-first-ingest.ts`

改动：
1. 将不满足本体约束的关系降级为 `associated_with`。
2. 对 `associated_with` 启用严格门槛（低置信直接丢弃）。
3. 编译页面时不再双向重复写同一关系文本。

效果：
1. 页面关系区不再被大量 `associated_with(45%)` 淹没。
2. Source/Concept 页关系更接近“可解释知识关系”。

### 10.3 related 字段规范化
文件：
1. `apps/web/src/lib/light-graph.ts`

改动：
1. `syncRelatedFromLiteGraph()` 改为只使用图谱确认边回填 `related`。
2. 不再与旧 frontmatter 裸词并集合并。

效果：
1. `related` 从“路径+裸词混杂”收敛到“规范路径列表”。

### 10.4 文件命名一致性
文件：
1. `apps/web/src/lib/graph-first-ingest.ts`

改动：
1. slug 生成时统一 ASCII 小写（避免 `G/g` 导致跨平台链接不一致）。

### 10.5 验证
本轮验证通过：
1. `npm run test`：`3 files, 10 tests passed`
2. `npm run build`：通过

---

## 11. Schema-first 架构重构（2026-04-18）
本轮目标：不再继续“规则补丁式”修复，而是将 ingest 主链路拆成独立阶段，形成稳定的数据契约与质量门。

### 11.1 阶段拆分：解析候选图 vs 规范化图
文件：
1. `apps/web/src/lib/graph-first-ingest.ts`

改动：
1. 新增 `parseStructuredExtractionCandidate()`：
   - 只负责 JSON 解析与字段映射（`source/nodes/edges/openQuestions/unresolved`）。
   - 不在这一层做语义纠偏。
2. 新增 `normalizeStructuredExtraction()`：
   - 统一做节点归一、类型推断、关系方向校验、冲突去重与截断。
3. 保留 `parseStructuredExtractionResponse()` 作为兼容入口（内部串联上述两层）。

价值：
1. 把“抽取是否可解析”和“抽取是否语义正确”解耦。
2. 后续可单独替换某一层而不影响另一层。

### 11.2 新增图质量门（Graph Quality Gate）
文件：
1. `apps/web/src/lib/graph-first-ingest.ts`

改动：
1. 新增 `runStructuredGraphQualityGate()`，输出结构化质量报告（issues + metrics）。
2. 质量指标包括：
   - 节点/边数量；
   - `associated_with` 比例；
   - 孤立节点比例；
   - entity/concept 分布。
3. 错误级问题（error）与警告级问题（warning）分离。

价值：
1. ingest 失败不再依赖零散字符串判断，而是基于结构化质量结果。
2. 为后续引入回归基线（不同文档类型）打下基础。

### 11.3 新增统一编排器（Pipeline Orchestrator）
文件：
1. `apps/web/src/lib/structured-ingest-pipeline.ts`

改动：
1. 新增 `runStructuredIngestPipeline()`：
   - parse candidate -> normalize extraction -> quality gate -> compile wiki。
2. 新增 `summarizeStructuredQualityErrors()` 用于入口层统一报错。

价值：
1. 主流程由“散落函数调用”改为“单一编排入口”。
2. 便于后续插入更多阶段（例如 schema 版本迁移、术语对齐器）。

### 11.4 autoIngest 接入新管线
文件：
1. `apps/web/src/lib/ingest.ts`

改动：
1. `parseStructuredWithRepair()` 改为“仅保证可解析 JSON”，返回 JSON 字符串。
2. `autoIngest()` 使用 `runStructuredIngestPipeline()` 获取规范化结果与质量报告。
3. 若图质量门存在 error，直接 fail-fast，不进入写盘阶段。
4. 新增 pipeline 报告落盘：
   - `.llm-wiki/ingest-reports/<source>.latest.json`

价值：
1. 从“写完再回滚”转向“先校验再写入”，降低脏写概率。
2. 每次 ingest 都有可审计的结构化诊断快照，便于复盘和视频演示。

### 11.5 验证
本轮验证通过：
1. `npm run test`：`3 files, 13 tests passed`
2. `npm run build`：通过
