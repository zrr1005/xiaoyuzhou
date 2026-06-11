---
name: xiaoyuzhou-assistant-changelog
description: 小宇宙播客总结助手 — 完整迭代记录 (2026-05-12 ~ 2026-05-13)
metadata: 
  node_type: memory
  type: project
  originSessionId: c132fd7a-cdf2-4889-adf1-10a5aec66818
---

# 小宇宙播客总结助手 — 迭代记录

## 项目简介

小宇宙播客总结助手：粘贴小宇宙播客链接，自动下载音频 → 本地 Whisper 转录 → DeepSeek V4 拆解对话 → 主编级深度总结 → 生成小红书风格 HTML 笔记。

---

## V1.0 — 基础可用性 (2026-05-12)

### 问题 1：转录极其慢，每次要等十几分钟

**现象**：用户粘贴链接后，转录阶段要等很久，每次处理一个新的播客都要重新等。

**根因**：转录通过 `spawn` 启动独立 Python 进程执行 `whisper_local.py`，这个脚本每次被调用时都要从磁盘加载 Faster-Whisper 模型（base 模型约 500MB+）。模型加载需要 8-15 秒，之后进程结束模型就释放了，下次请求又要重新加载。另外 GPU 检测也失败（缺 cublas64_12.dll），回退到 CPU int8 模式，一个 1 小时播客在 CPU 上要转录 40-60 分钟。

**优化**：
- 创建 `services/whisper_server.py`，用 Flask 包一层持久化 HTTP 服务
- 服务启动时预加载模型到内存，后续请求直接复用热模型
- 多轮回退策略：先检查本地 Whisper 服务 → 服务不可用则用 Gemini 云端 API → 都不可用才 spawn 独立进程兜底
- `server.js` 启动时自动 spawn Whisper 服务进程，用户无感

**效果**：消除每次 8-15 秒的模型加载耗时，转录就绪时间从"每次等"变为"启动时一次等"。

---

### 问题 2：用户配置太复杂

**现象**：用户需要安装 Python 3.11、faster-whisper、flask、ffmpeg、CUDA Toolkit，还要配置代理、OpenAI Key、Gemini Key，普通人根本配不明白。

**根因**：技术栈选型偏重本地部署，Python 生态 + CUDA 运行时 + 各种 API Key + 代理配置混在一起，没有做用户视角的简化。

**优化**：
- 转录端：优先用 Gemini 云端音频 API（只需一个 Key），本地 Whisper 作为备选
- 总结端：一直用 Gemini（之前就配好了 Key）
- 后来 Gemini 在国内不可用（见 V1.1），进一步简化为：转录用本地 Whisper（Node 自动拉起，零配置），总结用 DeepSeek V4（国内直连，零代理）
- 设置页精简为只有一个输入框：DeepSeek API Key

**效果**：用户只需要一个 DeepSeek API Key（platform.deepseek.com 免费注册即可），其余全部自动。

---

### 问题 3：没有预估完成时间，干等焦虑

**现象**：任务提交后就显示一个进度条，没有任何时间预估，用户不知道要等多久。

**根因**：后端只返回 `progress` 百分比，前端没有做 ETA 计算；而且转录阶段进度长时间不动（因为同步 API 调用期间无法更新进度），导致进度条"假死"。

**优化**：
- `routes/podcast.js` 每次查询任务时根据 `elapsed / progress * 100 - elapsed` 动态计算剩余时间
- 进度 < 3% 时隐藏 ETA（太早预估不准），> 60 分钟时隐藏（避免离谱数字）
- 加入 `progressLabel` 字段展示当前正在做什么（"下载音频中..." / "Gemini 上传中..." / "AI 总结中..."）
- 前端轮询从 2 秒缩短到 1.5 秒

**效果**：用户能看到"预计剩余约 12 分钟""转录中... 1523 段"这样的实时反馈。

---

### 问题 4：提交了任务无法取消

**现象**：用户点开始后发现链接贴错了或者想换一个，只能干等任务跑完或失败，没有取消按钮。

**根因**：后端处理流程是一条线性的 async 函数，没有中断机制；前端也没有取消入口。

**优化**：
- `routes/podcast.js`：创建任务时生成 `AbortController`，保存到 task 对象上
- 新增 `POST /api/podcast/cancel/:id` 接口：设置 `aborted` 标志 + 调用 `abortController.abort()` 中断正在进行的 HTTP 请求
- 处理循环的每个步骤前都检查 `aborted` 标志
- `transcription.js` 和 `summarizer.js` 所有 axios 调用都传入 `signal`，捕获 `AbortError`
- 前端：处理中的任务卡片上显示红色「停止」按钮；详情页进度区也有停止按钮；任务结束后自动隐藏

**效果**：点停止后 1-2 秒内真正中断后端的下载/上传/API 调用，不再浪费资源。

---

### 问题 5：没配 API Key 也能提交，白等半天才发现失败

**现象**：用户没配 DeepSeek API Key 就点开始，后端走到总结阶段才报错"未配置 API Key"，前面的转录时间全浪费了。

**根因**：前端 `processPodcast()` 没有在提交前做配置项检查，所有校验都在后端。

**优化**：
- 链接校验：用正则匹配 `xiaoyuzhoufm.com`、`xiaoyuzhou.fm`、`xyzcdn.net`（音频 CDN）、`ximalaya.com`
- 配置校验：检查 `localStorage` 中是否有 `deepseekApiKey`，没有就弹出 toast 引导前往设置页，**不发起请求**
- 错误提示精确到具体缺什么，不笼统报"失败"

**效果**：无 Key 时提交按钮直接不生效，避免无效等待。

---

### 问题 6：设置页字段太多，混淆严重

**现象**：设置页有 OpenAI Key、OpenAI 代理、Gemini Key、Gemini 代理、本地代理、飞书三件套……用户不知道填哪个，填错了也不知道。

**根因**：设计时把所有可选项都暴露了，没有按使用场景分级。

**优化**：
- 新增「转录引擎」下拉选单（Gemini / OpenAI Whisper / 本地 Whisper / 自定义），切换时自动填充对应 API Base URL，显示/隐藏无关字段
- 后来全面简化：砍掉 Gemini、OpenAI、飞书，只留 DeepSeek API Key 一个输入框
- 加说明区域：转录用本地 Whisper（自动）、总结用 DeepSeek（需 Key）

**效果**：设置页从 10+ 字段精简到 1 个输入框 + 说明文字。

---

### 问题 7：转录出来是纯粹的文字流，没有对话感

**现象**：播客是两人对谈，但转录输出是一大段连续文字，分不清谁在说话。

**根因**：Whisper 只做语音转文字，不做说话人识别（speaker diarization）。

**优化**：
- 创建 `services/dialogue.js`：把转录文字送给 DeepSeek，要求它识别说话人并标注"主持人"/"嘉宾"
- 同一说话人的连续短句合并成一个完整段落（语义合并）
- 前端「转录原文」区域增加 原文/对话 Tab 切换，对话视图按人物分段展示

**效果**：转录从"一坨字"变成"主持人：... / 嘉宾：..."的对话体。

---

## V1.2 — 国内网络适配 (2026-05-12)

### 问题 8：Gemini 转录在国内完全不可用

**现象**：调用 Gemini File API 上传音频文件时报 HTTP 502 或 timeout，根本用不了。

**根因**：Google 服务在中国大陆被墙。即使配置了本地代理（Clash 127.0.0.1:7890），上传 213MB 大文件仍会失败——代理链路承载不了大文件长连接，要么被 GFW 阻断，要么代理服务本身超时。

**优化**：
- 彻底调转策略：转录只用本地 Whisper（离线性能够用），不再依赖任何需要代理的云端转录服务
- 总结从 Gemini 切到 DeepSeek V4——DeepSeek 服务器在国内可直接访问，无需代理，API 兼容 OpenAI 格式
- 回退链改为：本地 Whisper → 无回退（不再试 Gemini/OpenAI）

**效果**：整个系统不再依赖任何需要代理的服务，国内网络无障碍使用。

---

### 问题 9：GPU 检测假阳性——模型加载成功但转录时报错

**现象**：Whisper 服务日志显示"Loading on GPU (CUDA/float16)... GPU model loaded"，看起来 GPU 可用。但实际转录时抛出 `Library cublas64_12.dll is not found or cannot be loaded`，整个转录失败。

**根因**：`nvcuda.dll` 存在（说明 NVIDIA 显卡驱动装了），所以代码判定 GPU 可用。但 `cublas64_12.dll` 是 CUDA Toolkit 的运行时组件，不在显卡驱动里。模型加载阶段不需要 cublas（只是把权重从磁盘读到显存），但实际推理计算必须调用 cublas 做矩阵运算。旧的 GPU 检测逻辑只检查了驱动，没检查运行时。

**优化**：
- 加载前同时检查 `nvcuda.dll` **和** `cublas64_12.dll`，缺任何一个就走 CPU
- 检测通过后，用 ffmpeg 生成 1 秒静音做一次实际 `model.transcribe()` 推理验证，防止"加载成功但运行失败"的半残状态
- 引入 `os.add_dll_directory()` 自动扫描 pip 安装的 `nvidia-cublas-cu12` 包的 DLL 目录（`site-packages/nvidia/cublas/bin/`）
- 用户只需 `pip install nvidia-cublas-cu12` 而不用装完整 CUDA Toolkit 3GB+

**效果**：GPU 检测从"碰运气"变成"真的能用才上"。

---

### 问题 10：长播客转录到一半被强制中断

**现象**：用户试了一个长播客，转录到第 10 分钟时 Node 端报 `timeout of 600000ms exceeded`，但 Whisper 服务 13 分钟时才完成——转录本身成功了，但 Node 端提前断了。

**根因**：`transcription.js` 中 axios 请求超时设为 `600000ms`（10 分钟）。这个时间对大多数播客够用，但对超长节目不够。而且之前的架构是同步等待——一个 POST 请求等 Whisper 返回全部结果，中间没有任何心跳。

**优化**：
- 超时调至 `1800000ms`（30 分钟）
- 架构改为异步：POST 提交任务 → 返回 `job_id` → 轮询 GET `/progress/:job_id`（1.5 秒间隔）
- 轮询循环加 30 分钟总超时保护，避免极端情况无限循环

**效果**：单次转录支持最长 30 分钟，覆盖绝大多数播客时长。

---

### 问题 11：转录偶发静默失败（有进度条但最终无结果）

**现象**：用户点重试后，看起来处理完成了（状态变成"已完成"），但结果页没有转录原文。

**根因**：`transcription.js` 的轮询循环中，`if (!job.success) break;` 会在 Whisper 进度接口返回临时错误时直接退出循环，然后走到 `return { success: false, error: '转录超时或失败' }`。这个错误在某些情况下被外层捕获后，任务仍然标记为 completed（因为后续步骤可能用旧的 transcription 数据）。

另外 `routes/podcast.js` 里 retry 路由的 `progressCallback` 没有像主流程那样更新 `liveSegments`。

**优化**：
- `break` 改为 `continue`——进度接口临时报错时等待 2 秒重试，不退出
- 统一 process 和 retry 两个路由的 progressCallback 逻辑
- 转录失败时正确标记 task.status = 'failed'

**效果**：转录不再静默失败，错误时会明确标记并提示用户。

---

## V1.3 — 转录质量 (2026-05-12)

### 问题 12：转录按秒断句，阅读体验极差

**现象**：转录结果是 9000+ 段碎片，几乎每秒一行，像"嗯""对""是的"这种单字也单独成段。读起来像看电报。

**根因**：`faster-whisper` 的 `vad_filter=True`（Voice Activity Detection）会在检测到语音停顿时强制切分。对于中文对话，VAD 过于敏感，把自然的句间停顿也当成了段落边界。结果就是每个短句都独立成段。

**优化**：
- Whisper 服务和 transcription.js 都改为 `vad_filter: false`，让模型按自然语义边界分段
- `dialogue.js` 新增 `mergeSegments()` 函数：将相邻短于 50 字的段落自动合并到上一个段落，直到形成完整的观点表达
- DeepSeek 对话拆解时进一步合并同一说话人的连续发言

**效果**：从 9000+ 碎片段 → 几百个完整观点段落，可读性大幅提升。

---

### 问题 13：tiny 模型中文转录质量差，出现乱码

**现象**：转录结果中出现"规谷不是有两个遥顺域吗"这种完全不通的文字。

**根因**：为了追求速度切换到了 `tiny` 模型——参数量只有 39M，是 `base`(74M) 的一半，`small`(244M) 的六分之一。tiny 模型对中文音素的分辨能力不足，尤其在语速快、口音重、背景嘈杂时会"脑补"出错误的文字。

**优化**：
- 切回 `base` 模型（`.env` 中 `WHISPER_MODEL=base`）
- base 模型在 GPU(float16) 下，1 小时播客转录约 8-12 分钟，速度可接受，准确率明显高于 tiny
- 如果后续需要更高准确率，可以进一步升级到 `small` 模型

**效果**：中文转录准确率从"勉强能用"提升到"流畅可读"。

---

### 问题 14：重新转录后结果页没有原文内容

**现象**：用户点某个已完成任务的「重试」按钮，新任务显示完成，但转录原文区域是空的。

**根因**：前面问题 11 修复的轮询 break bug 和 progressCallback 不一致问题未彻底修复。重试流程在处理转录结果时，`task.transcription` 虽然被赋值了，但某些异步边界条件下数据未正确存入数据库。

**优化**：
- 统一 process 和 retry 两个路由的数据持久化逻辑（都通过 `saveTask()` 写入 SQLite）
- 确保 transcription 数据在 retry 流程的每一帧都被正确序列化保存

**效果**：重试流程和首次处理流程行为完全一致。

---

### 问题 15：转录过程中看不到实时进度

**现象**：转录开始后，前端只有一条"转录音频中..."和进度条百分比，完全不知道已经识别出多少内容。

**根因**：旧的同步调用模式——Node 发一个 POST 给 Whisper，等整个转录完成后才返回全部结果。中间没有任何数据回流。

**优化**：
- Whisper 服务改为异步 job 模式：
  - POST `/transcribe` 提交任务，下载音频后立即返回 `job_id`
  - 后台线程执行转录，每 10 段更新一次 `JOBS[job_id]` 共享状态
  - GET `/transcribe/progress/:job_id` 返回当前已识别的最近 200 段文字
- `transcription.js` 改为轮询模式：1.5 秒间隔查进度，有新段落时通过 `progressCallback` 实时回传
- 前端 task.html 详情页进度区增加 `liveTranscript` 区域，实时展示最近 30 段转录文字（橙色时间戳 + 内容）
- 任务完成后自动切换到完整结果视图

**效果**：用户可以在转录过程中看到文字一行一行地出现，知道系统确实在跑。

---

### 问题 16：转录完成后无法下载原文

**现象**：用户想要转录原文的 TXT 文件去做其他用途，但没有下载入口。

**根因**：功能缺失。之前只展示了转录原文，没有导出机制。

**优化**：
- 前端结果页增加「下载原文」按钮
- 点击后生成带时间戳的 TXT 文件（格式：`[00:00] 文字内容`），通过 Blob 下载
- 文件名自动取播客标题（过滤非法字符）

**效果**：一键导出完整转录文本。

---

## V1.4 — 总结深度 (2026-05-12 ~ 2026-05-13)

### 问题 17：AI 总结只是简单缩写，缺乏深度和可操作性

**现象**：之前的总结就是"本期播客讨论了 A、B、C，嘉宾认为 D 很重要"这种空洞缩写，看完和没看一样。

**根因**：Prompt 设计过于简单。只要求 AI 输出"核心摘要 + 大纲 + 关键结论"三个字段，没有引导 AI 做深度分析。而且 prompt 中对信息密度、追问逻辑、底层思维没有任何要求。

**优化**：
- 完全重写 System Prompt，角色从"总结助手"升级为"资深播客主编"
- 新增 8 个输出维度：

| 字段 | 说明 | 示例 |
|------|------|------|
| `valueProposition` | 一句话价值主张（这期对我有啥用？） | "揭示了 AI 研发中集体责任的重要性" |
| `keywords` | 核心标签 3-6 个 | #GPU与TPU #组织架构 |
| `coreSummary` | 200-400 字高密度摘要 | 抓住核心观点和论证逻辑 |
| `outline` | 二级结构化大纲 | 主题 + 时间戳 + 3-5 个支撑论点 |
| `qa` | 启发式问答对 2-4 组 | Q: 深层痛点 → A: 嘉宾独家解法 |
| `mentalModels` | 底层思维模式 1-3 个 | "物理学家与 AI 科学家的崇拜差异" |
| `keyConclusions` | 关键金句 3-6 条 | 嘉宾原话提炼 |
| `actionItems` | 行动清单 | 推荐书籍/工具/方法论 + 推荐理由 |

- 限制输入文本前 12000 字符（避免超 token），输出 token 扩至 8192
- temperature 从 0.7 降至 0.5（减少随机性，提高结构化输出质量）

**效果**：总结从"一段话"变成"一篇有深度的读书笔记"。

---

### 问题 18：新总结字段前端没对接

**现象**：Problem 17 改了后端输出格式，但前端 `showResult()` 还在用旧字段名（如 `outline[].topic` 而非 `outline[].title`），导致新字段全部不显示。

**根因**：前后端字段名不一致，未同步更新。

**优化**：
- 重写 `showResult()` 函数，对接全部 8 个新字段
- 新增 HTML 区域：价值主张横幅、关键词标签、二级大纲、Q&A 卡片、思维模型、行动清单
- 每个区域只有在有数据时才显示（`display:none` 兜底）
- 新增 CSS 组件样式：`.hero-summary`、`.outline-block`、`.qa-item`、`.mental-item`、`.action-item`

**效果**：所有新字段都在结果页完整呈现。

---

### 问题 19：小红书笔记内容不完整

**现象**：生成的小红书 HTML 笔记只有摘要和大纲，缺少 Q&A、思维模型、行动清单等新字段。

**根因**：`services/xiaohongshu.js` 还用的是 V1.3 之前的旧 summary 结构，没有更新。

**优化**：
- 笔记封面卡片增加价值主张和关键词标签展示
- 大纲区域从一级列表升级为二级结构（主题 + 论点列表）
- 新增 Q&A 区（Q 橙色加粗 / A 灰色正文）
- 新增思维模型区
- 新增行动清单区（📖 书 / 🛠 工具 / � 方法论，带推荐理由）
- 删除已废弃的 externalLinks 延伸阅读区

**效果**：小红书笔记从"简版摘要"升级为"完整深度笔记"，可以直接分享。

---

### 问题 20：externalLinks 引用报错导致笔记生成失败

**现象**：处理完成后生成笔记时报 `externalLinks is not defined`，整个任务失败。

**根因**：新版 summary 结构把 `externalLinks` 改成了 `keywords` + `actionItems`，但 `xiaohongshu.js` 中 `generateNote()` 函数顶部解构时移除了 `externalLinks`，模板里却还有 `${linksHtml}` 引用，JS 运行时报 ReferenceError。

**优化**：
- 删除 `linksHtml` 变量声明（它依赖已经不存在的 `externalLinks`）
- 删除模板中的 `${linksHtml ? ...}` 延伸阅读段（功能已被 actionItems 和 keywords 替代）

**效果**：笔记生成不再报错。

---

## V1.5 — 持久化与多用户 (2026-05-13)

### 问题 21：服务重启后历史任务全部丢失

**现象**：每次重启 Node 服务后，之前处理过的任务记录全部消失，首页变空白。

**根因**：任务数据用 `new Map()` 存内存里，进程结束内存释放，数据自然没了。没有做任何持久化。

**优化**：
- 安装 `better-sqlite3`，创建 `services/db.js` 数据访问层
- 两张表：`users`（id, username, created_at）、`tasks`（17 个字段，包括完整的 podcast_info JSON、transcription JSON、summary JSON、step_times JSON）
- WAL 模式提升并发读性能
- 所有 task 变更实时写入 SQLite（`saveTask()` 用 INSERT OR REPLACE）
- 数据库文件路径：`data/app.db`

**效果**：历史任务永久保存，重启不丢。数据库可随时用 SQLite 工具查看。

---

### 问题 22：无用户体系，多个人用同一台机器数据混在一起

**现象**：没有登录概念，所有任务都在一个池子里。如果多人共用电脑，看到的是同一个列表。

**根因**：没有用户系统。

**优化**：
- 安装 `express-session`，基于 cookie 的会话管理（30 天有效期）
- 首次使用弹出登录框，输入昵称即可（本地工具不设密码，昵称作为用户标识）
- `getOrCreateUser()`：用户名不存在则自动创建
- 所有任务 API 通过 `requireLogin` 中间件保护
- 所有数据查询带 `user_id` 过滤
- 支持登录/退出/切换账号，切换后数据完全隔离
- 说明：微信/QQ 登录需要公网域名 + 开发者资质 + OAuth 回调服务器，本地工具不适合。昵称登录满足多用户场景

**效果**：不同昵称看到独立的任务列表，数据隔离。

---

### 问题 23：不知道每个步骤各自花了多长时间

**现象**：任务完成只显示一个总耗时（如"约 15 分钟"），无法判断是转录慢还是总结慢。

**根因**：只记录了 `startedAt` 和 `completedAt`，没有按步骤打点。

**优化**：
- 每个步骤开始时记录 `stepStart = Date.now()`
- 步骤结束时计算 `(Date.now() - stepStart) / 1000` 存入 `stepTimes` 对象
- 5 个步骤：parse（解析链接）、transcribe（转录）、dialogue（对话拆解）、summary（AI 总结）、note（生成笔记）
- 前端侧边栏展示各步骤耗时明细，首页任务卡片的 eta-text 也展示关键步骤耗时

**效果**：用户可以精确定位瓶颈，比如"转录 623s 占总时长 80%"，针对性优化。

---

### 问题 24：首页任务卡片信息太少

**现象**：首页任务卡片只显示播客标题 + 状态徽章 + 进度条，用户要看具体内容必须点进详情页。

**根因**：卡片渲染逻辑过于简单，只取了最基本的字段。

**优化**：
- 卡片增加简要描述（来自 `coreSummary` 前 120 字，次要行截断）
- 耗时行加步骤耗时简写（"转录 623s · 总结 22s"）
- 已完成任务加「重试」按钮 + 「笔记」链接按钮
- 转录来源标签（本地 Whisper）
- 登录后在导航栏右侧显示当前用户名 + 退出链接

**效果**：首页卡片可作为"已处理播客库"使用，无需点进详情也能看到核心信息。

---

## 当前架构图

```
浏览器                    Node.js :3000                Whisper :5001
  │                          │                           │
  ├─ 输入昵称登录 ──────────→ express-session            │
  │                          │                           │
  ├─ 粘贴小宇宙链接 ────────→ POST /api/podcast/process  │
  │                          │  ├─ parseXiaoyuzhou()     │
  │                          │  ├─ POST /transcribe ────→ 下载音频
  │                          │  │   (返回 job_id)        │ 后台线程转录
  │                          │  ├─ 轮询 /progress/xxx ←─→ 实时返回段落
  │                          │  ├─ formatDialogue() ────→ DeepSeek V4 拆解对话
  │                          │  ├─ generateSummary() ───→ DeepSeek V4 主编级总结
  │                          │  ├─ saveNote() ──────────→ public/notes/*.html
  │                          │  └─ saveTask() ──────────→ data/app.db (SQLite)
  │                          │                           │
  ├─ 查看结果 / 重试 / 下载   │                           │
  │                          │                           │
  └─ 查看小红书笔记 ─────────→ /notes/note_xxx.html      │
```

## 技术栈

| 组件 | 技术 | 部署方式 |
|------|------|----------|
| Web 服务 | Express.js | :3000, `node server.js` |
| 转录引擎 | Faster-Whisper base | Flask :5001, Node 启动时自动 spawn |
| GPU 加速 | CUDA float16 | `nvidia-cublas-cu12` pip 包 |
| AI 对话拆解 | DeepSeek V4 (deepseek-chat) | 云端 API，国内直连 |
| AI 主编总结 | DeepSeek V4 (deepseek-chat) | 云端 API |
| 数据库 | SQLite (better-sqlite3) | `data/app.db`, WAL 模式 |
| 用户认证 | express-session | Cookie 会话，30 天有效 |
| 笔记输出 | 静态 HTML | `public/notes/`, 小红书风格 |
| Python 环境 | Conda env `my_new_env` | `F:\programFiles\miniconda3\envs\my_new_env` |

## 启动方式

```bash
cd E:\ProgramData\AI\Sudoku\xiaoyuzhou-assistant
node server.js
```

服务自动拉起 Whisper(:5001) + Web(:3000)，打开 `http://localhost:3000` 使用。
