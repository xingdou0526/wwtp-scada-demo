# 水质净化厂智能中控仿真平台 · 任务交接文档

> 用途：交接给下一个 Agent 继续开发。本文档包含整体需求、已完成能力、待办事项和注意事项。
> 更新时间：2026-11-23

---

## 一、整体需求

### 1.1 业务背景

- 源于某客户（大亚湾第一水质净化厂三期，MBR 工艺）业务调研，现场拍摄了 19 张中控照片（位于 `e:\Mine\Trae Project\pictures`，已按工艺环节重命名）。
- 前期已产出两份资料，供理解业务：
  - `e:\Mine\Trae Project\污水处理工艺流程详解.html`
  - `e:\Mine\Trae Project\污水处理关键环节参数元数据总表.xlsx`（含阅读说明页，蓝色高亮行为重点）

### 1.2 项目定位

**曝气环节 AI 辅助决策 · 预研 Demo**，验证四件事：
1. 什么工况下应调整曝气；
2. 调整依据是否充分、可解释；
3. 建议幅度是否合理；
4. 人工执行后 DO、氨氮、风量、能耗如何变化。

### 1.3 核心约束（必须遵守）

| 约束 | 说明 |
|:---|:---|
| AI 只建议，不控制 | 所有调节必须人工点击"采纳并手动执行"并二次确认 |
| 已有 DO 自动联动 | AI 只建议调整 **DO 目标值**，不直接控制风机转速/风量 |
| 全部模拟数据 | 不连接任何真实设备，执行只改变仿真设定 |
| 本地运行 | Node 服务 + 本地前端，无云端依赖、无数据库（预研用内存/JSON 文件） |
| 模拟结果不作承诺 | 仿真节能率不能作为实际项目承诺 |

### 1.4 功能模块

1. **中控主页面**：仿 SCADA 工艺画面 + 各环节实时数据 + 趋势曲线；
2. **外部因素按钮**：暴雨/季节（单按钮三态）/夜间/进水氨氮冲击 + 数据异常注入 + 复位，只改仿真边界条件，数据按模型自然传导；
3. **AI 建议侧栏**：对话式面板，建议含动作/依据/预计效果/约束/风险/有效期，人工执行与忽略，术语悬浮解释；
4. **后台管理**（待做）：知识库（人工维护型，不做 RAG）、术语库、规则参数、操作记录。

---

## 二、技术栈与项目结构

### 2.1 技术栈

- **前端** `web/`：Vite 6 + React 19 + TypeScript + Tailwind CSS v4（`@tailwindcss/vite`）
  - UI 组件：**coss ui**（`https://coss.com/ui/particles`，官方仓库 `cosscom/ui`，copy-paste 模式，基于 radix-ui + cva）
  - 图标：**lucide-react**（禁止 emoji/文字图标）
  - 无第三方图表库，趋势图为手写 SVG
- **后端** `server/`：Node 24 + Express 4 + cors，原生 ESM
- **端口**：后端 `3001`，前端 `5173`，Vite 已配置 `/api → http://localhost:3001` 代理

### 2.2 目录结构

```
wwtp-scada-demo/
├── HANDOFF.md                  ← 本文档
├── server/
│   ├── index.js                Express 入口、路由、1 秒 1 tick 驱动（1 tick=1 仿真分钟）
│   ├── simulator.js            工艺仿真引擎（因果动态、外部因素、数据质量异常）
│   ├── advisor.js              曝气决策规则引擎 R0~R4、约束拦截、操作记录
│   └── test-engine.js          引擎自动化测试（node test-engine.js）
└── web/
    ├── vite.config.js          别名 @→src、API 代理
    └── src/
        ├── App.tsx             固定布局主框架（h-screen，无整页滚动）
        ├── index.css           主题变量、指针光标、自定义滚动条、html/body 高度
        ├── lib/
        │   ├── api.ts          fetch 封装、时钟格式化
        │   └── terms.ts        16 条术语 + 自动匹配拆分
        ├── components/
        │   ├── ScenarioBar.tsx 外部因素与数据异常按钮区（固定宽度）
        │   ├── ProcessFlow.tsx 工艺流程卡片（主流程 5 张 + 辅助 3 张）
        │   ├── TrendChart.tsx  SVG 趋势图（支持参考虚线）
        │   ├── AdvicePanel.tsx AI 对话式侧栏（气泡建议、历史折叠、执行对话框）
        │   ├── Term.tsx        术语 Tooltip、ExplainText 自动标注
        │   └── ui/             16 个 coss ui 组件（button/badge/input/textarea/select/
        │                       tabs/table/dialog/switch/tooltip/scroll-area/label/
        │                       alert-dialog/popover/slider/sonner）
        └── lib/utils.ts        cn()
```

### 2.3 启动方式

```powershell
# 后端（先启动）
cd "e:\Mine\Trae Project\wwtp-scada-demo\server"; node index.js

# 前端
cd "e:\Mine\Trae Project\wwtp-scada-demo\web"; npx vite --host 127.0.0.1 --port 5173
```

依赖已安装完成，无需重新 install。修改 server 代码需重启 node 进程；web 有 HMR。

---

## 三、已完成能力

### Step 1：脚手架 ✅
- 前后端可运行，16 个 coss ui 官方组件源码已引入（导入路径已从 `@/registry/default/...` 改为 `@/lib/utils`、`@/components/ui/`）。
- 健康检查、API 代理、组件编译均验证通过。

### Step 2：仿真引擎 + 规则引擎 + API ✅
**仿真引擎（simulator.js）**：
- 进水日曲线（早晚高峰）；需氧量 OUR = f(流量, COD, 氨氮)；DO 平衡一阶响应（约 15 min）；出水氨氮滞后（约 90 min）；
- 联动控制模拟：`airflowDemand += err * 2.5`（已调优，勿随意加大，否则冲击工况 DO 不降，建议无法触发）；
- 风机功率 ≈ 55×(airflow/1100)³，累计电耗积分；
- 外部因素：storm（流量×1.4、稀释）、winter/summer（水温 12/28，互斥）、night（流量×0.6）、shock（氨氮×1.5）；
- 数据异常：doDrift（缓慢偏低，suspect）/doStuck（卡值，bad）/doSpike（跳变）/doOffline（中断，bad）；**测量值 measured.do 与真实值 bio.do 分离**，AI 用测量值。

**规则引擎（advisor.js）**：
- R0 数据不可用 → 仅排查建议，禁止调节；R1 DO 持续偏低 → 上调目标值；R2 低负荷 DO 偏高 → 节能下调（**冲击/负荷上升工况互斥**）；R3 负荷快速上升 → 观察提示；R4 氨氮超标但 DO 正常 → 排查非曝气因素；
- 同类建议冷却期（raise 15 / lower 90 / observe 60 / inspect 30~60 tick），防止刷屏；
- 执行拦截：范围 1.5~3.0、步长 0.2、最小间隔 30 tick、过期/重复/排查类不可执行；
- 操作记录结构已含 `before`（执行前快照）、`during`（动作+依据+预测）、`after`（复评回填）、`operatorNote`、`feedback`；`reviewOperations()` 在 30 tick 后自动回填 after。
- **测试：`node test-engine.js` 全部通过**（17 项，含冲击→建议→执行→回升→复评全链路）。

**API**：
| 端点 | 说明 |
|:---|:---|
| GET `/api/health` | 健康检查 |
| GET `/api/state` | state + limits + history(240 点) + activeAdvice + advices + operations |
| POST `/api/scenario` | `{key, enabled}`，key: storm/winter/summer/night/shock |
| POST `/api/fault` | `{type, enabled}`，type: doDrift/doStuck/doSpike/doOffline |
| POST `/api/advice/:id/execute` | `{operatorNote?}`，人工执行 |
| POST `/api/advice/:id/ignore` | 忽略建议 |
| POST `/api/reset` | 复位仿真并预热 |

### Step 3：中控主页面 ✅
- 主流程 5 卡片（进水/预处理/生化池/MBR 膜池/消毒出水）+ 辅助 3 卡片（风机房/加药间/污泥线），状态色绿/黄/红；
- 4 张趋势图：DO（含目标虚线）、风量、出水氨氮（含内控线）、风机功率；
- 浏览器实测：冲击后进水氨氮 25→37、DO 下降、出水氨氮随后上升，因果联动正确。

### Step 4：AI 建议侧栏 ✅
- **对话式面板**（非普通卡片）：蓝色标题栏"AI 曝气决策助手" + 监测中呼吸灯 + AI 头像气泡 + 底部声明；
- 建议气泡含：类型/优先级、DO 目标值变化高亮、判断依据、预计效果、约束检查、风险提示、知识条目引用、有效期倒计时；
- 采纳并手动执行 → AlertDialog 二次确认（含人工备注 Textarea）→ 执行；忽略按钮；blocked 时禁用；
- **历史建议在面板顶部折叠**，点击展开/收起；
- 术语悬浮解释：16 条术语自动识别、虚线下划、hover 显示通俗解释；
- 全流程浏览器实测通过（建议 2.0→2.2、执行成功、历史状态正确）。

### UI 专项修复（均已完成，勿回退）
1. 全局指针光标 `cursor: pointer`（button/role=button/switch/tab/slider/a）；
2. 自定义滚动条（Webkit + Firefox），隐藏原生样式与箭头按钮；
3. 按钮固定宽度：场景 `w-[132px]`、异常 `w-[124px]`，状态切换不变宽；
4. 冬季/夏季合并为单按钮三态循环（常温→冬季→夏季→常温）；
5. **整页无垂直滚动条**：`html,body,#root{height:100%}`、`body{overflow:hidden}`、外层 `h-screen`、header `shrink-0`、main `min-h-0 overflow-hidden`；左侧工艺区 `lg:overflow-y-auto`、AI 面板 `lg:h-full` 内部滚动；窄屏由主容器内部滚动（非 body）。

---

## 四、待办事项

### Step 5：操作记录库（下一步）
- 后端：
  - 操作记录**持久化到本地 JSON 文件**（当前仅内存，重启丢失），如 `server/data/operations.json`，启动时加载；
  - 支持**补录/编辑人工描述与效果评价**：`operatorNote` 已有，`feedback` 字段已预留，需新增接口（如 `POST /api/operations/:id/feedback`，内容含人工描述、实际效果评价、是否建议有效等）；
  - 记录列表查询接口（可含筛选）。
- 前端：
  - 操作记录查看入口（可在 AI 面板增加"操作记录"折叠区，或独立视图/弹窗）；
  - 展示每次执行的"前 → 中 → 后"数据对比（DO/风量/氨氮/功率 before vs after）、人工备注、复评状态；
  - 支持补录人工描述与效果反馈，为后续规则优化提供数据。
- 目标：形成"建议-执行-效果-人工反馈"的完整闭环记录。

### Step 6：后台管理页
- 知识库：文本/Markdown 上传、条目管理（人工维护型，不做向量检索/RAG）；条目编号与建议的 `knowledgeRef`（KB-AER-001~004）对应，建议可溯源；
- 术语库：预置 `web/src/lib/terms.ts` 的 16 条，支持增删改（如需前后端共享，迁至后端并加 API）；
- 规则参数配置：DO 范围、步长、间隔、内控氨氮等（`simulator.js` 的 LIMITS）可视化编辑；
- 操作记录查询（与 Step 5 联动）。

### Step 7：整体验证
按 10 个场景走查：正常稳态、负荷突增、夜间低负荷节能、DO 真实偏低、探头漂移/卡值/中断、风量反馈异常、氨氮升高但 DO 正常、人工忽略不生效、复评前禁止连续调节；做"固定目标 vs AI 建议"基线对比（同随机种子）。

### 遗留优化（用户明确要求）
- **信息展示卡片的前端样式、展示与交互效果需专项优化**（ProcessFlow 各卡片），当前仅为可用状态。

---

## 五、注意事项

### 5.1 UI 硬性要求（用户反复强调）
- **必须使用 coss ui 组件**（`src/components/ui/` 内已下载的组件），禁止浏览器原生表单样式；
- **图标一律 lucide-react，禁止 emoji/文字图标**；
- **禁止整页垂直滚动条**（区域内部滚动允许，且必须自定义样式）；横向滚动条同样需自定义样式；
- 按钮状态切换**宽度不得变化**（用固定宽度类）；
- HTML 结构语义化（header/main/section/article/aside 等已在用）。

### 5.2 业务规则注意事项
- AI 建议对象只有 `doSetpoint`，前端文案保持"由现有联动系统自动调整风量"；
- 节能建议在 shock/storm/负荷上升时禁止（曾因此误发反向建议，已修复，回归测试勿删）；
- 数据质量 suspect 时不出调节建议，bad 时仅排查建议；
- `nearAirflowCap`（风量>95% 上限）时不再上调 DO 目标，改提示核查供氧能力。

### 5.3 仿真调参经验
- 联动增益 `err * 2.5` 是调优结果：过大会导致冲击时 DO 不降、R1 永不触发；过小则稳态偏差大、执行后恢复慢；
- 测试脚本预热 300 tick；服务启动预热 120 tick；
- `simulator.js` 的 `tempFactor` 仅用于硝化能力与夏季氧转移，勿再加到 OUR 公式（曾因此逻辑反向）。

### 5.4 环境与工具
- **无 git 命令**；`raw.githubusercontent.com` 连接被重置，下载 GitHub 文件需用 `https://api.github.com/repos/.../contents/...`（base64 解码），Node 内置 fetch 可用，请求带 `User-Agent` 头；
- npm 已装好全部依赖；node 后台服务用 Shell `run_in_background` 启动，改代码后用 StopCommand 停掉再重启；
- 前端验证可用 browser_use agent 打开 `http://127.0.0.1:5173`，其默认视口约 599px（窄屏单列），桌面双栏验证需 ≥1440px 视口；
- 后端回归：`cd server; node test-engine.js`。

### 5.5 当前运行状态
- 后端 `node index.js`（3001）与前端 Vite（5173）均在后台运行中；
- 浏览器曾完整执行过 ADV-019（DO 2.0→2.2，备注"测试执行备注"），重启后端会清空内存数据（操作记录持久化是 Step 5 的内容）。

---

## 六、快速接手指引

1. 阅读本文件 + `server/simulator.js` 头部 LIMITS、`server/advisor.js` 的 R0~R4；
2. 运行 `node test-engine.js` 确认引擎健康；
3. 打开 `http://127.0.0.1:5173`，点"进水氨氮冲击"观察建议生成与执行流程；
4. 从 **Step 5（操作记录库）** 开始继续开发。
