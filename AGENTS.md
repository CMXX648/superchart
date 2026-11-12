# 项目快照

细节和验收看 `docs/FUSION_DESIGN.md`。这里只保留会变的事实；改完一个大要点后更新进度，不要把设计稿抄进来。

## 目标

一套回放器，两个市场。浏览器里用 Lightweight Charts 逐根复盘；A 股与加密货币用开关区分交易规则。行情和已平仓记录进 SQLite。回放指针留在浏览器，不恢复旧的逐根 Flask 训练会话。

## 目录

```
run.py                 python run.py → http://127.0.0.1:8765
app/                   Flask 工厂：routes、services、db.py
app/templates/         index.html
app/static/            css、js、addons
data/replay.sqlite     运行时库，不提交
sdk/                   Python bridge
docs/                  设计稿与说明
KLinePlayground/       只复用行情代码，不提交
```

## 方向

先让 A 股日线在现有回放器里按现金账户规则跑通，再做战绩界面，然后是局后 AI。实时策略走现有 bridge，下单必须经过当前市场规则。加密货币盈亏公式保持 `价差 × 手数 × 杠杆`，除非该要点明确要求改它。

## 进度

已有：市场开关和规则分叉；Flask 托管与 `/static`；SQLite 的 `candles`、`users`、`sessions`、`trades`；A 股日线接口与缓存；日线基准周期不再被当成 5 分钟；侧栏战绩可按全部/A股/加密过滤；界面语言记在 localStorage（lbr_lang）。

未验证：A 股的佣金、T+1、印花税还没有用真实行情验收。

未做：局后 AI；bridge 下单走市场规则。

## 提交

不执行 git。只有行为、目录契约或数据口径变化时，才在回复末尾给一条中文提交说明和路径。文档措辞、本文件的小修订不给提交建议。
