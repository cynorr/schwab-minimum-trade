# Schwab Local Trading Frontend
## V1.1 前端设计规范（Apple 胶囊卡片风格）

**运行地址：`http://127.0.0.1:3000`**  
**后端接口：`http://127.0.0.1:5678/api/v1`**  
**设计定位：单屏工作台、零弹窗、行内确认（Inline Review）、Apple 大圆角卡片 + 胶囊控件**

---

## 1. 视觉与交互原则

### 1.1 Apple 大圆角与胶囊卡片语言
- **容器大圆角（Squircle Bento）**：主功能面板采用 `24px`（`rounded-3xl`）大圆角卡片，浅灰/深空灰分层背景，极弱边框（`1px solid rgba(0,0,0,0.06)`）。
- **交互控件全胶囊化（Capsule UI）**：所有按钮、分段控制器（Segmented Control）、输入框、状态标签均采用 `9999px`（`rounded-full`）全圆角胶囊形态。
- **等宽数字防抖（Tabular Numbers）**：所有价格、股数、金额、时间强制使用 `font-variant-numeric: tabular-nums`，确保 `Bid / Ask` 实时跳动时界面宽度绝对不晃动。

### 1.2 克制提示与行内确认原则
- **零弹窗（No Modals / No Toasts）**：全站不使用任何浮层弹窗或右上角 Toast 通知；成交提示音由后端 `afplay` 统一播放，前端不发声。
- **主交易采用行内两步确认（Inline Review）**：在左侧交易面板发起 `Breakout Buy`、`Market Buy`、`Market Sell` 时，点击底部胶囊按钮先在原卡片内展开参数核对视图，再点击 `[ Confirm & Send ]` 正式发送；收到 `201 Accepted` 后卡片自动退回普通编辑态作为完成反馈。
- **改止损与撤单保持一键直发**：右侧订单列表中的 `PUT /orders/{id}/stop`（改价）和 `DELETE /orders/{id}`（撤单）点击即发，不设二次确认。

---

## 2. 单屏布局结构（Bento Grid）

整个应用仅一个单屏页面，分为 **顶部状态胶囊栏** 与 **左右双栏卡片区**：

```text
+-----------------------------------------------------------------------------------+
|  (● Online · 14:30:05)   Net Liq $125,000   Buying Power $54,000   Margin $15,000 |
+-----------------------------------+-----------------------------------------------+
|  交易面板卡片 (Trade Ticket)      |  持仓卡片 (Positions)                         |
|                                   |  +-----------------------------------------+  |
|  [ NVDA          ]  ( 刷新 ↻ )    |  | NVDA   100股   均价 135.00   +$210 (+1%)|  |
|                                   |  +-----------------------------------------+  |
|  ( Bid 140.20      Ask 140.22 )   |                                               |
|    Low 136.20      High 140.50    |-----------------------------------------------|
|                                   |  活动订单卡片 (Orders)                        |
|  ( (● 突破单 Breakout)  市价单 )  |  +-----------------------------------------+  |
|                                   |  | BUY STOP 100 NVDA @ 140.50    ( 撤单 )  |  |
|  数量 Qty      [       100     ]  |  |  └─ SELL STOP 100 @ 136.20 GTC          |  |
|  Buy Stop      [    140.51     ]  |  +-----------------------------------------+  |
|  Sell Stop     [    136.20     ]  |  | SELL STOP 100 AAPL @ 220.00             |  |
|                                   |  |  [ 222.50 ] ( 改价 )          ( 撤单 )  |  |
|  (        Review Order         )  |  +-----------------------------------------+  |
+-----------------------------------+-----------------------------------------------+


3. 四大核心模块设计

3.1 顶部悬浮胶囊栏（Status & Account Pill）

1. 连接状态与快照时间胶囊（左侧）：
  ⚬ 展示当前状态与 updated_at 的本地时间（HH:MM:SS），使睡眠唤醒后数据新鲜度一目了然：
    ⚬ 正常：● Online · 14:30:05（绿点）
    ⚬ 行情流断开：● REST Only · 14:30:05（黄点，stream_status.connected === false）
    ⚬ SSE 重连中：● Reconnecting · Last 14:30:05（橙点）
    ⚬ 需重新授权：● Auth Required（红点，auth_status === "auth_required"）
2. 核心资金指标（右侧水平排列）：
  ⚬ 直接展示 /api/v1/account 返回的 liquidation_value、available_funds、cash_balance、margin_balance、intraday_buying_power、stock_buying_power、long_market_value。余额使用中性色和负号，不添加风险色或借款状态推断；悬停显示原始 API 字段路径。窄窗口分行展示。

3.2 左栏：交易面板卡片（Trade Ticket Card）

A. 标的查询与实时报价胶囊（按需触发）

⚬ 触发时机：严禁在输入字母时逐字触发请求。仅在以下 3 种操作时调用 GET /api/v1/quotes/{symbol}：
  1. 在 Symbol 胶囊框输入代码后按 Enter；
  2. 点击右侧圆形 ( ↻ ) 按钮（此时附带 ?refresh=true）；
  3. 点击右侧持仓列表中的某一行股票。
⚬ 价格展示：双拼大胶囊实时展示 bid 与 ask（由 SSE quote_updated 驱动），下方小字展示 day_low 与 day_high。

B. 交易模式与行内确认（Inline Review）

通过顶部 Segmented Control 切换 突破单（Breakout） 与 市价单（Market）：

1. 编辑态（Edit State）：
  ⚬ Breakout 模式：切换新 Symbol 时自动将 suggested_buy_stop 和 suggested_sell_stop 填入输入框；同一 Symbol 后续收到行情刷新或手動点 ↻ 时，绝不自动覆盖用户已编辑的输入框数值（提供微小的 重置建议价 按钮）。
  ⚬ Market 模式：仅展示 Qty 输入框。若该 Symbol 在当前订单列表中有活动的 SELL STOP，在下方静默显示一行提示胶囊：已挂止损 100股 @ $136.20 [撤单]（可点撤单，也可直接进入下一步，不强制拦截）。
  ⚬ 点击底部 ( Review Order ) 胶囊按钮进入确认态。
2. 行内确认态（Inline Review State）：
  ⚬ 输入框锁定，原卡片内部直接展示最终提交摘要：
    ⚬ Breakout 摘要：NVDA · BUY STOP 100 @ $140.51 (DAY) → SELL STOP @ $136.20 (GTC)，并列出 名义金额 $14,051、预估风险 $431 (3.07%)。
    ⚬ Market 摘要：NVDA · MARKET BUY (或 SELL) 100 股 · DAY，以及按当前 Ask/Bid 估算的参考金额。
  ⚬ 底部并排两个胶囊按钮：[ 返回修改 ]（灰底）与 [ Confirm & Send ]（主色实心）。
  ⚬ 点击 [ Confirm & Send ] 发起 POST 请求；成功后卡片自动切回编辑态并清空 Qty。

3.3 右栏上：持仓卡片（Positions Card）

⚬ 列表展示 positions：symbol、quantity、average_price、market_value、day_profit_loss 及红绿胶囊标签 day_profit_loss_percent。
⚬ 点击任意持仓行，自动将该 symbol 和整股 quantity 填入左侧交易面板并触发一次该 Symbol 的 Quote 查询。

3.4 右栏下：活动订单卡片（Orders Card）

A. 订单树递归过滤规则

后端返回的是保留父子层级的订单树。为防止“父单已 FILLED、但子单 SELL STOP 仍在 WORKING 时整棵树被过滤掉”，前端采用递归可见性判断：

const ACTIVE_STATUSES = new Set([
  "WORKING",
  "AWAITING_STOP_CONDITION",
  "AWAITING_PARENT_ORDER",
  "PENDING_ACTIVATION",
  "QUEUED",
  "PENDING_REPLACE",
  "PARTIALLY_FILLED",
  "ACCEPTED",
]);

const isOrderTreeVisible = (order: OrderItem): boolean =>
  ACTIVE_STATUSES.has(order.status) || order.child_orders.some(isOrderTreeVisible);


若父单已 FILLED 而子单处于活动状态，父单作为置灰标题行展示（标注 FILLED），子单正常高亮展示并暴露操作控件。

B. 精确的改价与撤单按钮渲染条件

⚬ 显示 ( 撤单 ) 胶囊按钮：仅当 order.order_id !== null && order.cancelable === true 时显示。点击直接调用 DELETE /api/v1/orders/{order_id}。
⚬ 显示内联 [ 新止损价 ] ( 改价 ) 胶囊控件：严格对齐后端 replace_stop 规则，仅当同时满足以下条件时显示：
  ⚬ order.order_id !== null
  ⚬ order.instruction === "SELL" && order.order_type === "STOP"
  ⚬ order.strategy_type === "SINGLE" && order.child_orders.length === 0
  ⚬ ["WORKING", "AWAITING_STOP_CONDITION", "QUEUED", "ACCEPTED"].includes(order.status)

4. SSE 事件监听与错误处理契约

4.1 命名 SSE 事件绑定

后端发送的是带 event: 名称的 SSE 流，前端必须使用 addEventListener 分别绑定（不能使用 onmessage）：

const es = new EventSource("[http://127.0.0.1:5678/api/v1/events](http://127.0.0.1:5678/api/v1/events)");

es.addEventListener("snapshot_updated", (e) => {
  const { account, positions, orders, updated_at } = JSON.parse(e.data);
  // 更新账户、持仓、订单树及顶部更新时间
});

es.addEventListener("quote_updated", (e) => {
  const { symbol, bid, ask, updated_at } = JSON.parse(e.data);
  // 若 symbol 为当前交易面板选中标的，实时更新 Bid / Ask
});

es.addEventListener("stream_status", (e) => {
  const { connected } = JSON.parse(e.data);
  // 更新顶部流连接状态指示
});

es.addEventListener("order_filled", (e) => {
  const { symbol, order_id } = JSON.parse(e.data);
  // 顶部状态栏短暂闪烁成交高亮提示（声音已由后端播放）
});


4.2 内联胶囊错误条

写操作进行中按钮置为禁用态。失败时在对应卡片底部展开一条胶囊错误提示：

⚬ 普通错误（400 / 409 / 422 / 502）：红色胶囊条，展示 error.message；若包含 error.details?.broker_error，将其中的券商 message 或 errors 拼接在后方单行显示。
⚬ 结果未知（504 ORDER_RESULT_UNKNOWN）：琥珀色常驻胶囊条：订单结果未确认，请人工核对后再操作，右侧附带 ( 刷新订单 ) 按钮（调用 GET /api/v1/orders?refresh=true）。

5. 极简工程结构

项目	选型
构建与运行	Vite（固定 host: "127.0.0.1", port: 3000）
框架与样式	React 19 + TypeScript + Tailwind CSS v4
状态与网络	原生 React useState + fetch + EventSource（零第三方状态库）

frontend/
├── index.html
├── package.json
├── vite.config.ts    # 固定 server: { host: '127.0.0.1', port: 3000 }
└── src/
    ├── api.ts        # 类型契约与 REST 请求封装
    ├── App.tsx       # 顶部胶囊栏 + 左交易卡(含Inline Review) + 右持仓/订单树卡
    └── app.css       # Tailwind 引入与 tabular-nums 字体规则
