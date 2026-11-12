# 双市场复盘融合设计开发文档

- 状态：方案仍有效。工程已按 Flask 应用重组，目录以第 4 节为准。
- 日期：2026-11-12
- 宿主：浏览器回放界面，由 Flask 托管
- 迁入：`KLinePlayground` 的用户战绩和 AI 介入
- 范围：A 股与加密货币共用同一套历史 K 线回放内核，交易规则分开

本文仍是方案和验收依据。目录调整不改变交易规则、复权口径，也不把回放指针搬回 Flask。旧路径 `LocalBarReplay/server/companion_app.py` 不再使用。

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
  AI Key 只留在服务端，尚未接入
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

不改获取链路：Binance、分页、IndexedDB、CSV 导出和导入。

从 `127.0.0.1` 打开页面后，要用一次真实请求确认 Binance 的 CORS。若失败，再给伴随服务加代理。这是后备，不提前把加密货币数据搬进 Python。

### 8.2 A 股

浏览器不直接调用 AkShare。伴随服务提供：

`GET /api/ashare/klines?code=&start=&end=&adjust=none|qfq|hfq&source=auto|akshare|mootdx|offline`

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
`js/bridge.js` 仍在 `app/static/js/bridge.js`。下单改走规则对象仍放到实时 AI 阶段。

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
- AI 配置和局后点评仍是后续接口，不在当前工厂里假装已经完成。

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

- 配置页和点评按钮。
- 无 Key 时给出明确错误。
- 有 Key 时，点评包含代码、收益和至少一笔交易。没有 Key 的环境不伪造通过。

### 阶段 5：实时介入

- bridge 下单走市场规则。
- 再接逐根决策。
- 不恢复第二个测试器窗口。

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

## 16. 实施入口

确认本文后从阶段 1 开始。

阶段 1 不启动伴随服务，不改加密货币成交公式，不删除 KLinePlayground 现有入口。
