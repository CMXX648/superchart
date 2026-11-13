# 双市场复盘融合设计开发文档

- 状态：方案仍有效。工程已按 Flask 应用重组，目录以第 4 节为准。
- 日期：2026-11-12
- 宿主：浏览器回放界面，由 Flask 托管
- 迁入：`KLinePlayground` 的用户战绩和 AI 介入
- 范围：A 股与加密货币共用同一套历史 K 线回放内核，交易规则分开

本文仍是方案和验收依据。目录调整不改变交易规则、复权口径，也不把回放指针搬回 Flask。旧路径 `LocalBarReplay/server/companion_app.py` 不再使用。

## 当前进度（2026-11-12）

阶段 4 已接入。阶段 5 进行中：bridge 下单走市场规则已完成，逐根决策未开始。

用户已确认：用 `python run.py` 打开 `http://127.0.0.1:8765` 后，可以交易，平仓后侧栏战绩会出现。

已落地：市场开关与规则分叉；Flask 应用工厂和 `/static`；SQLite `data/replay.sqlite`（`candles`、`users`、`sessions`、`trades`）；A 股日线读取与缓存；日线基准周期；战绩按全部/A股/加密过滤；右上角语言切换，选择存在浏览器 `localStorage` 的 `lbr_lang`；局后 AI（`app/services/ai_review.py`，配置页和结束本局后的点评）。

局后 AI 口径：Key 在服务端 `data/ai_config.json`。`GET/POST /api/ai/config` 只返回掩码。`POST /api/ai/review` 调用 OpenAI 兼容 `/chat/completions`。没有 Key 时返回错误，不生成假点评。解析失败展示原文，不编造分数。没有 Key 的环境不把真实模型调用记为通过。

bridge 下单口径：`place_trade`、`close_trade`、`close_all` 经 `TradingEngine` 走当前规则。A 股拒绝时回 `{error, market}`。A 股的整手、T+1、佣金、印花税由 `tests/js/bridge_rules.test.js` 覆盖，未在真实浏览器联调。

下一步：逐根决策。随机起点、前置 K 线和画线只写入第 17 节，尚未实现。不插入阶段 5，也不改交易规则。

日常进度以 `AGENTS.md` 为准。本节只在阶段切换时更新。

## 1. 结论

可以同时兼容两个市场。兼容的方式不是把两套成交公式合成一个，而是共用回放和绘图，用市场配置切换规则、数据和账户。

已锁定：

1. 交互以 LocalBarReplay 为基底：播放、暂停、前进、后退、拖动进度、变速、只看开盘价、图表点选止盈止损。
2. 绘图继续用 TradingView Lightweight Charts v5。不把 KLinePlayground 的图表调用搬过来。
3. 顶栏增加市场开关：A股 / 加密货币。开关切换的是交易制度，不只是换一组行情代码。
4. 用户战绩和 AI 迁入这个前端。旧桌面版在融合验收前保持原样，不删除，也不当成新内核。
5. 回放指针留在浏览器。不再恢复「每推进一根 K 线就请求 Flask」的旧训练会话。

## 2. 需求与边界

### 2.1 已确认的需求

- 两个市场都用历史数据做 K 线绘制和逐根回放复盘。
- 前端交互以 LocalBarReplay 为准。
- 用一个切换按钮区分 A 股和加密货币的交易方式。
- 保留 KLinePlayground 里已经做出来、并且值得留下的能力：用户战绩、AI 介入。

### 2.2 本文加的边界

这些边界用来防止实施时做成另一个大而全系统。若后续要放开，单独改本文，不在实现里顺手扩大。

- 第一版正式进入开关的只有 A 股和加密货币。LocalBarReplay 已有的 Forex 页保留，不进市场开关，也不套用 A 股规则。
- 不做实盘下单。界面和文档都不使用「实盘回测」字样。
- 第一版不移植筹码分布、盲盒、动态前复权。可以后做，不阻塞融合。
- AI API Key 不进前端仓库，也不进浏览器本地存储的明文配置。
- 不把旧用户库 `users/<name>/training_history.db` 直接当成新库写入。
- 随机起点、前置 30 根和水平线/射线的口径在第 17 节。实现时不顺手加趋势线、价格归一化，也不把 Forex 或 CSV 算进这一刀。

## 3. 现状

以下是当前代码里的事实，不是目标架构。

### 3.1 KLinePlayground

- 桌面壳是 `webview_app/main_pywebview.py`。它找空闲端口启动 Flask，再把页面嵌进窗口。
- 交易真相在 `backend/trade_simulator_enhanced.py`。买入按手，1 手 = 100 股。佣金有费率和最低佣金。印花税只在卖出收取。可卖数量受 T+1 限制。持仓按批次记录。
- 现有模拟器默认参数是：佣金费率 `0.0003`，最低佣金 `5`，印花税率 `0.001`。用户设置里的默认初始资金是 `100000`，默认复权是 `forward`。这些是代码里的训练默认值，不是对现行税费的声明。印花税默认值可能与现行法定税率不一致；融合版沿用它，是为了和旧训练器的第一眼结果一致，并且必须允许修改。
- 行情在 `backend/data_manager.py`，来源包括 AkShare、mootdx、离线 CSV，可选 xtquant。复权、指标和筹码在 `backend/kline_processor_enhanced.py`。主周期是日 K，可以重采样周 K。
- 用户战绩在 `backend/history_manager.py` 的 SQLite。会话记录收益率、最大回撤、交易胜率、局胜率。用户汇总记录累计局数、累计收益、最佳、最差、平均胜率、累计佣金。
- AI 有两条，彼此独立：
  - 局后点评：`POST /api/training/analyze_report`。服务端读取 OpenAI 兼容配置，根据复盘报告生成点评。
  - 实时介入：`ai_assistant_tester.py` 是另一个 PyWebView 窗口。它读取主程序暴露的 `training_id`，轮询 `/training/{id}/data` 和 `/account`，再 POST `/trade` 和 `/next`。
- 旧前端是 `frontend/js/main_enhanced.js`。图表库是本地打包的 Lightweight Charts，不是 LocalBarReplay 使用的 v5。

### 3.2 LocalBarReplay

- 无构建。打开 `index.html` 即可运行。
- 回放在 `js/replay.js`：播放、进退、拖动、约 0.1x 到 20x、只看开盘。
- 图在 `js/chart.js`，库为 Lightweight Charts v5。
- 交易在 `js/trading.js`。加密货币盈亏是 `价差 × 手数 × 杠杆`，允许多空，杠杆 1 到 125。外汇另有点值公式。没有 T+1，没有印花税。
- 数据在 `js/data.js` 和 `js/db.js`：Binance 5 分钟 K 线，IndexedDB 缓存，CSV 导入。另有 `sdk/mt5_fetch.py` 给外汇用。
- `js/aggregation.js` 把小于等于 5 分钟视为基准周期。速度小于 1 且显示周期大于 5 分钟时，回放会进入子 K 线模式，用更细的基准数据填当前柱。
- 扩展已有两套：Trade Addon 钩子，以及 `localhost:9876` 的 WebSocket bridge。bridge 已能接收每根 K 线、画标记、下单。

### 3.3 不能直接拼接的原因

- 交易语义不同。加密货币的空单和杠杆不能套到 A 股现金账户上。
- 数据粒度不同。加密货币基准是 5 分钟。A 股现成数据是日线，并带复权。把日线塞进「基准一定是 5 分钟」的聚合器后，慢速播放会进入没有意义的子 K 线模式。
- 图表 API 版本不同。不迁移 `main_enhanced.js`。
- A 股行情、用户库和 API Key 不能只放在浏览器里。AkShare 有跨域和运行环境问题。
- 用 `file://` 打开页面时，浏览器通常不能稳定调用 `127.0.0.1`。融合后的页面要由本地服务托管。
- 旧用户库没有 `market` 字段。直接写入会把两种市场的战绩混进同一套 A 股口径。
- 旧 AI 测试器依赖主程序的 `training_id`。新内核不再创建这种会话，所以不能把 `ai_assistant_tester.py` 原样拷过来就算迁移完成。

## 4. 架构

```
浏览器
  app/templates/index.html
  app/static/js            回放、图表、市场规则
        |
        | HTTP 127.0.0.1:8765
        v
Flask 应用（run.py -> app.create_app）
  app/routes/web.py        页面与 docs
  app/routes/api.py        /api
  app/services/ashare.py   复用 KLinePlayground/backend/data_manager.py
  app/db.py                data/replay.sqlite
  AI Key 只留在服务端 data/ai_config.json
```

当前目录：

```
run.py
requirements.txt
app/
  __init__.py              create_app
  config.py
  db.py
  routes/web.py
  routes/api.py
  services/ashare.py
  templates/index.html
  static/css
  static/js
  static/addons
sdk/                       Python bridge，不进 static
docs/                      设计稿和原说明
data/replay.sqlite         运行时生成，不提交
KLinePlayground/           旧项目，只复用行情代码
```

数据职责分开：

- 加密货币行情仍由浏览器请求 Binance，并写入 IndexedDB。伴随服务默认不代理 Binance。
- A 股行情、用户战绩、AI Key 走伴随服务。
- WebSocket bridge 继续使用 `localhost:9876`，不和伴随服务抢端口。

回放引擎不知道佣金和 T+1。每一帧只把当前可见 K 线交给交易引擎。交易引擎询问当前市场规则。

## 5. 统一 K 线与回放

两边图表使用同一根 K 线结构：

```json
{ "time": 1710000000, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1 }
```

`time` 是 Unix 秒。A 股日线的 `time` 固定为该交易日的 `00:00:00Z`。不要用本地时区零点，避免同一天被拆成两根，或周 K 聚合边界漂移。

`bar_id` 可以附在数据上，只给战绩和 AI 使用，不参与绘图。

`ReplayEngine` 增加 `baseIntervalMinutes`：

| 市场 | 基准周期 | 可选显示周期 | 慢速子 K 线 |
| :--- | :--- | :--- | :--- |
| 加密货币 | 5 | 保持现有 5m 到 1D | 保持现有行为 |
| A 股 | 1440 | 日 K、周 K | 关闭 |

聚合只在目标周期大于基准周期时发生。`aggregation.js` 里写死的 `<= 5` 改成「小于等于当前基准周期则原样返回」。这是 A 股能进入同一回放器的前提，放在阶段 2 的第一步，不能后补。

A 股周 K 由日线在前端聚合。切换周期时沿用现有做法：按时间戳找最接近的位置，不把回放拉回开头。

只看开盘模式仍由回放引擎处理。交易取价：该模式用 `open`，否则用 `close`。这是训练简化，不是盘口撮合。

加密货币和 A 股获取后，回放指针从起点 T（`originIndex`）开始，可见切片含 T 之前最多 30 根显示 K 线作背景。CSV、Forex 和 bridge 的 `load_data` 仍从下标 0 开始。见第 17 节。

## 6. 市场开关

市场是配置，不是皮肤。

```js
{
  id: "ashare",
  label: "A股",
  currency: "CNY",
  defaultCapital: 100000,
  baseIntervalMinutes: 1440,
  rules: "ashare"
}
```

加密货币对应 `currency: "USDT"`、`defaultCapital: 10000`、`baseIntervalMinutes: 5`、`rules: "crypto"`。`10000` 是 LocalBarReplay 现有起始资金，不在融合时改掉。

切换步骤：

1. 若当前有持仓或已有成交，先确认。取消则停留在原市场。
2. 确认后，未平仓按当前可见价尝试强平。A 股若因 T+1 不能卖出，不允许切换，并说明原因。不能静默丢掉不可卖持仓。
3. 若本局已有成交，先走「结束本局」保存，再清空回放和持仓。
4. 切换数据页、下单面板、货币单位和周期列表。
5. 不自动拉行情。

两个市场的资金不共用。切回来时恢复该市场自己的设置，不把 USDT 余额带进人民币账户。

Forex 页只在加密货币模式下保留，沿用现有点值公式。切到 A 股时隐藏 Forex，避免第三套规则出现在 A 股界面。

## 7. 交易规则

`TradingEngine` 的开仓、平仓、逐根检查和盈亏改为调用当前规则对象。加密货币公式保持现在的实现，阶段 1 不重写。

规则对象至少提供：

- `canOpen(order, account, bar)`
- `open(order, account, bar)`
- `onTick(positions, bar)`
- `close(position, bar, reason)`
- `availableToSell(position, bar)`
- `estimateFee(side, amount)`
- `formatQuantity(order)`

### 7.1 加密货币

保持现有行为，作为回归基线：

- 允许做多、做空。
- 杠杆 1 到 125。
- 盈亏 = 价差 × 手数 × 杠杆。
- 止盈止损用当根 `high` / `low` 判断。开仓当根不触发。
- 不引入 T+1 和印花税。

### 7.2 A 股

对齐现有现金账户，不引入融资融券。

- 只能做多。没有可卖数量时，卖出不能开空。
- 数量单位改为手。1 手 = 100 股，必须是整数手。
- 杠杆固定为 1，界面隐藏杠杆控件。
- 买入费用 = `max(成交额 × 佣金费率, 最低佣金)`。现金不足则整笔拒绝，不部分成交。
- 卖出费用 = 佣金 + 成交额 × 印花税率。印花税只在卖出收取。
- T+1：可卖数量只统计买入交易日早于当前交易日的股数。当天买入不可卖。
- 持仓按批次记账。卖出扣减最早的可卖批次。盈亏按批次成本计算，不能复用 `价差 × 手数 × 杠杆`。
- 止盈止损可以保留，作为训练辅助。触发时仍走 T+1 和费用。当天买入后触发止损，不执行，界面提示「T+1，止损未执行」。

第一版默认模拟参数与旧模拟器一致，均可改：

- 初始资金 `100000` CNY
- 佣金费率 `0.0003`
- 最低佣金 `5`
- 印花税率 `0.001`，仅卖出
- 获取数据时的默认复权：`forward`

界面文案使用「模拟费率」。不要把这些数字写成现行法规。

成交价用当前可见价。日线没有逐笔盘口。

## 8. 数据

### 8.1 加密货币

不改获取链路：Binance、分页、IndexedDB、CSV 导出和导入。第 17 节要改起点和缓存覆盖检查，不把加密货币行情搬进 Python。

从 `127.0.0.1` 打开页面后，要用一次真实请求确认 Binance 的 CORS。若失败，再给伴随服务加代理。这是后备，不提前把加密货币数据搬进 Python。

### 8.2 A 股

浏览器不直接调用 AkShare。伴随服务提供：

`GET /api/ashare/klines?code=&start=&end=&adjust=none|qfq|hfq&source=auto|akshare|mootdx|offline`

`start` 现在会丢掉更早的日线。`end` 尚未被 `ashare_klines` 读取。随机和前置根数见第 17 节，这一刀不补 `end`。

响应至少包含：

```json
{
  "symbol": "600519",
  "name": "贵州茅台",
  "adjust": "qfq",
  "source": "akshare",
  "base_interval": "1d",
  "candles": []
}
```

实现复用上级 `backend/data_manager.py` 和现有复权计算。不在 JavaScript 里重写复权。不 import `app_enhanced.py` 里的 `active_trainings`。

复权方式在获取时选定。更换复权等于重新加载，必须重置回放和持仓。第一版不做动态前复权。

CSV 仍可导入。导入后服从当前市场规则。界面要始终显示当前规则名称，避免用户用 A 股规则交易一份加密货币 CSV 而不自知。

## 9. 用户战绩

迁移口径，不挂旧表。

新库路径：`data/replay.sqlite`。表名是 `users`、`sessions`、`trades`、`candles`，不使用旧文档里的 `replay_stats.sqlite`。

不写入 `users/<name>/training_history.db`。旧库没有市场字段，会话也是按训练中逐笔写入；新模型是浏览器回放，结束时一次提交。自动导入旧库放到阶段 6，第一版不做。

表：

- `users`：用户名、创建时间
- `sessions`：用户、market、symbol、名称、复权、开始、结束、初始资金、期末资金、收益率、最大回撤、成交笔数、交易胜率、局胜率、佣金、印花税
- `trades`：会话、方向、数量、价格、费用、交易日、bar 序号、盈亏
- `user_statistics`：主键是用户 + 市场

结束本局时，前端提交成交明细和资金曲线。收益率、回撤、胜率由服务端按明细重算。前端可以先显示本地结果，但入库以服务端结果为准。

口径与旧库对齐：

- 交易胜率 = 平仓盈利笔数 / 平仓笔数
- 局胜率 = 本局收益率大于 0 则为 1，否则为 0
- 用户汇总保留累计局数、累计收益、最佳、最差、平均交易胜率、平均局胜率、累计费用

界面：

- 顶栏显示当前用户，可创建和切换
- 战绩可按市场过滤，也可看全部
- 历史列表能打开成交明细

伴随服务未启动时：

- 加密货币回放不受影响
- 本局报告先写入 localStorage，连接恢复后补传
- A 股拉不到行情就不能开始。界面直接说明服务未连接，不显示空图假装加载成功

## 10. AI

分两段做。局后点评先迁。实时介入后迁，并且不恢复第二个测试器窗口。

### 10.1 局后点评

对应旧的 `analyze_report_with_ai`。

- 入口在「结束本局」之后。
- 请求发到伴随服务。`GET /api/ai/config` 只返回是否已配置、模型名和掩码，不返回完整 Key。
- Key、`base_url`、`model` 存在服务端。协议仍是 OpenAI 兼容的 `/chat/completions`。
- 提示词按市场切换。A 股上下文必须包含 T+1、整手、佣金和印花税。加密货币上下文必须包含杠杆、多空和止盈止损。
- 输出尽量分成四节：优点、风险、改进、0 到 100 分。解析失败就展示原文，不编造分数。
- 没有 Key 时返回明确错误。前端不得显示假点评。

### 10.2 实时介入

不迁移 `ai_assistant_tester.py` 的窗口，也不再依赖 `training_id`。

实时通道用已有 bridge：

- 图表继续推 `candle`、`trade_open`、`trade_close`
- Python 或模型返回买、卖、观望
- 真正下单必须进入当前 `MarketRules`

因此 A 股模式下，bridge 现有的 `place_trade` 不能绕过 T+1 和整手检查。拒绝时把原因回给 Python。这是接实时 AI 之前的必改项。

若仍要大模型逐根决策，由伴随服务提供 `POST /api/ai/decide`。它不属于局后点评的验收范围。

## 11. 前端改动

前端文件现在都在 `app/static` 和 `app/templates`：

- `app/static/js/market.js`：市场配置和切换
- `app/static/js/rules/crypto.js`
- `app/static/js/rules/ashare.js`
- `app/static/js/companion.js`：健康检查、拉数、用户、提交本局
- `app/templates/index.html`：市场开关和 A 股数据页
- `app/static/css/styles.css`
- `app/static/js/trading.js`、`replay.js`、`app.js`

`js/session.js` 没有单独建文件。本局提交放在 `companion.js`。
`js/bridge.js` 仍在 `app/static/js/bridge.js`。下单经 `TradingEngine` 走当前规则对象。

明确不改：

- 不移植 `frontend/js/main_enhanced.js`
- 不把 KLinePlayground 的 Flask 训练路由当成新内核
- 阶段 1 不改变加密货币的盈亏公式

## 12. 伴随服务

入口：`run.py`，调用 `app.create_app()`。

监听：`127.0.0.1:8765`

职责：

- `app/routes/web.py` 渲染 `app/templates/index.html`，静态文件走 `/static`。
- `app/routes/api.py` 提供行情、用户、会话和成交接口。
- `app/services/ashare.py` 复用 `KLinePlayground/backend/data_manager.py`。
- `app/db.py` 把 K 线和交易记录写入 `data/replay.sqlite`。
- pp/services/ai_review.py 读写服务端 AI 配置，并调用 OpenAI 兼容的 /chat/completions。

第一版路由：

| 方法 | 路径 | 作用 |
| :--- | :--- | :--- |
| GET | `/` | 前端 |
| GET | `/api/health` | 服务状态 |
| GET | `/api/ashare/klines` | 日线 |
| GET、POST | `/api/users` | 列表、创建 |
| GET | `/api/users/{name}/stats` | 汇总，可按 market 过滤 |
| GET | `/api/users/{name}/sessions` | 历史 |
| POST | `/api/sessions/complete` | 结束本局，服务端重算 |
| GET、POST | `/api/ai/config` | 读取掩码、保存配置 |
| POST | `/api/ai/review` | 局后点评 |

启动命令是仓库根目录的 `python run.py`，说明写在根目录 `README.md`。

## 13. 实施顺序

每阶段可以单独停。后一阶段依赖前一阶段验收。交易规则文件不要两个阶段同时改。

### 阶段 1：开关和规则分叉

- 加上市场开关和 A 股面板显隐。
- 抽出规则对象。
- 加密货币路径调用原公式。
- A 股面板即使还不能拉数，也不能提交杠杆空单。

验收：现有 Binance 获取、播放、进退、杠杆、止盈止损与改前一致。切到 A 股后杠杆控件消失，卖出不能开空。

### 阶段 2：A 股数据进入同一回放器

- 先改聚合器的基准周期。
- 伴随服务返回日线。
- 页面改为由 `8765` 打开。
- 日 K / 周 K 切换保持时间位置。

验收：一只 A 股代码能回放。买 1 手扣佣金。当日不可卖。下一交易日可卖，印花税只出现在卖出。T+1 未满足时不能切换市场。

### 阶段 3：用户战绩

- 新库和结束本局。
- 两个用户隔离。
- 同一用户可按市场过滤。

验收：刷新后历史仍在。服务端重算的收益率与明细一致。

### 阶段 4：AI 局后点评

状态：已接入。入口是「结束本局」。真实模型调用未在无 Key 环境里记为通过。

- 配置页和点评按钮。
- 无 Key 时给出明确错误。
- 有 Key 时，点评包含代码、收益和至少一笔交易。没有 Key 的环境不伪造通过。

### 阶段 5：实时介入

状态：bridge 下单走市场规则已完成；逐根决策未开始。

- bridge 下单走市场规则。已完成：A 股不能绕过整手和 T+1，拒绝原因回给 Python。
- 再接逐根决策。
- 不恢复第二个测试器窗口。

第 17 节的随机起点、前置 K 线和画线可以在阶段 5 之外单独做。它不依赖逐根决策，也不改变阶段 5 的验收。

### 阶段 6：可选

- PyWebView 壳，只负责打开 `http://127.0.0.1:8765`。
- 盲盒。
- 动态前复权。
- 旧用户库只读导入。

## 14. 风险

1. 聚合器若仍假设基准是 5 分钟，A 股日线在慢速播放时会进入错误的子 K 线模式。阶段 2 必须先改这个。
2. `file://` 调用本地接口不稳定。从阶段 2 起，说明里只推荐伴随服务地址。
3. 从 `127.0.0.1` 打开后，Binance 可能遇到 CORS。先实测，失败再加代理。
4. 更换复权后价格尺度变化。旧持仓成本不能延续，必须重置。
5. `ai_assistant_tester.py` 依赖旧训练会话。融合版不自动兼容它。
6. 日线止盈止损用 `high` / `low` 判断，会比真实盘中成交更理想化。这要在界面或帮助里说清楚。
7. 佣金和印花税默认值来自旧模拟器。它们是模拟参数，可能不等于用户券商费率或现行税率。

## 15. 未决项

不阻塞阶段 1。实施前若没有新的决定，按下列默认：

| 项 | 默认 |
| :--- | :--- |
| A 股初始资金 | `100000`，可改 |
| 选股方式 | 第一版只输入代码，不做名称搜索 |
| 盲盒 | 放到阶段 6 |
| 旧战绩 | 不自动导入 |
| Forex | 保留原页，不进市场开关 |
| 印花税默认 | 沿用旧代码 `0.001`，界面标明可改 |
| 随机起点、前置 K 线、画线 | 见第 17 节。随机是代选日期，不遮罩时间。若要改「30 根按显示周期计」或「随机按钮只填日期、不自动获取」，先改第 17 节再写代码 |

## 16. 实施入口

确认本文后从阶段 1 开始。

阶段 1 不启动伴随服务，不改加密货币成交公式，不删除 KLinePlayground 现有入口。

## 17. 随机起点、前置 K 线与画线

- 状态：17.3 前置 30 根、17.2 随机起点已实现；17.4 未实现。不插入阶段 5，不改交易规则、复权或盈亏公式。
- 日期：2026-11-13
- 范围：加密货币和 A 股。Forex 与 CSV 不在这一刀。

这三项是复盘观感，不是新的成交规则。下面把代码事实、不这样做就达不到原话的约束、以及可以改的默认分开写。实现时只改点名的文件。

### 17.1 当前代码里的事实

顶栏没有单独的「复盘日期」。日期在数据页里，不在回放条上：

- `#crypto-date`、`#ashare-date`、`#forex-date` 都在 `app/templates/index.html` 的 `#asset-panel`。
- `app/static/js/app.js` 的 `setDefaultDates` 先读 `localStorage` 的 `lbr_start_date`，没有则用 `toISOString()` 的日期再减 30 个日历日。加密货币获取成功后把所选日期写回这个键。
- 日期框的值是 `YYYY-MM-DD`。`new Date(startDate)` 按日期形式解析为 UTC 零点，不是本地零点。A 股 `date_to_unix` 也是 UTC 零点。两边日界一致。这一刀不要改成本地零点。

加密货币：`fetchAllBinanceData` 从该 UTC 零点取到现在。缓存键是 `symbol_5m_${startDate}`。`checkCache` 只要命中这个键，或找到一段第一根 `time` 不晚于请求起点的缓存，就整段返回。它不检查这段缓存是否覆盖起点之前的根。

A 股：`GET /api/ashare/klines` 先拿全量日线，再按 `start` 丢掉 `time < start` 的根。全量仍在 `data/replay.sqlite`。第 8.2 节查询串里的 `end`，`ashare_klines` 没有读。这一刀不补 `end`。

回放：`ReplayEngine.loadData` 把 `replayIndex` 和 `_baseIdx` 置 0。`_renderFrame` 只把聚合序列的 `[0, replayIndex]` 交给 `ChartManager.updateData`。加载、切周期、跳到头尾时调用 `fitContent()`。开局可见的通常只有第 1 根，价格轴也只按这根的高低缩放。播放中不再 `fitContent`，避免抢走滚动位置。

图表是 Lightweight Charts v5，由 `index.html` 从 unpkg 加载。没有画线工具栏。水平价格线已有两处：持仓的 `createPriceLine`，以及 bridge 的 `draw_hline`。bridge 的 `draw_line` 是两个时间点之间的线段，不是射线。持仓线每帧被 `updatePositionLines` 拆掉重建；`setData` 本身不会清掉价格线。

`aggregation.js` 的 `aggregateCandles` 仍在 `targetMinutes <= 5` 时原样返回。A 股日线周期是 1440，暂时走不到这个分支。前置根数必须在聚合后的显示序列上数，不能靠这个 `<= 5` 换算。

Forex 的「从 MT5 获取」仍是提示改用 CSV 的占位。CSV 没有按日期切片。这两页不做随机，也不注入前置 K 线。

### 17.2 随机起点

可行。随机是系统替用户选一个起点日期，不是盲测，也不遮罩时间。抽中之后，日期框、底部时间、时间轴和十字线都按现在的方式显示。用户可以看到自己被分到了哪一天。

必须这样：

1. `#crypto-date` 和 `#ashare-date` 旁各加一个「随机」按钮。点击后在有效区间抽一个真实起点，把 `YYYY-MM-DD` 写回对应日期框。不禁用日期框，也不隐藏抽中的日期。用户可以再改，再点获取。
2. 随机不改变时间显示。不改 `#current-datetime`，不改主图 `timeVisible`，不加时间遮罩。
3. 先确定起点 T，再按 17.3 向前取前置 K 线。T 必须落在真实 K 线上。A 股若抽中的日历日不是交易日，取该日之后的第一根日线，并把该交易日写回日期框。
4. 历史不够长时不要写入一个无法开局的日期，直接说明。见下面的最少剩余根数。
5. 获取成功后仍按现有逻辑把日期写入 `lbr_start_date`。随机选中的日期就是这次的选择结果，不要为了保密跳过保存。

默认，可以改，但要先改本节：

- 随机按钮只填日期，不自动开始获取。获取仍走现有按钮。
- 不隐藏代码。不禁用「到结尾」。这些本来就不是随机的范围。
- T 之后至少保留 60 根当前显示周期的 K 线。加密货币默认显示周期是 1 小时。A 股获取时把周期锁到日线，即至少 60 个交易日。加上前置 30 根，序列至少要有约 90 根显示 K 线才能随机。
- 加密货币的可用起点用现有的 `fetchBinanceKlinesPage(symbol, '5m', 0)`，取返回的第一根。不要新接 `exchangeInfo`。现货该接口的 `onboardDate` 这次没有被确认成稳定字段；合约接口才明确有它。`startTime=0` 若被拒绝，改为 1，不要写死年份。抽中的时间对齐到真实 K 线后，日期框写 UTC 日期，与现有 `new Date(startDate)` 的日界一致。
- A 股在服务端抽。全量日线已经在缓存或 `fetch_frame` 里。新增 `random=1`。响应带 `origin_time`，前端把它格式化成日期写回 `#ashare-date`，并把回放指针放到 T。
- 抽签和切片放在 `app/routes/api.py` 的纯函数里，便于单测。`app/services/ashare.py` 仍只负责取数和复权。

改点：

- `app/templates/index.html`：两个随机按钮。Forex 日期不加。
- `app/static/js/i18n.js`：中文和 EN。
- `app/static/js/app.js`：随机按钮写回日期框。加密货币随后仍用日期框的值去获取。不新增时间遮罩。
- `app/static/js/data.js`：按日期框里的起点获取。随机本身不改获取函数的时间语义。
- `app/static/js/companion.js` 与 `app/routes/api.py`：A 股随机请求带 `random=1`。前端用响应里的 `origin_time` 回填日期框。
- 不改 `replay.js` 和 `chart.js` 的时间显示。

### 17.3 前置 30 根

可行，而且应该做。观感问题有两层：数据从 T 才开始，看不到 T 之前的高低点；开局 `fitContent()` 又只套住已揭示的第 1 根，价格轴被这一根撑满。

只把 30 根拼到数组开头、仍从下标 0 播放，达不到原话。用户会先把背景走完，开局仍然只有 1 根，起点也从 T 变成了 T 之前。

必须这样：

1. 前置 K 线是背景，不是新的起点。交易、进度、回到开头、后退都停在 T。背景从第一帧起就可见，不能逐根播进去。
2. 按 K 线根数计，不按日历日减 30。A 股有休市，减 30 个日历日会少于 30 根。
3. 起点定义：基准数据聚合成当前显示周期后，第一根 `time >= T` 的显示 K 线是 origin。T 落在某根显示 K 线内部时，这根就是 origin，不把同一根里 T 之前的基准 K 线算进 30 根。
4. 基准数组从「第 30 根背景」所属的第一根基准 K 线截起。更早的基准 K 线不进入图表。
5. `loadData` 的 `replayIndex` 设为 origin，不是 0。第一帧可见切片是背景加上 origin。`fitContent()` 只套这个切片，不套尚未揭示的未来。播放中仍不调用 `fitContent()`。
6. 只看开盘价仍只压平当前最后一根，不压平背景。指标会用背景做预热。这是副作用，不单独做成指标功能。
7. 历史不足 30 根时用现有的，不报错。
8. 未来 K 线仍只留在内存里，不放进 `setData`。价格轴因此能看到 T 之前的高低，同时看不到 T 之后的走势。
9. 成交价仍是当前可见的最后一根。不改 `TradingEngine`。

默认：30 根按获取当时的显示周期计，常量名 `LOOKBACK_BARS = 30`。加密货币默认周期是 1 小时，所以向前取 30 根 1 小时 K 线，再折成 5 分钟向 Binance 请求。若按 30 根 5 分钟取，1 小时图上只有大约 2 根，看不到一段高低点。A 股获取时周期被锁成日线，就是 30 根日线。若要改成 30 根基准周期，只改变量语义，不改指针规则。获取之后再切到更大的周期，背景可能少于 30 根。不中途重新拉取。

缓存必须改，否则第二次获取会静默丢掉前置根。同一天的旧缓存往往从 T 开始。命中后若第一根晚于前置窗口的起点，要补拉缺失前缀再合并，并把合并结果写回原键。只改键名、不检查覆盖范围，会留下旧的短缓存。

A 股两条返回路径都要改：数据库命中，以及新拉取之后的过滤。现在两处都是 `time >= start` 就丢掉更早的根。改成从 origin 往前数最多 30 根日线，再连同 origin 及其后的全部日线返回。库存仍保存全量。不要把 T 之前的全部历史都发给浏览器。

加密货币的渐进加载也要带上 origin。现在第一页到了就从下标 0 开播。指针必须放在 T，不能放在前置窗口的第一根。

改点：

- `app/static/js/replay.js`：增加 `originIndex`。`goToStart`、`stepBack`、进度条和根数计数都以它为 0。进度是 `(replayIndex - originIndex) / (最后一根 - originIndex)`。根数计数不把背景算进分子。慢速子 K 线的 `_baseIdx` 不得退入背景。
- `app/static/js/app.js`：把显示周期和内部起点传给获取函数。A 股请求增加 `lookback=30`。
- `app/static/js/data.js`：按显示周期换算前置窗口，并修正缓存覆盖检查。
- `app/static/js/companion.js`：查询串增加 `lookback`。
- `app/routes/api.py`：过滤处按根数保留前置日线。随机和前置一起算：先定 origin，再向前数。

播放中保持固定可见根数是另一件事。这一刀不改成每帧 `setVisibleLogicalRange`。

### 17.4 水平线与射线

可行。不换图表库，也不把 KLinePlayground 的画线搬过来。

水平线用已有的 `candleSeries.createPriceLine`。一次点击，价格用现有的 `coordinateToPrice`，和止盈止损点选是同一套坐标转换。用户水平线不要放进 `_positionLines`，否则每帧会被拆掉。

射线不能照搬 bridge 的 `draw_line`。那是两个时间点的线段。用一根伸到未来时间的 `LineSeries` 假装射线，会把时间轴拉出尚未揭示的空白。射线用 Lightweight Charts v5 的 series primitive，在像素坐标里从锚点穿过第二点，只向第二点的方向延伸，并裁到窗格边缘。延伸不产生新的 K 线时间。

必须这样：

1. 用户画线不放进 `BridgeClient.drawings`。Python 的 `clear_drawings` 不得清掉用户的线，用户的清空也不得清掉 bridge 的线，也不得清掉持仓线。
2. 与止盈止损点选互斥。`ChartManager._pickMode` 活动时，点击仍只设置止盈或止损。画线模式活动时，点击不改止盈止损，也不下单。
3. 只活在当前这次加载里。`ChartManager.clearAll` 必须清掉用户画线。不进 SQLite，不进局后 AI 的上下文。
4. 必须能删。清空是底线。点击选中后，Delete 或 Backspace 删除选中项。再加撤销上一条。不做拖拽改点，不做样式面板。
5. 水平线没有时间，后退时仍留着。这是用户自己标的价格，不是未来行情。射线的锚点时间晚于当前最后一根可见 K 线时先隐藏，回放到那根再显示。每帧追加 K 线后要让 primitive 重绘。
6. 命中检测要避开持仓价格线和 bridge 的水平线。

默认：只有水平线和射线。射线可以是任意角度，不是只能画水平射线。方向是从第一点穿过第二点向前，不向后延长。工具放在图表旁或回放条上，两个市场都能用，不放进数据页。

改点：

- 新文件 `app/static/js/drawings.js`。`index.html` 在 `chart.js` 之后引入。
- `app/templates/index.html`：两个工具按钮和一个清空按钮。
- `app/static/css/styles.css`：选中态。沿用现有暗色按钮。
- `app/static/js/i18n.js`：工具名。
- `app/static/js/chart.js`：画线模式时现有点击处理直接返回。`clearAll` 调用画线层的清空。
- `app/static/js/replay.js`：每帧把最后一根可见时间交给画线层。
- 不改 `bridge.js` 的命令协议。

### 17.5 验收

未实现前，本节不算通过。指针和前置切片抽成纯函数后，用现有 `tests/js` 的 node 方式测。A 股切片用 `api.py` 的纯函数测。不把真实浏览器联调写成这一节的通过条件。

- 选定日期 T 后，第一帧能看到 T 之前最多 30 根当前显示周期的 K 线，以及 T 这根。再按「到开头」仍停在 T，不会把背景重播一遍。
- 加密货币在 1 小时周期下，前置窗口长于 30 根 5 分钟。重复获取同一天，前置根仍在。
- A 股休市日附近仍是 30 根日线，不是 30 个日历日。数据库命中和新拉取两条路径一致。历史不足时少几根，不报错。
- 点随机后，日期框出现抽中的日期。底部时间和主图时间轴仍显示绝对时间。再点获取，按这个日期开局。时间显示与手选日期时一致。
- 数据短于最少剩余根数时，随机给出说明，不开始一局只有几根的回放。
- 水平线在播放、前进、后退后仍在同一价格。射线不把时间轴撑出未来空白。后退到锚点之前，射线隐藏；再前进，射线回来。
- 画止盈止损时，点击不会多出一条用户画线。清空用户画线时，持仓线和 bridge 画线还在。
- Forex 和 CSV 的行为与改前一致。

### 17.6 不在这一刀

- 不禁用「到结尾」。
- 播放中不强制固定可见根数。
- 不保存画线，不增加线段、矩形、文字、斐波那契。
- 不隐藏或归一化价格。
- 不遮罩日期、时间轴或十字线。随机只负责代选日期。
- 不给 Forex、CSV 做随机或前置 K 线。
- 不实现已写入文档但代码未读的 `end` 参数。
- 不把加密货币行情搬进 Python。
