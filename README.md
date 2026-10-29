# FundMe · Foundry 募捐合约项目

使用 Foundry 开发的 Solidity 募捐项目，以 ETH 捐款，通过兼容 Chainlink 的 ETH/USD 预言机计算最低 5 美元门槛，部署者可提取全部余额。

这是**管理员托管型募捐**：管理员可以随时提现；没有目标金额、截止时间、退款或资金用途约束。项目包含合约、网页前端、测试、部署脚本和 CI。请先在本地和测试网学习，不直接承载真实资金。

## 网页启动

准备 Node.js 20+ 与 Foundry，在项目根目录的 PowerShell 中运行：

```powershell
./scripts/Start-Web.ps1
```

然后打开 **http://127.0.0.1:4173**。脚本会连接或启动 Anvil，部署一个全新的 FundMe 和 Mock，并启动网页服务。保持终端运行；重启脚本会部署新合约，旧合约的记录不属于新的募捐页面。本地前端没有第三方 npm 依赖，无需 `npm install`。

1. 默认选择「本地体验」，点击「连接本地账户」。
2. 输入金额，点击「确认捐款」。页面显示金额换算、余额、个人累计捐款及链上动态。
3. 在「切换测试身份」选择管理员，使用「提取资金」。
4. 使用「钱包连接」时，在安装 MetaMask 等 EIP-1193 钱包的浏览器中打开相同地址，并确认切换到 Anvil（链 ID 31337，RPC `http://127.0.0.1:8545`）。钱包账户需要测试 ETH；前端不会读取或保存私钥。内置浏览器未安装钱包时会给出提示，仍可使用本地体验。

页面会区分节点离线、钱包缺失、网络不匹配、报价异常与交易失败，不会自动循环弹出钱包连接请求。Mock 报价在 3600 秒后过期，重新运行启动脚本会创建新报价；报价过期期间仍允许管理员提现。

端口可通过 `./scripts/Start-Web.ps1 -Port 4174` 调整。若工具不在 PATH，可通过 `-ForgePath`、`-AnvilPath`、`-NodePath`、`-SolcPath` 指定绝对路径。

前端仅面向本地开发。服务绑定 127.0.0.1，限制 Host、Origin、RPC 方法和可发送的交易；本地体验通过 Anvil 的解锁账户发送交易，不是模拟数据。不要把这个包含解锁测试账户的服务公开到互联网。部署地址自动写入被 Git 忽略的 `web/runtime.json`，公共测试网前端尚未实现。

前端测试：`node --test web/lib.test.mjs`。金额转换使用 BigInt，显示美元时才使用 Number 格式化。

## 1. 功能与结构

```text
src/FundMe.sol                         核心业务
src/interfaces/AggregatorV3Interface.sol 价格接口
test/mocks/MockV3Aggregator.sol         可修改价格的本地 Mock
test/FundMe.t.sol                      单元测试、安全测试、模糊测试
script/DeployFundMe.s.sol               本地 / 公共测试网部署
.github/workflows/test.yml             编译与测试检查
scripts/Demo.ps1                       一键本地部署与交互演示
scripts/Start-Web.ps1                  一键启动网页与本地部署
web/                                  原生 HTML / CSS / JS 前端与 Node 本地代理
```

- `fund()`、`receive()`、`fallback()` 都按最低金额验证。
- `contributions(address)` 记录该地址历次累计捐款；提现后不清零。
- `totalRaised` 记录通过募捐入口收到的 ETH；`totalWithdrawn` 记录已提现 ETH。
- `Funded` 和 `Withdrawn` 事件便于前端或索引服务建立历史列表。
- 提现仅 owner 可调用，执行成本不随捐款人数增长，具有重入保护。
- 价格必须大于零，更新时间不能为零或位于未来，并且不能超过配置的有效期。

## 2. 安装和运行

依赖：Git、Foundry（`forge`、`cast`、`anvil`）。Solidity 版本锁定为 0.8.24，无需 `forge install` 或 `forge-std`。测试文件直接声明用到的 Foundry cheatcode 接口。

Foundry 安装请以[官方安装说明](https://getfoundry.sh/introduction/installation/)为准；Windows 可以在 Git Bash 或 WSL 使用官方安装器，安装后确认三个命令都在当前终端 PATH 中。以下操作示例采用 **PowerShell**，不要把 PowerShell 的变量语法直接复制到 Bash。

在项目目录运行：

```powershell
forge --version
forge build
forge test -vvv
forge test --gas-report
forge fmt
```

只研究一条测试的详细执行轨迹：

```powershell
forge test --match-test testOwnerCannotReenterWithdrawal -vvvv
```

## 3. 本地部署和交互

### 一键演示（PowerShell）

先在第一个终端运行 `anvil`，再在项目根目录的第二个 PowerShell 终端执行：

```powershell
./scripts/Demo.ps1
```

脚本只支持本地链 31337，使用 Anvil 解锁的前两个测试账户，不需要私钥。它会部署合约，验证金额不足与越权操作被拒绝，执行 0.01 ETH 捐款和管理员提现，最后检查余额与累计金额。正常结束输出 `DEMO PASSED`。

### 手动部署与交互

第一个终端运行节点，保持窗口打开：

```powershell
anvil
```

第二个 PowerShell 终端进入项目目录。从 Anvil 的输出选择一个测试账户，导入其私钥到本地加密 keystore（交互输入；这些测试账户不能用于真实资产）：

```powershell
cast wallet import fundme-local --interactive
$env:RPC_URL = "http://127.0.0.1:8545"
forge script script/DeployFundMe.s.sol:DeployFundMe --rpc-url $env:RPC_URL --account fundme-local --broadcast
```

部署脚本在 chain ID 31337 自动创建 ETH/USD Mock，初始价格为 2000 美元。`--account` 对应的广播账户将成为 owner。部署输出和 `broadcast/DeployFundMe.s.sol/31337/run-latest.json` 中可以找到创建的 FundMe 地址。

把下面的占位符替换为部署得到的真实地址：

```powershell
$fundMe = "<FundMe 合约地址>"
cast call $fundMe "owner()(address)" --rpc-url $env:RPC_URL
cast call $fundMe "getUsdValue(uint256)(uint256)" 1000000000000000000 --rpc-url $env:RPC_URL
cast send $fundMe "fund()" --value 0.01ether --account fundme-local --rpc-url $env:RPC_URL
cast balance $fundMe --ether --rpc-url $env:RPC_URL
cast call $fundMe "totalRaised()(uint256)" --rpc-url $env:RPC_URL
cast send $fundMe "withdraw()" --account fundme-local --rpc-url $env:RPC_URL
cast balance $fundMe --ether --rpc-url $env:RPC_URL
```

预期：1 ETH 报价返回 `2000000000000000000000`；0.01 ETH 捐款成功；提现后余额为零，`totalRaised` 仍是历史累计值。对比测试：0.001 ETH 仅值 2 美元，会被拒绝。想演示权限失败，可以把另一个 Anvil 账户导入为 `fundme-donor`，用它尝试 `withdraw()`。

本地 Mock 不自动更新。超过 3600 秒后捐款会报 `StalePrice()`，可以重启节点并重新部署；或者只在本地调用 Mock 的 `setRound(int256,uint256)`，传入报价和最新区块时间戳。**Mock 允许任何人改价格，不能用在公共募捐中。**

## 4. 公共测试网部署

1. 创建一个专用测试账户并领取测试 ETH，使用 `cast wallet import fundme-testnet --interactive` 导入。
2. 选择网络 RPC，并从 [Chainlink 官方地址列表](https://docs.chain.link/data-feeds/price-feeds/addresses)核实该网络的 **ETH/USD proxy 地址**、decimals 和 heartbeat。
3. 配置 `MAX_PRICE_AGE` 时参考该具体 Feed 的 heartbeat，并留合理缓冲。脚本示例的 3600 秒不是适合所有 Feed 的通用值。
4. 先模拟成功，再广播。核实 RPC 的 chain ID 与选择的 Feed 网络一致。

```powershell
$env:RPC_URL = "<测试网 RPC URL>"
$env:PRICE_FEED = "<该测试网 ETH/USD proxy 地址>"
$env:MAX_PRICE_AGE = "<按 heartbeat 选定的秒数>"
cast chain-id --rpc-url $env:RPC_URL
forge script script/DeployFundMe.s.sol:DeployFundMe --rpc-url $env:RPC_URL --account fundme-testnet
forge script script/DeployFundMe.s.sol:DeployFundMe --rpc-url $env:RPC_URL --account fundme-testnet --broadcast
```

`.env.example` 仅作配置参考。可以复制为 `.env`（Foundry 会读取），但不要提交私钥或含凭证的 RPC URL。keystore 密码通过终端提示输入。

## 5. 金额计算与设计取舍

```text
USD（18 位小数）= amountWei × answer ÷ 10^feedDecimals
例如：0.0025 × 10^18 × (2000 × 10^8) ÷ 10^8 = 5 × 10^18
```

全程整数计算、向下取整，因此恰好或超过 5 美元才接受。构造函数拒绝超过 18 位小数的 Feed。本项目固定 ETH/USD；ABI 兼容不代表语义正确，部署者仍须选对币种与网络。

这里用历史累计 mapping 和事件代替“所有捐款人数组 + 提现时逐个清零”，避免捐款人数增加导致提现耗尽 gas。代价是链上没有可直接遍历的捐款人列表，前端需要查询事件。

提现采用检查 → 记账 → 外部转账，转账失败时整笔交易回滚；额外的锁阻止 owner 为合约时递归提现。预言机调用失败也会令捐款回滚，但不影响 owner 提现。

`totalRaised - totalWithdrawn == balance` 不是无条件不变量：某些 EVM 路径可强制发送 ETH，绕过募捐入口；提现会转出全部余额，包含这些 ETH，所以 `totalWithdrawn` 可能大于 `totalRaised`。

当前没有管理员更换机制；owner 丢失密钥，或 owner 合约永远拒收 ETH，会使提现不可用。这些是本版本需要在演示时说明的限制。公共部署前还需要独立审查；L2 部署也需要针对链的 sequencer uptime 等额外保护。

## 6. 测试范围

测试覆盖初始化、精确门槛、金额不足、事件、直接转账和 fallback、重复捐款、权限、提现与再次募捐、空余额、过期边界、异常价格和时间、不同精度、构造参数、转账失败回滚、重入，以及 256 次金额模糊测试。

实际运行输出见 [RUN_RESULTS.md](RUN_RESULTS.md)，验证范围见 [VALIDATION.md](VALIDATION.md)。CI 需要把本目录作为 GitHub 仓库根目录上传后才会触发。

参考：[Foundry Forge](https://www.getfoundry.sh/forge/index.html)、[Chainlink API](https://docs.chain.link/data-feeds/api-reference)、[预言机更新时间检查](https://docs.chain.link/data-feeds/overview)。
