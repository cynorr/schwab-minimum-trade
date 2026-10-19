# V1.2 开发方案（review 修订）

以 `backend-design.md` 及本次 review 为开发基准。单文件、单进程、内存状态、固定账户；接口监听 `127.0.0.1:5678`。

## 实现约定

1. 普通配置直接放在 `schwab_backend.py` 顶部常量中。买入金额上限 $20,000，突破单最大估算损失 $500，最大止损比例 10%，默认突破加价 $0.01。
2. Keychain 只使用 `client_secret` 和 `oauth_tokens` 两个条目；Token、刷新凭据及过期时间以一个 JSON 字符串一次保存。共享刷新锁与每 5 秒重新授权检测保留。
3. 市价买入和突破买入执行买入金额校验。市价卖出只查最新持仓并校验可卖数量；修改止损校验目标类型/状态和新价格，不受买入金额上限限制。
4. 每个交易操作最多一次券商写请求。只保留请求进行中的并发锁；unknown 要求人工核对，请求结束后释放锁，不要求重启，也不自动重试。
5. 改单拿到新订单 ID 后触发后台刷新并立即返回 `verified: false`。订单树完全来自 Schwab 查询，不手工拼接。
6. 使用标准库 `json.dumps(payload, default=decimal_text)` 序列化请求；OAuth Callback 使用普通可见输入；CLI 错误显示异常类型与基础信息。
7. 保留 WebSocket 登录和订阅确认、SUBS/ADD、重连订阅恢复、历史成交声音过滤，以及共享正在执行的 REST 刷新任务。
8. `maintain()` 合并定时轮询与事件刷新；等待最多 5 秒，事件到达立即唤醒，刷新期间的事件保留到下一轮。
9. HTTP 入口统一执行 Pydantic 参数校验，内部网关不重复构造请求模型；标准 CORS 中间件处理预检，DELETE 只处理路径中的订单 ID。REST 成功响应按 Schwab schema 读取，不逐层重复检查容器类型。
10. Replace 复用 `order_payload()`，取消深拷贝；保留原数量、有效期、税批次及其他已有可提交设置，避免简单重建导致“只改止损价”的语义变化。
11. Replace 的整股数量仅以 JSON 整数放在订单腿部；支持腿部缺失时回退顶层，不再复制顶层数量或覆盖转换结果。非整股及缺失必要信息返回明确错误。移除 STOP 无关的限价字段，保留原触发设置并按其数值类型发送。
12. `SCHWAB_REJECTED.details` 提供 HTTP 状态及券商 `message`、`errors`；空正文或非 JSON 正文不掩盖拒单。写请求仍零重试。
13. 账户余额直接映射 `currentBalances.availableFunds`、`currentBalances.intradayBuyingPowerAmount` 与 `projectedBalances.stockBuyingPower`，保留旧购买力字段。前端顶部依次显示 Net Liq、Stock BP、Intraday BP、Available Dollars、Balance；仅 Balance 按用户要求合并 cash_balance 与 margin_balance 并保留来源说明，Long Value 移至 Holdings 汇总。

14. Orders/SSE 每个订单仅增加 executions 成交数组；Sold Today 由前端按美东日期、SELL/FILLED 和股票聚合，保留逐笔追溯，独立于当前持仓。移除页面会话成交历史缓存；不增加接口、transactions 查询、轮询任务或持久化。范围排除跨日分批成交与部分成交后撤单。

15. UI 使用 `/` 搜索、固定标尺与原生移动滑块、订单全展开、整数资金栏及与 Value 对齐的 Long Value。Quote 保持 fields=quote，只映射已有 Last/Close 字段用于默认价降级；Positions 增加原生持仓浮盈，前端同列展示浮盈和当日盈亏及百分比。无新 Endpoint 或额外轮询。

### 本轮网络影响核对

Account/Orders 轮询和 Streaming 订阅不变；Quote 仍按需查询，共用报价函数保持原有 fields=quote，不新增数据组、接口、调用频率或券商响应负担。Last/Close 和持仓浮盈原已在现有响应中，仅增加本地字段映射。前端仅用纽约工作日 09:30–16:00 与正值 High/Low 选择默认价；其他时间或缺失时按 Ask/Bid → Last → Close 降级，全部缺失留空。该时钟规则不等同于完整交易日历。后端旧字段及交易规则语义保持不变。


## 验证结果

- 后端 119 项、前端 67 项测试及生产构建通过。新增覆盖真实成交字段格式、父子单、相同成交保留、订单去重、加权均价、纽约日期及页面恢复；保留余额与交易交互测试。
- 静态检查、格式检查、CLI 帮助和 LaunchAgent 模板语法检查通过。
- 已在 `127.0.0.1:5678` 加载新版服务：REST 与 Streaming 连接正常，274 个订单（含子单）均有 executions 数组；69 个 FILLED 股票 SELL 订单共 118 笔成交，与 Schwab 原始条数及数量合计一致。另有 2 个非 EQUITY 卖单不纳入统计。GET/SSE 均验证；当前美东周日无当日卖出，页面显示 No sales today。
- 真实 Schwab Production App 的授权、OTO 子单激活/部分成交、Replace、真实睡眠恢复和成交声音仍需实盘验收。

自动化测试使用虚构凭据和模拟 Schwab；余额与成交字段另使用现有授权执行真实账户 GET 核对，没有提交真实交易。LaunchAgent 模板已同步为直接运行脚本，未安装常驻服务。

错误样本依据设计文档引用的 [Trader OpenAPI 副本](https://github.com/Patch-Code-Prosperity/Schwab-API-Sandbox/blob/main/account_orders_openapi.yaml) 中的 HTTP 状态和 `ServiceError`（`message`、`errors`）结构构造，文本是测试占位值，不是真实账户错误录制。移除人为构造的成功报价响应含 null 用例；Tick Size 等券商规则交给 Schwab，不为模拟用例添加本地规则。
