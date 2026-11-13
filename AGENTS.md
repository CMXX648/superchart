# 项目快照

细节和验收看 `docs/FUSION_DESIGN.md`。改完一个大要点后更新本节进度。

## 目标

一套回放器，两个市场。浏览器里用 Lightweight Charts 逐根复盘；A 股与加密货币用开关区分交易规则。行情和已平仓记录进 SQLite。回放指针留在浏览器。

## 目录

```
run.py                 python run.py → http://127.0.0.1:8765
app/                   Flask 工厂：routes、services、db.py
app/templates/         index.html
app/static/            css、js、addons；语言在 js/i18n.js
data/replay.sqlite     运行时库，不提交
data/ai_config.json    服务端 AI 配置，不提交
sdk/                   Python bridge，端口 9876，下单走当前市场规则
docs/                  设计稿与说明
KLinePlayground/       只复用行情代码，不提交
```

## 方向

局后 AI 已接入。bridge 下单已走当前市场规则。下一步接逐根决策。加密货币盈亏公式保持 `价差 × 手数 × 杠杆`。

## 进度

阶段 4 局后 AI 已接入。阶段 5 进行中：bridge 下单走市场规则已完成，逐根决策未开始。

已有：市场开关和规则分叉；`/static` 托管；SQLite 的 `candles`、`users`、`sessions`、`trades`；A 股日线接口与缓存；日线基准周期；战绩按全部/A股/加密过滤；右上角中文/EN，选择存在 `localStorage` 的 `lbr_lang`。

局后 AI：右上角配置页，侧栏「结束本局」后点评。`GET/POST /api/ai/config` 只返回掩码；`POST /api/ai/review` 调 OpenAI 兼容接口。Key 在 `data/ai_config.json`，不进浏览器。没有 Key 时返回错误，不生成假点评。解析失败展示原文，不编造分数。提示词按市场切换。本地测试不调用真实模型，没有 Key 的环境不记为通过。

bridge 下单：`place_trade`、`close_trade`、`close_all` 都经 `TradingEngine` 走当前市场规则。A 股模式下整手、只做多、T+1、现金不足整笔拒绝，杠杆固定 1；拒绝时回 `{error, market}` 给 Python。`load_data` 的 `asset_type` 在 A 股模式下不生效。SDK 的事件处理放到单独任务，`on_candle` 里 `await place_trade()` 能拿到回复。验收：`tests/js/bridge_rules.test.js`（node 跑真实前端文件）和 `tests/test_bridge_sdk.py`，未在真实浏览器联调。

前置 30 根（第 17.3 节）：加密货币和 A 股获取后，`ReplayEngine.originIndex` 指向起点 T，T 之前最多 30 根当前显示周期的 K 线是背景，第一帧可见；到开头、后退、进度和根数计数都以 T 为 0，慢速子 K 线不退入背景。加密货币按显示周期向前换算请求窗口，缓存缺前缀时补拉并写回原键；A 股 `GET /api/ashare/klines` 加 `lookback`（最多 30，默认 0 即旧行为），两条返回路径都按交易日根数截取并带 `origin_time`。纯函数 `lookbackSlice`、`lookbackStartMs`（node：`tests/js/lookback.test.js`）和 `api.lookback_window`（`tests/test_ashare_window.py`）。未在真实浏览器里看过。

随机起点（第 17.2 节）：两个日期框旁的「随机」只填日期，不自动获取，不遮罩时间。加密货币用 `fetchBinanceKlinesPage(symbol, '5m', 0)`（被拒则 1）取最早一根，按显示周期留出前置 30 根和剩余 60 根，抽 UTC 日期。A 股 `random=1` 在服务端 `api.pick_random_origin` 抽日历日、非交易日取下一根，响应带 `origin_time`；不足 90 根回 422 `too_short`，前端给说明。

水平线与射线（第 17.4 节）：`app/static/js/drawings.js`，回放条上「水平线」「射线」「清空画线」。水平线是 `createPriceLine`，射线是 series primitive，从锚点穿过第二点向前裁到窗格边缘，不产生新时间。用户画线不进 `_positionLines` 和 `BridgeClient.drawings`，与止盈止损点选互斥；点线选中后 Delete/Backspace 删除，Ctrl+Z 撤销上一条；锚点晚于最后一根可见 K 线时隐藏。新一次加载和 `clearAll` 清空，不存库，不进 AI。node 测试用桩替代图表库，未在真实浏览器里看过。

未做：逐根决策；`trade_open`/`trade_close` 事件尚无调用方。

## 提交

不执行 git。只有行为、目录契约或数据口径变化时，才在回复末尾给一条中文用于git commit的提交说明。文档同步不给提交建议。
