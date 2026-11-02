---
name: travel-guide-builder-v2
description: 旅行攻略规划与网页制作技能 2.52.0。用于制作、优化或发布旅行攻略、旅行网页和路线地图；通过统一地点库、结构化时间、逐日行程与地图双向联动，生成带住宿锚点、交通断点、核验进度、天气同步、分段导航、ICS 日历和可选实际支出的个人执行型旅行网页。作为默认旅行攻略技能使用，也可通过 $travel-guide-builder-v2 明确调用。
---

# 旅行攻略制作 2.52.0

将旅行资料转化为可执行、可核验、适合手机阅读的攻略。以研究、结构化 JSON 和确定性渲染为主线：`trip-request.json → trip-brief.json → trip-data.json → guide.html`。本技能是默认版本，不使用旧版目录的脚本和资产。

首屏默认使用目的地实景封面，只以固定 `ITINERARY`、原创编辑标题、一句话路线摘要和底部三项旅程事实建立叙事；不生成“查看行程”按钮或图片来源。页面提供六套语义配色并按攻略身份保存在当前浏览器。具体字段和视觉规则见 [references/content-modules.md](references/content-modules.md)，交互规则见 [references/interaction-modules.md](references/interaction-modules.md)。

当前稳定版 2.52.0 以简洁的个人执行体验为主：右下角只保留一个牛哞组合工具开关，待机、页面滚动和菜单展开分别对应静止、原地跑动与挥手，素材失败时回退为 `…`；菜单按条件展开“今天、编辑、汇率、搜索”。“今天”仅在行程包含本地当天日期时出现，编辑入口只在协作启用时出现，汇率入口仅在启用外币换算时出现。汇率速算在独立对话框中完成，不在预算正文重复放置汇率卡。搜索、协作对话框和日期 Tab 继续复用原有状态控制器，不建立平行逻辑。交通方案只显示预计时间，不改变原计划；协作保留首位用户设码创建 owner，已部署项目需按协作说明补执行 009。版本与迁移见 [references/capability-and-versioning.md](references/capability-and-versioning.md)。

新攻略优先提供有依据的旅行选择：整程地图只保留文字路线概览，逐日行程共用一张当天地图。“附近逛逛”以当地特色、品质、独特性和用户兴趣判断推荐价值，顺路加分但不是入选门槛，值得专程去的地方也可推荐。时间、距离和预约用于说明取舍，不要求塞进原行程空隙，也不自动改动正式计划。普通日 3–5 处、真正全天移动日 1–3 处；晚到、早离等例外及兼容规则只在 [references/nearby-explore.md](references/nearby-explore.md) 维护。候选围绕当天确定目的地，缺道路不阻断展示；只画已核实道路，不用直线替代。推荐地点配可追溯图片，夜市写具体商品，换汇按具名渠道与完整费用比较，出入境只写条件可比的亲历耗时。地图规则见 [references/map-and-geocoding.md](references/map-and-geocoding.md)，研究和数据字段详见 [references/research-and-sources.md](references/research-and-sources.md) 与 [references/content-modules.md](references/content-modules.md)。

到达/离开不使用“选择依据”“异常时改走”等标签填充通用解释；确有适用单据时，依据主管机关原始资料给出具体字段填法和提交入口，无适用单据则不显示空区块。详细边界见 [references/content-modules.md](references/content-modules.md)。

同一章节可按目的地提供真正会用的当地 APP：官方 Logo、名称、具体用途及影响使用的条件；仅点击名称复制，不显示“复制名称”提示或下载入口，说明文字与图标不触发复制。应用研究和数据边界见 [references/research-and-sources.md](references/research-and-sources.md) 与 [references/content-modules.md](references/content-modules.md)。

用户明确说“发布到线上”“上传”或“提交并推送”时，视为对本次正常发布链路的一次完整授权：主动完成浏览器验收、白名单暂存、提交和推送，不再把预检、验收记录或执行模式拆成多轮确认。推送成功即结束，GitHub Pages 由远端工作流异步部署；发布工具不依赖 `gh`、不等待 Actions，也不请求线上页面复核。`file://` 无法自动验收时使用仅监听回环地址的临时本地 HTTP 服务；含动态地图的页面在地图密钥授权的 HTTP 来源下验收，必要时将固定预览主机名映射到本机回环地址。不要求专门配置 HTTPS 证书，也不上传攻略内容或要求用户代替机器逐项确认。只有登录/验证码、发布目标不明确、Git 身份门禁失败、发现真实页面缺陷或需要额外破坏性操作时才暂停。

同一攻略的后续版本必须以最近一次已确认的 JSON 与正式页面为基线，按 [增量修改门禁](references/incremental-changes.md) 证明内容连续性；模板升级也不能跳过。发布同一路径的更新会自动检查原有内容是否无说明消失，详见 [网页输出与发布](references/web-output-and-publishing.md)。

用户固定要求：必须实际读取至少 10 篇去重的小红书攻略；未登录时提醒用户登录，未补齐不得完成研究。后续审查和升级不得擅自降低或豁免该门槛，详见 [研究规则](references/research-and-sources.md)。

用户要求把攻略地点导入 Google My Maps 时，按 [Pinbook 本地导出](references/mymaps-pinbook.md) 从同一份 `trip-data.json` 选择正式行程、附近逛逛或已研究推荐地点，生成 YAML 与 KML；此能力按需使用，不改变攻略网页的逐日地图和道路渲染。

详细规则见 [references/skill-rules.md](references/skill-rules.md)。

涉及能力取舍、模板升级、数据契约、版本兼容或人工迁移时，必须再读 [references/capability-and-versioning.md](references/capability-and-versioning.md)；普通攻略制作不加载该文件。

机场抵达节点提供“电话卡、换汇、前往下一站”三件套。只写实际读取的小红书所支持的具体方案、位置、套餐、费用和适用条件；不写旅行常识或无效提醒。研究与布局规则见 [references/content-modules.md](references/content-modules.md) 的机场落地三件套。

## 外部宿主元数据

`agents/openai.yaml` 是本技能对外的 Agent 宿主元数据（展示名、默认提示词、隐式调用策略），由兼容的宿主运行时读取，技能自身不引用。
