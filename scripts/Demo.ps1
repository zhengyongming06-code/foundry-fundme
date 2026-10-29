param(
    [string]$RpcUrl = 'http://127.0.0.1:8545',
    [string]$ForgePath = 'forge',
    [string]$SolcPath = ''
)

$ErrorActionPreference = 'Stop'
function Invoke-Rpc([string]$Method, [object[]]$Parameters = @()) {
    $body = @{ jsonrpc = '2.0'; id = 1; method = $Method; params = @($Parameters) } | ConvertTo-Json -Depth 20 -Compress
    $response = Invoke-RestMethod -Uri $RpcUrl -Method Post -ContentType 'application/json' -Body $body
    if ($response.error) { throw ($response.error | ConvertTo-Json -Compress -Depth 20) }
    return $response.result
}
function Get-Selector([string]$Signature) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Signature)
    $hex = '0x' + ([BitConverter]::ToString($bytes)).Replace('-', '').ToLower()
    return (Invoke-Rpc 'web3_sha3' @($hex)).Substring(0, 10)
}
function Send-DemoTransaction([hashtable]$Transaction) {
    $hash = Invoke-Rpc 'eth_sendTransaction' @($Transaction)
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        $receipt = Invoke-Rpc 'eth_getTransactionReceipt' @($hash)
        if ($null -ne $receipt) {
            if ($receipt.status -ne '0x1') { throw "Transaction failed: $hash" }
            Write-Host "  tx: $hash"
            return $receipt
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Receipt timeout: $hash"
}
function Assert-ExpectedRevert([hashtable]$Transaction, [string]$ErrorSignature) {
    $errorSelector = Get-Selector $ErrorSignature
    try { $null = Invoke-Rpc 'eth_call' @($Transaction, 'latest') }
    catch {
        if ($_.Exception.Message -notmatch [regex]::Escape($errorSelector)) { throw }
        Write-Host "PASS: rejected with $ErrorSignature"
        return
    }
    throw "Expected revert: $ErrorSignature"
}
function Read-Uint([string]$Signature) {
    $result = Invoke-Rpc 'eth_call' @(@{ to = $fundMe; data = (Get-Selector $Signature) }, 'latest')
    return [Convert]::ToUInt64($result.Substring(2), 16)
}

if ((Invoke-Rpc 'eth_chainId') -ne '0x7a69') { throw 'Demo only supports local Anvil chain ID 31337.' }
$accounts = @(Invoke-Rpc 'eth_accounts')
if ($accounts.Count -lt 2) { throw 'Start Anvil with at least two unlocked test accounts.' }
$owner = $accounts[0]
$donor = $accounts[1]
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    $forgeArguments = @('script', 'script/DeployFundMe.s.sol:DeployFundMe', '--rpc-url', $RpcUrl,
        '--sender', $owner, '--unlocked', '--broadcast')
    if ($SolcPath) { $forgeArguments += @('--use', $SolcPath) }
    & $ForgePath @forgeArguments
    if ($LASTEXITCODE -ne 0) { throw 'Deployment failed.' }
    $broadcast = Get-Content 'broadcast/DeployFundMe.s.sol/31337/run-latest.json' -Raw | ConvertFrom-Json
    $fundMe = ($broadcast.transactions | Where-Object { $_.contractName -eq 'FundMe' } | Select-Object -Last 1).contractAddress
    if (-not $fundMe) { throw 'Missing deployed FundMe address.' }
    Write-Host "FundMe: $fundMe"
    Write-Host "Owner:  $owner"
    Write-Host "Donor:  $donor"

    $fundSelector = Get-Selector 'fund()'
    $withdrawSelector = Get-Selector 'withdraw()'
    Assert-ExpectedRevert @{ from = $donor; to = $fundMe; data = $fundSelector; value = '0x38d7ea4c68000' } 'BelowMinimum(uint256,uint256)'

    $null = Send-DemoTransaction @{ from = $donor; to = $fundMe; data = $fundSelector; value = '0x2386f26fc10000'; gas = '0x493e0' }
    $balance = Invoke-Rpc 'eth_getBalance' @($fundMe, 'latest')
    if ([Convert]::ToUInt64($balance.Substring(2), 16) -ne 10000000000000000) { throw 'Unexpected donation balance.' }
    Write-Host 'PASS: donated 0.01 ETH ($20 at mock price); contract balance = 0.01 ETH'

    Assert-ExpectedRevert @{ from = $donor; to = $fundMe; data = $withdrawSelector } 'Unauthorized()'
    $null = Send-DemoTransaction @{ from = $owner; to = $fundMe; data = $withdrawSelector; gas = '0x493e0' }
    $balance = Invoke-Rpc 'eth_getBalance' @($fundMe, 'latest')
    if ([Convert]::ToUInt64($balance.Substring(2), 16) -ne 0) { throw 'Withdrawal left a balance.' }
    if ((Read-Uint 'totalRaised()') -ne 10000000000000000) { throw 'Incorrect lifetime total.' }
    if ((Read-Uint 'totalWithdrawn()') -ne 10000000000000000) { throw 'Incorrect withdrawn total.' }
    Write-Host 'PASS: owner withdrew 0.01 ETH; balance = 0; lifetime totals preserved'
    Write-Host 'DEMO PASSED'
}
finally { Pop-Location }
