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
sdk/                   Python bridge，端口 9876，尚未改下单规则
docs/                  设计稿与说明
KLinePlayground/       只复用行情代码，不提交
```

## 方向

局后 AI 已接入：结束本局后点评，Key 只留在服务端。下一步让 bridge 的下单走当前市场规则。加密货币盈亏公式保持 `价差 × 手数 × 杠杆`。

## 进度

阶段 4 局后 AI 已接入。阶段 5 未开始。

已有：市场开关和规则分叉；`/static` 托管；SQLite 的 `candles`、`users`、`sessions`、`trades`；A 股日线接口与缓存；日线基准周期；战绩按全部/A股/加密过滤；右上角中文/EN，选择存在 `localStorage` 的 `lbr_lang`。

局后 AI：右上角配置页，侧栏「结束本局」后点评。`GET/POST /api/ai/config` 只返回掩码；`POST /api/ai/review` 调 OpenAI 兼容接口。Key 在 `data/ai_config.json`，不进浏览器。没有 Key 时返回错误，不生成假点评。解析失败展示原文，不编造分数。提示词按市场切换。本地测试不调用真实模型，没有 Key 的环境不记为通过。

未做：bridge 下单走当前市场规则；逐根决策。佣金、T+1、印花税有代码，尚未单列验收记录。

## 提交

不执行 git。只有行为、目录契约或数据口径变化时，才在回复末尾给一条中文用于git commit的提交说明。文档同步不给提交建议。
