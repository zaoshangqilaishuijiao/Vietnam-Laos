# 结构化内容流水线

结构字段与阶段约束以 [trip-data.schema.json](trip-data.schema.json) 为机器契约；本文件负责说明生成流程，不复制完整 schema。

## 读取与授权

- 新建或重做完整攻略时读取本文件；局部修改已有攻略改读 [增量修改门禁](incremental-changes.md)。只改共享页面或交互时，按 [详细规则](skill-rules.md) 路由到对应专项文件，不加载本流水线。
- 用户说“生成攻略”即授权研究和完整文字稿；先展示内容与来源，确认后再生成网页。用户明确说“直接做完网页、无需中途确认”时，可一次授权文字和网页两阶段；不得把普通“继续”解释为跨越尚未展示的文字确认。
- 首次只询问会实质改变路线、预算或安全判断的缺失事实；用户一次“继续”后，将合理假设写入 `requirements.assumptions`，不重复索要确认。
- 过程 JSON 和基线只留本地；“生成网页”授权生成最终本地 HTML，“上传/发布”才授权发布最终网页及必要运行资源。目标不明确、身份门禁、敏感信息、文件范围或远端冲突时必须暂停。

## 主流程

完整攻略不得从需求直接跳到路线或长 HTML：

```text
用户与资料 → trip-request.json → 研究 → trip-brief.json（展示）→ trip-data.json → guide.html → <输出名>.validation.json
```

- `trip-request.json`：用户事实和研究边界，不含模型推测的路线。
- `trip-brief.json`：研究后形成的基础方案、逐日骨架和来源证据。
- `trip-data.json`：内容唯一真相源；HTML 只负责呈现。

`datePolicy=fixed` 时 `meta.dates` 必须列出连续自然日；非连续行程使用 `explicit`。只有明确日期行程才启用实时天气刷新；季节或日期待定行程把常年气候和临近核验动作写入 `checklist`。

`meta.guideId` 是跨设备协作及本地存储的稳定身份。新攻略建议生成独立随机ID并写入JSON，后续修改保持不变。旧JSON缺失时，渲染器从基线HTML、基线JSON或同一路径的现有HTML继承旧ID，均无时固定旧算法ID；全部验证成功后才补写到输入JSON。此补写仅用于身份迁移，不改事实内容。旧攻略首次升级若更换输出路径且已改标题/日期，须先从旧HTML提取ID填入JSON；不要重新生成身份。更新时ID冲突会被拦截，新攻略使用独立输出路径。

## 阶段一：需求基线

从 `assets/data/trip-request.template.json` 建立 `trip-request.json`，只锁定：

- 标题、目的地、出发地、人数、日期和预算口径；
- 必去、避开、偏好、限制、用户已接受的假设和待确认项；
- 条件模块开关；
- 按 `research-and-sources.md` 当前配额建立常规研究、跨境到达/离开专项及官方核验主题。

此阶段不得填写路线顺序或逐日骨架。运行：

```bash
node "<skill-root>/scripts/validate-trip-data.js" trip-request.json --stage=request
```

未通过时只修需求基线，不开始研究。

仅在缺失会实质改变路线、预算或安全判断的关键事实时提问；用户回复一次“继续”后，将合理假设写入 `requirements.assumptions`，不得重复询问同一事实。

## 阶段二：研究与基础方案

需求基线通过后，按 `research-and-sources.md` 先完成游客经验和官方核验。将实际使用的来源写入 `trip-brief.json.researchSources`，将目标和实际数量写入 `researchAudit`；不得只在对话中声称“已读取”。达到目标时设 `status=completed`；遇到平台拦截立即停止该平台访问并记录原因；按研究规则使用允许范围内的替代证据，覆盖完整后继续，证据不足才保持 `blocked`。

首次读帖按 [首次读取留存与按需调用](research-and-sources.md#首次读取留存与按需调用) 将有用来源、地点、事实和素材留在同一本地记录；后续写模块用 `research-store.js --module/--entity/--city/--q` 取相关片段，先复用再补缺。不将原始工具返回、研究图片链接或整库塞进 brief、trip-data 或上下文；进入内容阶段只投影选定事实及必要来源，研究ID映射到现有数字来源ID和地点ID，不新建平行运行时数据源。

研究完成后，从 `assets/data/trip-brief.template.json` 建立 `trip-brief.json`：

- 原样继承需求基线中的日期、人数、预算、必去/避开、偏好、限制、功能开关和研究计划；
- 根据研究生成一句话路线、有序停靠点和逐日骨架；
- 记录研究后仍存在的假设和待确认项；
- 默认保持 `confirmation.status=pending`；仅当用户明确授权“直接做完网页、无需中途确认”时设为 `skipped`，并在 `confirmation.note` 记录触发指令。

运行：

```bash
node "<skill-root>/scripts/validate-trip-data.js" trip-brief.json --stage=brief --request=trip-request.json
node "<skill-root>/scripts/summarize-trip-brief.js" trip-brief.json
```

向用户展示摘要而非原始 JSON，并提供详细文字稿：逐日 A→B 候选、推荐图片对应来源、具体商品、换汇 1000 CNY 对比、可比出入境样本。`pending` 时等待一次“确认/继续”或修改意见；回复后设为 `confirmed` 并记录决定。只有明确免中途确认的 `skipped` 才直接进入网页阶段。`blocked` 表示研究受阻；常规小红书不足规定篇数时须提醒用户登录或解除拦截，实际补齐后再继续，替代来源不能豁免篇数。内容校验器接受 `confirmed` 或带记录的 `skipped`。

## 阶段三：详细内容

从 `assets/data/trip-data.template.json` 建立 `trip-data.json`，以 `confirmation.status=confirmed` 或 `skipped` 的 brief 为输入：

填充前按模块／地点调用本地研究记录；检查动态事实日期与条件、实际素材及分店，再写原有字段。已有 `places[]` 和已核实的 `dayRoadRoutes[]` 可在起终点、地点身份、顺序和交通方式未变时复用，不重复做相同地理编码或路线请求；路线顺序、方式或实际通行条件变化才重核受影响部分。不从旧研究记录恢复已被用户删改的内容。

- `meta`：标题、日期、人数、预算口径、一句话路线与可选语义主题 `theme`；默认使用海岸蓝，也可按封面照片主色、整体明度和旅程气质在六套预设中调整；
- 新攻略必须填写 `meta.hero.title` 与 `meta.hero.subtitle`：标题按“核心体验意象＋季节、时间或旅程气质”原创概括并优先控制为四个汉字，摘要按最终路线顺序压缩起点、关键过渡和收束点，只体现已确认的节奏与偏好。英文标识由模板固定输出 `ITINERARY`，不从数据改写；数据契约不提供行程事实和目的地短评字段，生成阶段不得创建这些内容，也提供今日或上次行程入口，不恢复旧多入口面板，固定结构见 [content-modules.md](content-modules.md)；
- `places`：所有住宿、景点、交通节点的统一地点库，是名称、地址、坐标和来源的唯一真相源；
- `arrivalDeparture`：跨境到达/离开流程和机场交通；按本次证件、签证与口岸核实需要填写的单据时，在 `forms[]` 记录具体字段名、填法、适用条件、提交入口和官方来源，不用选择依据或异常预案填充版面；在 `apps[]` 记录本次目的地会用的当地 APP、官方 Logo 相对路径、具体用途、适用地区及核实来源，下载页只存数据不生成页面入口，仅点击 APP 名称复制；
- `route`：地点、坐标、路线段、方向、方式和预计用时；
- `days`：每天完整字段、0–5 分半星强度、详情、备注和直达链接；
- `transport`、`budget`、`recommendations`、`localKnowledge`、`checklist`、`bookingLedger`、`weather`，以及确有整类共同限制时才创建的可选 `recommendationNotes`；
- `sources`：必须保留 brief 已使用的研究来源，可追加详细写作所需的官方核验；
- `sources[].reading`：只有正文之外有具体阅读价值且仍适用于当前方案时填写 `{topic,title,value}`，详见 research-and-sources.md。研究来源与阅读数量留本地，不为展示删研究证据。`sourceIndex` 为可选本地检索提示，不保存原文、不凑标签数量；网页索引只投影入选补充阅读，清理时统一更新编号、角标与搜索，正文执行信息和图片归属不删。

关键子项契约：

- `places[]`：稳定 `id`、中外文名称、检索名、城市、国家/地区、地址、坐标和来源；路线、天气和逐日条目只引用 `placeId`，不得复制另一套地点字段。
- `route.stopIds[]`：只保存地点 ID；`route.legs[]` 使用 `fromPlaceId/toPlaceId` 逐段连接，并保存方式、分钟数、颜色和断点标记。
- `days[].accommodation`：以 `startPlaceId/endPlaceId` 锚定每日出发与结束住宿，可标记已确认、待定或不适用；可选 `note` 只写会改变当天动作的特殊入住或寄存信息。
- `days[].items[]`：稳定 `id/type/placeId/title/activity/startTime/endTime/timeText/travelMinutes/stayMinutes/transportMode/breakGroundRoute/reservationStatus/sourceIds`。新写地面路段按逐段研究结果填写已核验的 `navigationOptions`，允许单方案，不固定方式或数量；用户明确单一查询偏好可选 `navigationMode`，二者互斥。推荐耗时必须与 `travelMinutes` 一致，来源复用条目 `sourceIds`。确定时间成对填写并通过冲突校验；弹性安排使用不超过 24 字符的 `timeText`，只展示、不参与重算，不复制路线、标题或正文。
- `days[].items[].details/notes/links/referenceImages`：详情按条数决定是否编号；备注统一进入黄色区；网页链接保存标签和 http(s) URL；与节点直接相关的原始图片保存安全相对路径、短标题、替代文本和用途说明，并把实际图片资源随最终 HTML 保留。地址继续复用 `places[]`，由渲染器仅在首次出现时输出。
- `days[].items[].calendarHighlight` 与 `days[].calendarNotes[]`：每天显式选择 1–6 个主要时间/地点进入 ICS，日历备注最多 3 条；禁止把所有网页信息复制进日历。
- `transport[]`：出发地、目的地、出发/抵达窗口、方式、耗时、费用和来源；只有存在日期、班次、施工或运营方特有的执行条件时才填写可选 `verification`。
- `budget.items[]`：名称、上下限、币种、口径和来源；基准币、分项与合计统一使用 CNY，当地货币原价和换算口径写入备注；`total` 等于分项合计。
- `recommendations[]`：覆盖景点指南、当地体验和餐饮指南；三类共用“为什么值得、为什么适合、时机、路线关系、耗时、预约、官网/地点引用”字段，限制和现场执行为有实质差异时才填写的可选字段。
- `recommendationNotes[]`：可完全省略，每类最多一条；仅保存会改变整类推荐执行方式的共同条件，避免重复通用提醒。
- `localKnowledge[]`：形成“文化习俗”第四组，按适用性选择文化特点、会客礼仪、文化禁忌卡片；默认不投影到逐日时间线，知识说明不复制为核验清单。
- `sources[]`：从 1 开始连续递增的唯一数字 ID、类型、范围、原始链接、主题、城市和核验状态；小红书 URL 必须真实、可追溯且去重。

运行：

```bash
node "<skill-root>/scripts/validate-trip-data.js" trip-data.json --stage=content --brief=trip-brief.json
```

校验日期覆盖、逐日骨架一致性、地点引用、路线连续性、时间冲突、住宿锚点、来源继承、坐标、预算和条件模块。未通过时禁止生成 HTML。

## 阶段四：确定性渲染

```bash
node "<skill-root>/scripts/verify-template-lock.js"
node "<skill-root>/scripts/render-guide.js" trip-data.json guide.html --request=trip-request.json --brief=trip-brief.json
```

公开 GitHub Pages 不直接提交含 Browser Key 的成品 HTML。先用 `--public-source`（需要共同编辑再加 `--public-collaboration`）生成只含占位符的公开源 HTML，再由 Pages CI 调用 `scripts/build-public-guide.js` 从 Repository Secrets 生成部署 Artifact。部署产物不回写 Git。

渲染器只读取结构化数据和当前 `PAGE_TEMPLATE_VERSION` 对应的共享资产，负责 HTML 转义、固定章节、动态导航、日期 Tab 单卡切换、当天地图与附近逛逛（旧路段探索保留兼容）、条目联动、搜索、清单、天气、汇率、ICS、可选支出及来源校验，并生成 `guide.validation.json`。[附近逛逛策略](nearby-explore.md) 控制价值优先的候选、逐日状态和可选自由窗口；道路几何按已核实部分在生成前写入 `dayRoadRoutes[]`，缺段不阻断候选，网页不得运行时规划路线。普通攻略只改 JSON；模板锁失败时不得继续生成或为单篇攻略更新锁文件。内容连续性报告仍按增量门禁记录本地基线路径和哈希，只留本地。

## 阶段门禁

| 阶段 | 允许处理 | 禁止进入下一阶段的情况 |
| --- | --- | --- |
| request | 用户事实和研究边界 | 日期冲突、关键限制不清 |
| research / brief | 来源证据、路线和逐日骨架 | 研究受阻或未完成、来源数量不实、路线或骨架为空、用户明确要求先看方案但尚未确认 |
| content | 详细行程、来源与坐标 | 缺日、必填字段为空、来源丢失、路线腿不连续 |
| render | 布局与组件装配 | JSON 未通过或资产版本不匹配 |
| browser QA | 响应式、交互、网络降级 | 控制台错误、溢出、地图灰屏、交互失效 |

## 增量修改

- 已有 `trip-data.json`：先将最近一次已确认的数据和正式 HTML 保留为本地 baseline 副本（与主文件同目录、命名 `*.baseline.json` / `*.baseline.html`，目录已被 `.gitignore` 忽略，禁止配置 remote 或提交到任何分支；磁盘副本不进 AI 上下文），声明 `--allow-paths` 后按 [增量修改门禁](incremental-changes.md) 比较 JSON。同版模板的局部修改再用 `--frozen-modules` 检查未改 DOM 与模板版本；跨模板升级只检查 JSON 连续性和正式 HTML/日期基线，不冻结旧版 DOM。`--baseline` / `--baseline-html` 参数只接受本地文件路径，不接受 git ref。
- 修改前用 `node "<skill-root>/scripts/extract-trip-sections.js" <trip-data.json> --days=<N> --module=<模块>` 提取受影响片段；修改后用 `--apply` 写回（写回严格限定在命令声明的 day / module / item 范围内，先写临时文件并通过内容校验再原子替换）并立即运行校验器。禁止为定位一处修改而通读全量 JSON。
- 只有旧 HTML：先提取 JSON 基线；迁移前可按旧版增量规则修补页面。
- 用户只讨论方案：可停在 brief；用户只要文字稿：可停在 content。
- 不在同一回复中粘贴完整 JSON 和完整 HTML；过程文件落盘，最终只交付用户需要的成品和验证结果。
- 上下文不足但过程文件仍可访问时，先重读已校验的 `trip-request.json`、`trip-brief.json` 与其 `confirmation` 状态继续；不得要求用户重复“继续”。确需交接时，交接说明必须包含当前阶段、文件名、研究状态和总授权/暂停原因。


### 预定清单数据

`bookingLedger` 是独立的预订事实台账，不替代逐日行程。每条记录以唯一 `id` 表示一个需预订项目，包含 `category`（`activity` 或 `restaurant`）、`title`、`when`、`participants`、`status`（`confirmed`、`pending` 或 `verify`），可选关联 `placeId`、`bookingUrl` 与 `sourceIds`。同一项目在逐日行程、推荐和餐厅计划中可多次引用，但台账只能保留一条。

网页按是否配置共同编辑选择状态实现：未配置时使用浏览器本地三态；配置时使用 `booking:<id>` 接入共享执行状态，`activity` 映射为 `activity`、`restaurant` 映射为 `meal`。不得把浏览器状态写回 `trip-data.json`，也不得让执行状态覆盖原始预约事实。

文化习俗按适用性选择，每类最多一项；整个模块不适用时设 localKnowledge=[] 并在 meta.cultureNote 说明。常规小红书必须实际读取到规定篇数，decisionCoverage 和不足原因均不能豁免，详见 research-and-sources.md。
