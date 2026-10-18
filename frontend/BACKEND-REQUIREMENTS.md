# 下一版后端数据需求

本文件是前端重构发现的数据缺口清单，不是本次后端修改方案。本次没有修改后端代码、配置、交易逻辑或请求重试规则。

## P0：与 thinkorswim 对齐的 Available Dollars

当前 `/account` 只映射 `currentBalances.buyingPower`、`dayTradingBuyingPower` 等字段。前者是购买力，不能直接改名为 Available Dollars，不能按固定杠杆倍数折算。

需要：

- 核对同一账户、同一时间的 thinkorswim Available Dollars 与券商原始余额。候选字段包括 `availableFunds`、`availableFundsNonMarginableTrade`，以及 current/projected balances 的不同口径；先验证，再确定映射。
- 返回明确语义的 `available_funds: decimal string | null`，并记录数据来源、是否包含融资、挂单占用及未结算资金的处理口径。
- 保留 `buying_power` 的独立含义。缺失值返回 `null`，不返回推算值或零占位。
- 提供对应余额的真实更新时间。

验收：同一时间与 thinkorswim 对照；不能因为两个金额接近 2 倍或 4 倍而认定口径相同。

本次前端：显示 `Available —`，不拿购买力、现金余额或日内购买力替代。

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
