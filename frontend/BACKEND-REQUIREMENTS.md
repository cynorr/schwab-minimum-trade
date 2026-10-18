# 下一版后端数据需求

本文件记录前端需要的后端字段及尚未完成的数据缺口。余额映射与 Sold Today 所需成交字段已补齐；其余待办不属于本次开发范围。

## 已完成：客观展示账户余额（2026-10-18）

通过真实账户 GET 确认后，`/account` 新增以下原值映射：

| 输出字段 | 原始来源 | 显示标签 |
| --- | --- | --- |
| `available_funds` | `currentBalances.availableFunds` | Available Dollars |
| `intraday_buying_power` | `currentBalances.intradayBuyingPowerAmount` | Intraday BP |
| `stock_buying_power` | `projectedBalances.stockBuyingPower` | Stock BP |

保留 `buying_power` 和旧 `day_trading_buying_power` 的独立含义。真实响应中的 Intraday BP 与旧日内字段不同，不能互相替代。后端保留 Cash Balance 和 Margin Balance 两个原值；前端按用户要求相加显示为 Balance，悬停显示组成，不命名为 Cash & Sweep 或计息借款。所有新增字段仍为 `decimal string | null`，采用同一余额查询的更新时间。

前端按 API 原值中性显示，负数使用负号，不使用括号或风险颜色；悬停可查看原始来源。不增加 Schwab 查询次数。

## 已完成：从订单快照恢复 Sold Today（2026-10-19）

现有 `GET /orders`、`GET /orders/{id}` 和 SSE `snapshot_updated.orders` 为每个订单新增 `executions`，逐笔包含 `activity_id`、`leg_id`、`quantity`、`price`、`time`。金额和数量为十进制字符串，ID 为字符串，时间为 UTC ISO 8601；无成交返回空数组。父子订单使用相同结构。

前端只统计股票 SELL 且 FILLED 的订单，按最后成交时间判定美东当天，整单成交量计入当天；按股票显示卖出数量、加权均价、未扣费用总额、最后成交时间，并展开查看订单 ID、活动 ID、腿 ID 及各笔数量/价格/时间。相同成交三元组保留，重复出现的订单按订单 ID 去重。

部分卖出持仓或卖出后买回均保留记录，不以当前是否空仓判断。首次 GET、刷新和重连后的完整快照均可恢复，不依赖页面收到过实时成交事件。不计算已实现盈亏，不新增接口、transactions 请求或轮询任务。

约定范围：每单几秒内全部成交；不处理跨日分批成交、部分成交后撤单；止损单最多两周更新，位于现有 59 天创建时间查询窗口内。

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
