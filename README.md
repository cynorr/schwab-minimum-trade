# Schwab Local Trading Backend

按 [V1.2 设计](backend-design.md) 实现的个人 Mac 本地服务。开发顺序和实现约定见 [开发方案](development-plan.md)。

业务代码集中在 `schwab_backend.py`，状态只驻留内存；凭据使用原生 macOS Keychain。固定监听 `127.0.0.1:5678`，只运行一个进程和一个 Worker。

## 安装与配置

需要 Python 3.12+ 和 macOS。推荐在项目目录使用 uv：

```bash
uv sync --locked --group dev
```

也可以用普通虚拟环境安装：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

直接编辑 `schwab_backend.py` 顶部的 `01 Configuration` 常量：

- `CLIENT_ID`：填写 Schwab Production App 的 App Key。
- `CALLBACK_URL`：Developer Portal 注册的 HTTPS Callback，默认 `https://127.0.0.1`。
- `ACCOUNT_HASH`：单账户留空；多个账户时填固定目标 hash。
- `MAX_ORDER_AMOUNT_USD = Decimal("20000")`：仅限制单笔买入金额。
- `MAX_LOSS_PER_TRADE_USD = Decimal("500")`：突破单估算价差风险上限。
- `MAX_STOP_LOSS_RATIO = Decimal("0.10")`，`BREAKOUT_OFFSET = Decimal("0.01")`。
- `ALLOWED_ORIGINS`：默认允许 `http://127.0.0.1:3000` 和 `http://127.0.0.1:5678`。

修改常量后重启服务。Secret 和 Token 由授权流程存入 Keychain。

## 授权与启动

```bash
.venv/bin/python schwab_backend.py auth
.venv/bin/python schwab_backend.py serve
```

首次授权会隐藏输入 `client_secret` 并写入 Keychain，然后打开浏览器。完成授权后，即使 HTTPS Callback 页面无法访问，也可复制浏览器地址栏的完整 URL，通过普通可见输入粘贴回终端。程序校验 Callback 和 OAuth state，保存 Token，不需要启动 HTTPS 服务。

浏览器将根地址 `https://127.0.0.1` 显示为 `https://127.0.0.1/` 时，两者按相同根路径校验；发送给 Schwab 的 Callback 仍使用配置原值。授权命令退出后，请重新运行 `auth` 并使用本次浏览器返回的新 URL，不复用上一次的 code/state。

Keychain Service 为 `schwab-minimum-trader`，只使用 `client_secret` 和 `oauth_tokens` 两个条目。后者以一个 JSON 字符串保存 access_token、refresh_token、expiration，每次保存只写入一次。需要更换 Secret 时，可通过 macOS「钥匙串访问」更新对应条目；不要在命令行参数中传 Secret。

Refresh Token 失效后，服务保持本地接口运行。重新执行 `auth` 后，后台每 5 秒检查并恢复，无需重启。暂时锁定的 Keychain 会在之后继续检查。被 Schwab 拒绝的刷新凭据会从 `oauth_tokens` 清除，等待新的授权。如果用过旧版独立 Token 条目，请重新运行一次 `auth` 写入新格式。

```bash
curl http://127.0.0.1:5678/api/v1/health
curl http://127.0.0.1:5678/api/v1/account
curl 'http://127.0.0.1:5678/api/v1/orders?refresh=true'
curl 'http://127.0.0.1:5678/api/v1/quotes/NVDA?refresh=true'
curl -N http://127.0.0.1:5678/api/v1/events
```

## API

| 方法 | 路径（前缀 `/api/v1`） | 用途 |
|---|---|---|
| GET | `/health` | 认证、REST、Streaming、快照更新时间 |
| GET | `/account` | 账户、Margin、Buying Power |
| GET | `/positions` | 股票与 ETF 持仓 |
| GET | `/orders` | 订单树与逐笔成交；支持 `symbol`、`refresh` |
| GET | `/orders/{id}` | 从 Schwab 获取单个订单 |
| GET | `/quotes/{symbol}` | Bid/Ask、High/Low、建议价格；支持 `refresh` |
| GET | `/events` | SSE；连接后立即推送现有快照 |
| POST | `/orders/market-buy` | `{"symbol":"NVDA","qty":1}` |
| POST | `/orders/market-sell` | `{"symbol":"NVDA","qty":1}` |
| POST | `/orders/breakout-buy` | `symbol`、`qty`、字符串 `buy_stop` 和 `sell_stop` |
| PUT | `/orders/{id}/stop` | `{"new_stop":"138.00"}` |
| DELETE | `/orders/{id}` | 只取消路径指定的订单；忽略 Body |

价格、金额和查询数量返回十进制字符串；下单数量必须为 JSON 正整数，价格输入必须为字符串。拒绝未定义字段。写请求的浏览器 Origin 必须匹配配置；没有 Origin 的本机 CLI 可直接调用。POST/PUT 需要 `Content-Type: application/json`。

账户余额新增 `available_funds`（`currentBalances.availableFunds`）、`intraday_buying_power`（`currentBalances.intradayBuyingPowerAmount`）和 `stock_buying_power`（`projectedBalances.stockBuyingPower`）。保留旧的 `buying_power`、`day_trading_buying_power` 原始含义；缺失字段为 null，不按倍数换算或互相替代。后端保留 Cash Balance 与 Margin Balance 原值；前端合成为 Balance，悬停可查看组成。顶部顺序为 Net Liq、Stock BP、Intraday BP、Available Dollars、Balance；Long Value 位于 Holdings 末行汇总。负数使用负号，无风险颜色。

Orders 的每个订单（包括 OTO 子单）新增 `executions` 数组，无成交时为 `[]`。每笔包含 `activity_id`、`leg_id`、`quantity`、`price`、`time`；数量与价格为十进制字符串，时间为 UTC ISO 8601。`GET /orders`、`GET /orders/{id}` 和 SSE `snapshot_updated.orders` 共用此结构，仍为 12 个业务接口。

Sold Today 只使用现有最近 59 天创建的订单快照，不新增 `/closed-trades`、transactions 查询或后台任务。前端筛选完全成交的股票 SELL 订单，按最后一笔成交时间判断美东当天，按股票汇总卖出数量、加权均价、成交总额（未扣费用）和最后成交时间；展开可追溯原订单及成交活动。卖出部分持仓、当天买回均保留卖出记录；重新加载或重启后从快照恢复，不依赖成交提示事件。不计算已实现盈亏，不处理跨日分批成交和部分成交后撤单，止损单创建/更新须在查询窗口内。

新建订单返回 HTTP 201，修改返回 200，取消返回 202。`accepted` 表示 Schwab 接受请求，不代表成交。三个写入成功响应统一为 `verified: false`；改单从 Location 提取新 ID 后立即返回，账户和订单由后台轮询及 Streaming 触发刷新。

每个交易操作最多一次券商写请求。未知写结果返回 HTTP 504、`result=unknown`、`ORDER_RESULT_UNKNOWN`。只在请求进行中阻止相同操作并发提交；请求结束后释放锁。前端收到 unknown 应提示用户在 Schwab 人工核对，之后可由用户明确提交新请求，无需重启。客户端不得自动重试未知结果。

市价卖出只读取最新持仓并确认卖出数量不超过多头数量，不依赖 Quote 或买入金额上限。修改止损检查目标为可编辑且已激活的 SELL STOP、新价格为有限正数；保留原可提交参数，仅修改 Stop Price。大额平仓和上移止损不受单笔买入上限阻拦。

改单数量优先读取原订单腿部，缺失时读取顶层数量；确认是有限正整数后，以 JSON 整数仅提交在腿部。非整股数量或缺少原有效期返回 `ORDER_CONFLICT`，不截断数量、不推测有效期。普通 STOP 不回填限价 `price` 及其联动字段；保留非空税批次、特殊指令和原触发设置。

Schwab 返回 `SCHWAB_REJECTED` 时，`error.details` 包含 `http_status`，以及可解析的 `broker_error.message` / `broker_error.errors`。空正文或非 JSON 正文仍保留原 HTTP 错误；不会自动重发交易。

参数类型、数量和价格正值由 HTTP 入口的 Pydantic 模型统一校验；内部 TradingGateway 接收已校验的参数，只执行业务风控。CORS 预检使用标准中间件。后台使用同一个循环进行 5 秒轮询与事件唤醒，刷新期间收到的新事件会触发下一轮查询。

账户和订单读取失败时，保留最后成功快照和原更新时间，Health 标记 REST 不可用。`refresh=true` 失败会返回错误。Streaming 断线时行情回退到 REST；重新连接会清理旧 Streaming 报价并恢复 Symbol 集合，不回放历史成交声音。

## 本地前端

前端按 [V1.1 前端规范](frontend-design.md) 实现，位于 `frontend/`，使用 React 19、TypeScript、Vite 和 Tailwind CSS v4。需要 Node.js 22.12+，先启动上述后端，再运行：

```bash
cd frontend
npm ci
npm run dev
```

打开 `http://127.0.0.1:3000`。开发与预览均固定该地址；端口被占用时直接报错。接口直接连接 `http://127.0.0.1:5678/api/v1`，不需要前端配置凭据。

- 输入股票代码后按 Enter 查询；刷新按钮强制刷新行情；点击持仓会带入代码和整股数量。同一标的刷新不会覆盖已编辑的触发价，可点击「重置建议价」恢复。
- 突破买入、市价买入和市价卖出均先核对，再点击 `Confirm & Send` 发送；成功表示请求已接受，等待券商同步。改止损和撤单直接发送。
- 下方列表分为 Entries、Holdings、Sold Today；成交明细点击展开，时间显示 ET。
- 页面通过四种命名 SSE 事件同步快照、报价、连接和成交提示，并每 5 秒读取健康状态以识别授权失效和恢复。SSE 自动重连，保留最后快照；前端不播放声音。
- 写请求超时、断线或返回 `ORDER_RESULT_UNKNOWN` 时常驻显示琥珀色提示，不自动重发。请先在 Schwab 人工核对；「刷新订单」只读取订单，不代表原交易结果已确认。
- 页面采用固定交易区和下方统一列表，长列表在卡片内滚动，适配半屏及窄窗口。右上角可切换浅色/深色模式，仅保存主题偏好，不保存账户或订单数据。

```bash
npm test       # 模拟接口与 SSE，不连接券商、不提交真实交易
npm run build # TypeScript 检查与生产构建，产物为 frontend/dist/
npm run preview # 在固定本地地址预览生产构建
```

开发服务与生产预览使用相同端口，运行预览前先停止开发服务。

## LaunchAgent

`com.local.schwab-backend.plist.example` 是模板，未安装。将其中的 `PROJECT_DIR` 全部替换为项目绝对路径，再复制到 `~/Library/LaunchAgents/com.local.schwab-backend.plist`，检查模板中的 Python 和脚本路径。

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.schwab-backend.plist
launchctl kickstart gui/$(id -u)/com.local.schwab-backend
# 停止并卸载
launchctl bootout gui/$(id -u)/com.local.schwab-backend
```

LaunchAgent 仅在用户登录会话中运行；机器睡眠或关机时监控暂停。程序不修改电源或网络设置。唤醒/联网后恢复读取与连接，不重新提交交易。

## 测试与验收

```bash
uv run pytest -q
uv run ruff check .
```

测试使用虚构 Token、内存凭据和模拟 Schwab 传输，不访问真实 Keychain、不发真实交易。覆盖固定订单结构、Decimal 边界、并发刷新和交易冲突、未知结果、父子订单映射、行情合并、SSE、订阅确认与恢复、本地访问控制，以及初始化失败后的自动恢复。

实际 Production App 验收尚需人工完成：OAuth 首次授权、实际账户字段、OTO 子单激活与部分成交、Schwab Replace 行为、系统睡眠/断网后恢复、真实成交声音。相关结果以券商返回为准。

协议核查参考：[Schwab OAuth](https://developer.schwab.com/user-guides/get-started/authenticate-with-oauth)、[WebSocket 客户端与重连](https://websockets.readthedocs.io/en/stable/reference/asyncio/client.html)、[Streaming 消息样例](https://github.com/tylerebowers/schwabdev/blob/main/docs/pages-raw/stream.md)。
