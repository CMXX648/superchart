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
sdk/                   Python bridge，端口 9876，尚未改下单规则
docs/                  设计稿与说明
KLinePlayground/       只复用行情代码，不提交
```

## 方向

下一步做局后 AI：结束本局后点评，Key 只留在服务端。再让 bridge 的下单走当前市场规则。加密货币盈亏公式保持 `价差 × 手数 × 杠杆`。

## 进度

用户已确认：Flask 服务能交易，平仓后侧栏战绩会出现。

已有：市场开关和规则分叉；`/static` 托管；SQLite 的 `candles`、`users`、`sessions`、`trades`；A 股日线接口与缓存；日线基准周期；战绩按全部/A股/加密过滤；右上角中文/EN，选择存在 `localStorage` 的 `lbr_lang`。

未做：局后 AI；bridge 下单走市场规则。佣金、T+1、印花税有代码，尚未单列验收记录。

## 提交

不执行 git。只有行为、目录契约或数据口径变化时，才在回复末尾给一条中文提交说明。文档同步不给提交建议。
