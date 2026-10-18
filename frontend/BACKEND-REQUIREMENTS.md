# 下一版后端数据需求

本文件记录前端需要的后端字段及尚未完成的数据缺口。余额映射已补齐；交易逻辑、请求重试规则及其他需求未在本次余额修改中调整。

## 已完成：客观展示账户余额（2026-10-18）

通过真实账户 GET 确认后，`/account` 新增以下原值映射：

| 输出字段 | 原始来源 | 显示标签 |
| --- | --- | --- |
| `available_funds` | `currentBalances.availableFunds` | Available Funds |
| `intraday_buying_power` | `currentBalances.intradayBuyingPowerAmount` | Intraday BP |
| `stock_buying_power` | `projectedBalances.stockBuyingPower` | Stock BP |

保留 `buying_power` 和旧 `day_trading_buying_power` 的独立含义。真实响应中的 Intraday BP 与旧日内字段不同，不能互相替代。Cash Balance 和 Margin Balance 分开展示，不自行合成为 Cash & Sweep，也不宣称已与 ToS 标签完成对照。所有新增字段仍为 `decimal string | null`，采用同一余额查询的更新时间。

前端按 API 原值中性显示，负数使用负号，不使用括号或风险颜色；悬停可查看原始来源。不增加 Schwab 查询次数。

## P0：可在首次加载及断线后恢复的当日清仓历史

当前订单快照只有 `entered_at`，它是委托创建时间，不是成交时间。已有 SSE `order_filled` 包含 `occurred_at`，但只推送实时事件，没有历史回放。页面关闭期间发生的成交无法从现有字段完整还原。

建议提供当日清仓查询，或在快照中增加等效数据。至少包括：

| 字段 | 含义 |
| --- | --- |
| `trading_date` / `timezone` | 纽约自然日日期，时区 `America/New_York`，正确处理夏令时 |
| `history_complete` / `updated_at` | 是否已取得完整当日历史，以及数据更新时间 |
| `symbol` | 股票代码 |
| `closure_id` | 稳定去重键；同日多轮买卖能够区分 |
| `closed_at` | 实际清仓时间，不使用委托创建时间 |
| `sold_quantity` | 本轮平仓卖出的真实数量，十进制字符串 |
| `average_exit_price` | 按实际成交加权的卖出均价，缺失时为 null |
| `realized_profit_loss` | 若能可靠计算则返回，明确成本/费用口径；否则为 null |
| `order_ids` / `execution_ids` | 对应成交与订单，用于追溯和去重 |

也可以提供完整的逐笔成交查询，由前端归组，但必须给出成交 ID、时间、方向、数量和价格，并提供足够信息判断从持仓到空仓的转换。仅给当前持仓和历史 SELL 订单不够。

验收：昨天创建但今天成交的 GTC/OTO 止损、部分卖出后最终清仓、一天多轮买卖、清仓后重新买入、纽约午夜、刷新页面及 SSE 断线后恢复。部分卖出不能标成清仓。

本次前端：`Closed today` 标记 `Session only`。只使用本次页面收到的 SELL 成交事件与确认归零的持仓；不根据 `entered_at` 猜测，不展示虚构的成交价或已实现盈亏。重新加载页面后不承诺保留这些记录。

## P1：只读风控配置

建议返回当前生效的 `max_order_amount_usd`、`max_loss_per_trade_usd`、`max_stop_loss_ratio`，供前端展示和预检，后端继续最终校验。

当前值为单笔买入 $20,000、突破单风险 $500、止损距离 10%。本次前端镜像这些既有值，未提高限制。用户常用的 $20k–30k 区间与现有买入上限有冲突，需要未来单独决定；此需求不代表授权调整限额。

## P1：High/Low 的时间与交易时段口径

建议在手动 Quote 响应中补充 `range_updated_at` 与 High/Low 对应的交易日期、时段口径，避免 Bid/Ask 的 Streaming 时间覆盖 High/Low 的 REST 时间后造成新鲜度误解。

**不要求增加轮询、自动刷新或唤醒后自动查询行情。** 当前标的行情仍由 Enter、刷新按钮和点击持仓等明确操作触发；现有 SSE Bid/Ask 更新可继续使用。

## 保持的交易契约

- 价格与金额使用十进制字符串，委托数量使用 JSON 正整数。
- 保留父子关系、订单 ID、真实状态和 `cancelable`。
- `ORDER_RESULT_UNKNOWN` 不自动重发；GET 刷新不等于交易结果已确认。
- 改止损仍只修改明确的单个订单，不在 symbol 聚合时合并或重建券商委托。
