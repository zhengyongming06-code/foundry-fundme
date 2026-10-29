# 验证记录

日期：2026-10-29，Asia/Shanghai。

## 环境

- Forge / Anvil：1.7.1，commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`。
- Solidity：0.8.24，优化器 200 runs，EVM Paris。
- 本地链：Anvil，chain ID 31337，ETH/USD Mock 初始报价 2000。
- Solidity 原生编译器 SHA-256 与官方发布清单一致。

工具本次安装在聊天的 work 目录，没有修改全局 PATH。执行时用 `--use` 指定本地 Solidity 编译器；正常安装 Foundry 的环境可以直接使用下面的命令自动获取编译器。

## 已通过

| 检查 | 结果 |
| --- | --- |
| `forge fmt --check` | 通过 |
| `forge build` | 通过 |
| `forge test -vvv` | 15 passed，0 failed，0 skipped |
| 模糊测试 | 256 runs |
| `forge test --gas-report` | 通过并生成 gas 数据 |
| Anvil 部署与真实本地交易 | `DEMO PASSED` |

交互演示部署了 Mock 和 FundMe，确认低于最低金额时回滚、普通用户无法提现、捐款到账，以及 owner 提现后余额归零且历史金额保留。详情见 [RUN_RESULTS.md](RUN_RESULTS.md)。

Forge build 的静态检查对时间戳比较和 `int256` 转 `uint256` 发出提示：本项目用时间戳检查报价新鲜度，并在转换前拒绝非正价格。没有编译错误。当前沙箱禁止写入全局 Foundry 签名缓存，产生了缓存警告；测试与广播均正常完成。

## 未验证的范围

- 公共测试网部署、主网部署、L2 sequencer 场景。
- 独立安全审计和覆盖率测量。
- GitHub Actions 是否在远程执行完成，需以上传后的实际工作流为准。

本地演示仅涉及 Anvil 测试 ETH，无真实资产交易。
