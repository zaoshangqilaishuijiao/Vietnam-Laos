# 2.0 执行数据模型

## 目录

- 地点唯一真相源
- 每日执行条目
- 住宿锚点与交通断点
- 地图和页面联动
- 执行辅助组件

## 地点唯一真相源

`places[]` 保存所有会被路线、每日安排、住宿、天气或导航使用的地点。每个地点必须有稳定 `id`、中英文或当地名称、城市、国家、坐标、核验状态和来源。其他模块只保存 `placeId`；不得复制名称和坐标形成第二份地点数据。

`route.stopIds[]` 表示全程停靠顺序，`route.legs[]` 使用 `fromPlaceId/toPlaceId` 连接相邻停靠点。每日 `items[].placeId` 和 `accommodation.startPlaceId/endPlaceId` 必须存在于 `places[]`。

仅用于 `venueSuggestions` 的候选店铺可标记 `usage=suggestion`，未知坐标必须使用 `coordinates=null` 且 `navigationEnabled=false`，不可伪造坐标。它们只提供文字地址地图搜索，不进入地图点位、路线、住宿、天气或真实预订台账。转为执行地点前必须补齐坐标并移除该标记。其他地点仍要求有效坐标。

## 每日执行条目

所有大交通按已确认时刻正常到发编排，包括飞机、火车、长途巴士和船班。手续、换乘、进出站与接驳时间按实际依据计入；不另加假设性延误缓冲，不因此减少当天内容或默认生成延误预案。已核实的停运、施工、班次变更或正常时刻也明确接不上的冲突，才写具体影响和调整。用户后续报告实际航变时按新事实更新。

`days[].routeNote` 可选，仅用于未启用 `dayNavigation` 的兼容路线串；紧凑当天行程汇总不展示备注。没有路线时不展示，不改动路线、交通或日历数据。

`days[].routeNoteAvatar` 可选，必须同时有 `routeNote`，为相对输出 HTML 的本地 JPG/PNG/WebP 路径（ASCII 文件名）；作为 1em 大小的行内头像显示于说明前。不接受远端地址、绝对路径或父目录跳转，不改变原图文件。

`days[]` 必须声明 `intensity: {score}`。`score` 使用 0–5 分并按 0.5 递增，页面固定显示为 `3.5 🌟`，渲染器不得舍弃或改写已有评分。评分衡量当天总负荷而非景点吸引力：0–2 分用于休整或短行程，2.5–3.5 分用于常规游览，4–4.5 分用于长时间步行、早出晚归、多段换乘或山地活动，5 分仅用于多个高负荷因素叠加。

`days[].items[]` 按执行顺序保存统一条目：

- `id`：全攻略唯一；
- `type`：`place`、`transport`、`reservation` 或 `note`；
- `placeId`：地点、预订和需要定位的交通节点使用；纯说明可为空；
- `title/activity`：可见标题和动作；
- `details[]`：同一区块的补充信息；与 `activity` 合计仅一条时不编号，多条时按 1、2、3 顺序显示；
- `notes[]`：需要强调的全部备注；统一进入黄色备注区，不混入底部交通耗时；
- `links[]`：可直接打开的 `{label,url}` 网页链接，URL 仅允许 `http(s)`；
- `referenceImages[]`（可选）：与本条目直接相关的本地参考图，每项包含安全相对路径 `src`、短标题 `title`、替代文本 `alt` 与用途说明 `caption`，最多 4 张。只用于停车表、路线图、经验截图等辅助执行信息；素材必须随最终 HTML 一并保留，不得用页尾图库代替节点挂接；
- `calendarHighlight`：布尔值，标记是否进入手机日历摘要；启用日历导出时每天选择 1–6 个主要时间/地点条目，不把全部网页内容写入 ICS；
- `startTime/endTime`：确定时使用 `HH:MM`；柔性安排使用空字符串，并在 `timeText` 中填写不超过 24 个字符的简短时间窗口（如“上午”“抵达后”“白天 · 晴天方案”），不得复制路线、标题或活动正文。`timeText` 即使含时钟字样也不是确定时间，不参与路线重算；
- `travelMinutes/stayMinutes`：非负整数；
- `transportMode`：到达本条目的方式；
- `navigationMode`（可选）：用户明确指定的单一路线查询方式，取 `driving/motorcycle/tuktuk/walking/transit/bus/ferry/cablecar/mountainrail/tram/monorail/minibus/rickshaw/bicycling`；只控制当日路线汇总及日历链接，不改变时间线和地图的原交通安排。与 `navigationOptions` 互斥。
- `navigationOptions`（可选，旧数据继续兼容）：填写该路段筛选后有价值且已核验方式和耗时的方案，可以只有一种，不设凑数下限或固定展示数量。非空时每项含 `mode/durationMinutes/recommended`，且恰有一项推荐；推荐耗时等于 `travelMinutes`，与 `navigationMode` 互斥。新写路段优先用此字段明确表达已选方案，不能以省略字段代替逐段研究。方式取值沿用 schema；切换只用于出行对比，跨断点、缺坐标或禁用导航不得生成链接。
- 选择遵循 [逐段交通研究与推荐](research-and-sources.md#逐段交通研究与推荐)：先积累当地游客经验，再匹配实际起终点、时段、门到门耗时、换乘、费用、行李、体力与用户偏好。步行、汽车、公共交通都只是候选，不要求每段齐全或逐类写排除理由。选择应有不同价值，不机械套用“驾车＋摩托车＋步行”组合；不合理、重复或无证据的方案省略，不在网页添加解释性废话。
- 当地实际适用时，可选择摩托车 `motorcycle`、突突车 `tuktuk`、轮船／渡轮 `ferry`、索道 `cablecar`、登山铁路 `mountainrail`、有轨电车 `tram`、单轨 `monorail`、地方小巴 `minibus`、人力车 `rickshaw` 或骑行 `bicycling`。`minibus` 可承载双条车、吉普尼等，页面使用当地真实名称。特色交通需核实本段运营范围、时段、可达性及耗时，不因目的地常见便套用全程。Google Maps 不支持专用方式时只打开通用起终点路线页，不伪造 `travelmode`。
- `breakGroundRoute`：长途交通、入住前或退房后断开地面线路；
- `reservationStatus`：`none`、`pending`、`confirmed` 或 `verify`；
- `sourceIds`：本地研究依据关联；只有入选补充阅读的条目才渲染公开角标，不要求所有依据展示。

确定时间必须满足 `endTime > startTime`。同一天相邻确定时间条目必须满足“上一条结束＋当前条目 travelMinutes ≤ 当前条目开始”；否则调整日程或把不确定时间改为柔性安排，不能绕过校验。

`days[].calendarNotes[]` 仅保存最多 3 条需要在手机日历中快速看到的预约、交通或风险提醒。普通介绍、完整攻略说明和次要备选留在网页中。

地点地址仍只保存在 `places[]`。同一地点在逐日时间线首次出现时显示地址，并链接 Google Maps；后续重复出现不再展示地址，避免页面冗余。

## 推荐模块整体备注

`recommendationNotes[]` 可完全省略；存在时每类最多保存一条 `{category,text,sourceIds}`。只有适用于整类内容、并会改变本次执行动作的特殊共同条件才写整体备注；没有这类信息时不创建字段。单店限制继续写在对应推荐项中，禁止逐项重复同一句通用提醒。`localKnowledge[]` 按适用性选择文化特点、会客礼仪、文化禁忌，每类最多一项，不复用推荐备注、不复制为核验清单，也不再投影到逐日行程。

逐日 `food[]/risks[]/alternatives[]/calendarNotes[]`、条目 `notes[]`、住宿 `note`、抵离 `reason/riskAlternative`、交通 `verification`、预算 `notes[]`、推荐 `limit/executionAdvice` 与 `recommendationNotes[]` 都可以从 JSON 中完全省略，并遵循“省略优先”。补充文字必须指出本行程特有的触发条件、实际影响或明确动作；一般常识、与结构化预约字段重复的信息及无法形成判断的模糊提醒不保存。明确的门票或预约事实写入 `reservationStatus`、`reservation` 或 `bookingLedger`，只有实名入口、最晚购买窗口、不可退改等特殊规则才另写说明。

## 住宿锚点与交通断点

`days[].accommodation` 使用：

- `label`：可见住宿说明；
- `startPlaceId`：当天出发住宿，可为空；
- `endPlaceId`：当天返回或入住住宿，可为空；
- `status`：`stay`、`checkin`、`checkout`、`transfer` 或 `none`；
- `note`（可选）：仅保存会改变当天执行动作的行李寄存、入住窗口等特殊说明；没有额外执行信息时省略。

普通住宿日允许绘制“住宿→首个地点”和“最后地点→住宿”。入住日不得在入住前假设从新酒店出发；退房后不得默认返回原酒店。`breakGroundRoute=true` 时结束当前路线段，后续从下一个有坐标地点重新开始。

## 地图和页面联动

- 地图只复用逐日行程的一排日期 Tab 与一张共用地图，切换后显示对应正式点及已核实道路；不再提供整程地图或第二排日期按钮。附近候选的窗口、数量与不显示日按 [逐日策略](nearby-explore.md)。
- 点击每日地点触发对应 Marker 放大/闪烁；点击 Marker 定位并高亮对应每日条目。
- 全程文字概览使用 `route.stopIds/legs`；逐日地图使用住宿锚点和 `days[].items`，只画 `dayRoadRoutes[]` 中已核实的腿，缺段可不画，不得混用。
- 页面初始化和地图失败降级继续遵循地图参考文件。

## 执行辅助组件

- 核验清单显示完成数、总数和百分比，支持全部/未完成/已完成筛选；天气始终位于筛选区域之后。
- 天气手动刷新成功后，把日期摘要同步到相同 `data-itinerary-date` 的每日卡片，并写入会话缓存；首次加载仍不联网。
- 每日卡片按相邻地点与到达条目的已选交通方案生成紧凑分段卡片，单方案与多方案均保留 emoji、耗时胶囊、推荐角标和对应路线入口，步行也支持步行导航。日历沿用原计划推荐方式链接，不生成全天多途经点导航。未知方式／缺坐标不擅自改为驾车。返酒店需要导航时显式安排末尾条目。
- `calendar.mode` 默认为 `daily`：每个旅行日导出一个全天事件；仅当用户明确需要精确提醒时设为 `timed`，只导出已标记且有确定开始时间的条目。SUMMARY 使用简短的 `Day N | 标题`，LOCATION 只放核心地名；DESCRIPTION 由结构化段落生成，只保留主要路线、时间、地点、交通、关键备注、必要链接和住宿。两种模式均由公共 ICS 资产生成，包含 UID、DTSTAMP、显式结束值、CRLF、UTF-8 75 字节折行和文本转义。
- `features.expenseTracker=true` 时启用本地实际支出记录、预算对比和 CSV 导出；只写 `localStorage`，不修改 `trip-data.json` 的计划预算。

出行模式可为条目设置可选 `days[].items[].photos[]`，每项包含本地相对路径 `src`、可访问描述 `alt` 和原始来源 `sourceId`，数组顺序即相册顺序。需要随图展示的署名和许可分别写入可选 `credit`、`license`，共用许可也可记在来源的 `license`。缺省时可复用同地点推荐的已核实图片。菜单或换乘截图仍使用原有参考资料字段。
