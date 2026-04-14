# LLM Wiki 项目设计文档（Python 后端版）

## 1. 项目目标

### 1.1 背景
我们希望构建一个可以写入简历、具备真实影响力的开源项目，参考 `nashsu/llm_wiki` 的产品形态，但做出可量化的工程差异化能力。

### 1.2 项目一句话定义
`LLM Wiki Studio` 是一个“本地优先、可追溯、可评测”的知识编译系统：把原始资料自动转化为结构化 Wiki，并支持基于证据的问答检索。

### 1.3 成功标准（简历可量化）
- 可在本地对 `>= 1,000` 篇文档做增量编译，支持断点恢复
- 问答结果 `100%` 可追溯来源片段（引用链可视化）
- 内置评测集（>= 50 条 QA）并输出报告（Recall、引用覆盖率、幻觉率）
- 公开 Demo、架构图、性能基准、开源文档齐全

---

## 2. 总体架构

### 2.1 技术栈（Python 后端）
- 前端：`React + TypeScript + Vite`
- 桌面壳：`Tauri`（可选，第一阶段可先 Web）
- 后端：`Python 3.11 + FastAPI + Uvicorn`
- 任务调度：`Celery`（或第一阶段 `RQ/Arq` 简化）
- 数据存储：
  - 元数据：`SQLite`（后续可迁移 PostgreSQL）
  - 向量库：`LanceDB`（或 `FAISS`）
  - 文档资产：本地文件系统
- LLM 接入：OpenAI 兼容接口（可切换多供应商）
- 观测：`structlog + Prometheus`（阶段性引入）

### 2.2 架构分层
1. Ingestion Layer：文档导入、解析、切片、去重、元数据抽取
2. Knowledge Compiler：章节生成、页面生成、索引维护、链接图谱构建
3. Retrieval Layer：关键词检索 + 向量检索 + 重排
4. QA Layer：RAG 回答、引用标注、冲突检测
5. Evaluation Layer：离线评测、对比实验、报告生成
6. UI Layer：Wiki 浏览、知识树、问答面板、引用证据视图

---

## 3. 核心能力设计

### 3.1 文档编译流水线（核心）
输入任意原始资料（pdf/md/txt/html/网页抓取结果），自动生成 Wiki：

1. Parse：提取纯文本 + 文档结构（标题、段落、表格）
2. Normalize：清洗格式、统一编码、语段合并
3. Chunk：语义分块，生成 chunk_id
4. Embed：生成向量并写入向量库
5. Outline：根据主题自动生成目录树
6. Write：按节点写出 `wiki/*.md`
7. Link：生成页内引用和页间跳转
8. Index：更新 `index.md`、`log.md`、`manifest.json`

### 3.2 Evidence-First 回答
回答格式约束：
- 每个关键结论必须附至少 1 个来源 chunk
- 引用字段包含：文档名、页码/段落、chunk_id、置信度
- 若证据冲突，输出“冲突视图”（并列来源）

### 3.3 增量更新与缓存
- 使用 `content_hash` + `parser_version` + `embed_model` 作为缓存键
- 仅重跑受影响节点（避免全量重建）
- 在 `manifest` 维护构建 DAG，支持失败重试

### 3.4 评测系统（影响力关键）
内置 `eval/`：
- 数据集：`qa_eval.jsonl`
- 指标：
  - `answer_recall`
  - `citation_coverage`
  - `hallucination_rate`
  - `latency_p50/p95`
- 输出：`eval_report.md` + `metrics.json`

---

## 4. 目录结构（建议）

```text
LLM_AutoWiki/
├─ apps/
│  ├─ web/                        # React 前端
│  └─ desktop/                    # Tauri 壳（可后置）
├─ backend/
│  ├─ app/
│  │  ├─ main.py                  # FastAPI 入口
│  │  ├─ api/
│  │  │  ├─ ingest.py
│  │  │  ├─ wiki.py
│  │  │  ├─ qa.py
│  │  │  └─ eval.py
│  │  ├─ core/
│  │  │  ├─ config.py
│  │  │  ├─ logging.py
│  │  │  └─ llm_client.py
│  │  ├─ pipeline/
│  │  │  ├─ parser.py
│  │  │  ├─ chunker.py
│  │  │  ├─ compiler.py
│  │  │  └─ indexer.py
│  │  ├─ retrieval/
│  │  │  ├─ lexical.py
│  │  │  ├─ vector.py
│  │  │  ├─ rerank.py
│  │  │  └─ hybrid.py
│  │  ├─ store/
│  │  │  ├─ db.py
│  │  │  ├─ models.py
│  │  │  └─ repositories.py
│  │  └─ workers/
│  │     ├─ celery_app.py
│  │     └─ tasks.py
│  ├─ tests/
│  ├─ pyproject.toml
│  └─ alembic.ini
├─ data/
│  ├─ raw/
│  ├─ wiki/
│  ├─ index/
│  └─ eval/
├─ docs/
│  └─ LLM_WIKI_DESIGN_CN.md
└─ README.md
```

---

## 5. 数据模型（最小可用）

### 5.1 核心表
1. `documents`
- `id`
- `source_uri`
- `title`
- `content_hash`
- `status`（pending/running/success/failed）
- `created_at`, `updated_at`

2. `chunks`
- `id`
- `document_id`
- `chunk_index`
- `text`
- `token_count`
- `vector_id`
- `metadata_json`

3. `wiki_pages`
- `id`
- `slug`
- `title`
- `content_md`
- `version`
- `updated_at`

4. `citations`
- `id`
- `page_id`
- `chunk_id`
- `span_start`, `span_end`
- `confidence`

5. `build_jobs`
- `id`
- `job_type`（ingest/compile/eval）
- `payload_json`
- `status`
- `error_message`

---

## 6. API 设计（FastAPI）

### 6.1 Ingest
- `POST /api/ingest`：提交资料（文件/URL/目录）
- `GET /api/jobs/{job_id}`：查看处理状态

### 6.2 Wiki
- `POST /api/wiki/build`：触发编译
- `GET /api/wiki/pages`：页面列表
- `GET /api/wiki/pages/{slug}`：页面详情
- `POST /api/wiki/rebuild/{slug}`：重建单页

### 6.3 QA
- `POST /api/qa/query`
  - 输入：问题、检索策略、top_k
  - 输出：答案、引用列表、冲突说明、耗时

### 6.4 Eval
- `POST /api/eval/run`：执行评测
- `GET /api/eval/latest`：查看最近报告

---

## 7. 关键流程（端到端）

### 7.1 编译流程
1. 用户导入资料
2. 后端启动 `ingest job`
3. parser/chunker/embed 完成索引
4. compiler 生成 wiki 页面和链接
5. 更新 `index.md` + 构建报告
6. 前端展示页面与知识树

### 7.2 问答流程
1. 用户输入问题
2. hybrid retrieval 召回候选 chunk
3. rerank 后拼接 context
4. LLM 生成答案并强制输出 citations
5. 前端展示答案与证据面板

---

## 8. 工程质量与稳定性

### 8.1 测试策略
- 单元测试：parser/chunker/retrieval/引用校验
- 集成测试：ingest -> build -> qa 全链路
- 回归测试：固定评测集，自动对比指标波动

### 8.2 可观测性
- 每次 job 生成 `trace_id`
- 关键阶段记录耗时（parse/chunk/embed/generate）
- 失败样本落盘，便于复现

### 8.3 安全与成本
- API key 仅服务端持有
- 大模型调用加 token budget 上限
- 本地敏感文档默认不上传第三方

---

## 9. 里程碑计划（6 周）

### Week 1：骨架与最小闭环
- 建立前后端工程结构
- 完成 FastAPI 基础 API
- 支持 `txt/md` 导入与页面生成（最小链路）

### Week 2：检索与引用
- 接入向量索引
- 完成 hybrid retrieval
- 输出强制引用格式

### Week 3：增量构建
- 引入 hash 缓存机制
- 支持单页重编译
- 添加 job 重试

### Week 4：前端体验
- 知识树 + 页面浏览
- QA 面板 + 引用侧栏
- 构建日志可视化

### Week 5：评测系统
- 构建 `eval` 数据集
- 指标计算与报告模板
- 基线/优化版 A/B 对比

### Week 6：开源发布
- README、架构图、demo 视频
- benchmark 文档
- v1.0 发布与宣传

---

## 10. 简历写法（可直接使用）

1. 设计并实现本地优先的 LLM Wiki 编译系统（Python/FastAPI），支持文档增量解析、结构化知识构建与可追溯引用。
2. 构建 Hybrid Retrieval（关键词+向量+重排）和基于证据的 RAG 回答链路，实现回答-来源的强绑定与冲突提示。
3. 搭建离线评测框架（Recall、引用覆盖率、幻觉率、时延），形成可复现实验报告并驱动质量迭代。

---

## 11. 首批实施任务（下一个迭代）

1. 创建 `backend/app/main.py` 与健康检查 API
2. 创建 `POST /api/ingest` + 本地文件导入逻辑
3. 创建 parser/chunker 最小实现（仅 md/txt）
4. 创建 `POST /api/wiki/build` 并生成 `data/wiki/index.md`
5. 创建 `POST /api/qa/query`（先关键词检索，后加向量）
6. 写 10 条 smoke tests，确保闭环可跑通

> 说明：当前文档以“先跑通再增强”为原则，避免一开始陷入过度工程化。
