# 本地运行结果

2026-10-29 16:44，Asia/Shanghai。

## Foundry 测试

```text
Ran 15 tests for test/FundMe.t.sol:FundMeTest
[PASS] testAcceptAtFreshnessBoundary()
[PASS] testFundAtExactMinimumEmitsEvent()
[PASS] testFuzzDonationAccounting(uint96) (runs: 256)
[PASS] testInitialConfiguration()
[PASS] testOnlyOwnerCanWithdraw()
[PASS] testOwnerCannotReenterWithdrawal()
[PASS] testReceiveAndFallbackAccumulate()
[PASS] testRejectBelowMinimum()
[PASS] testRejectEmptyWithdrawal()
[PASS] testRejectInvalidConfiguration()
[PASS] testRejectInvalidPricesAndTimestamps()
[PASS] testRejectStalePrice()
[PASS] testSupportsEighteenDecimalFeed()
[PASS] testTransferFailureRollsBackAccounting()
[PASS] testWithdrawPreservesHistoryAndAllowsNextDonation()
Suite result: ok. 15 passed; 0 failed; 0 skipped
```

## 部署与交易

本次部署 FundMe：`0xe7f1725e7734ce288f8367e1bb143e90bb3f0512`。

这只是本次本地链上的地址，不能直接在公共区块链浏览器查询。重新运行演示可能生成不同地址。

```text
PASS: rejected with BelowMinimum(uint256,uint256)
  tx: 0xe8227b43a1136d52262979f221409b306e0e2ed19d8e24b58d3e23f1dda89952
PASS: donated 0.01 ETH ($20 at mock price); contract balance = 0.01 ETH
PASS: rejected with Unauthorized()
  tx: 0x385f4652f59d6eaf2bf55badba15a8dd0b65e1c5696fb286577051e975e3f49c
PASS: owner withdrew 0.01 ETH; balance = 0; lifetime totals preserved
DEMO PASSED
```

低于门槛与无权限操作通过 `eth_call` 验证回滚；捐款与提现则真实广播至 Anvil 并检查交易回执。

## 复现

第一个终端：`anvil`。

第二个 PowerShell 终端，在项目目录执行：

```powershell
forge test -vvv
./scripts/Demo.ps1
```
