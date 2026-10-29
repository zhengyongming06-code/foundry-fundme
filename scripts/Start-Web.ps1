param(
    [string]$ForgePath = 'forge',
    [string]$AnvilPath = 'anvil',
    [string]$NodePath = 'node',
    [string]$SolcPath = '',
    [int]$Port = 4173
)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$rpcUrl = 'http://127.0.0.1:8545'
function Invoke-LocalRpc([string]$Method) {
    $body = @{ jsonrpc = '2.0'; id = 1; method = $Method; params = @() } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Uri $rpcUrl -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 3
    if ($result.error) { throw ($result.error | ConvertTo-Json -Compress) }
    return $result.result
}
$ownedNode = $null
Push-Location $project
try {
    # Reuse an existing local frontend instead of redeploying underneath it.
    $existing = $null
    try { $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/config" -TimeoutSec 2 } catch {}
    if ($existing.chainId -eq '0x7a69' -and $existing.address -and $existing.selectors.'fund()') {
        Write-Host "FundMe is already running at http://127.0.0.1:$Port" -ForegroundColor Green
        return
    }
    $ready = $false
    try { $ready = (Invoke-LocalRpc 'eth_chainId') -eq '0x7a69' } catch {}
    if (-not $ready) {
        $ownedNode = Start-Process -FilePath $AnvilPath -ArgumentList @('--silent', '--host', '127.0.0.1', '--port', '8545') -WindowStyle Hidden -PassThru
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 200
            try { if ((Invoke-LocalRpc 'eth_chainId') -eq '0x7a69') { $ready = $true; break } } catch {}
        }
    }
    if (-not $ready) { throw 'Could not connect to Anvil chain 31337 on port 8545.' }
    $accounts = @(Invoke-LocalRpc 'eth_accounts')
    if ($accounts.Count -lt 2) { throw 'Anvil requires at least two unlocked accounts.' }
    $forgeArguments = @('script', 'script/DeployFundMe.s.sol:DeployFundMe', '--rpc-url', $rpcUrl, '--sender', $accounts[0], '--unlocked', '--broadcast')
    if ($SolcPath) { $forgeArguments += @('--use', $SolcPath) }
    & $ForgePath @forgeArguments
    if ($LASTEXITCODE -ne 0) { throw 'Deployment failed.' }
    $broadcast = Get-Content 'broadcast/DeployFundMe.s.sol/31337/run-latest.json' -Raw | ConvertFrom-Json
    $contract = $broadcast.transactions | Where-Object { $_.contractName -eq 'FundMe' } | Select-Object -Last 1
    $receipt = $broadcast.receipts | Where-Object { $_.contractAddress -eq $contract.contractAddress } | Select-Object -Last 1
    if (-not $contract.contractAddress -or -not $receipt.blockNumber) { throw 'Deployment receipt is missing.' }
    $runtime = @{ address = $contract.contractAddress; deploymentBlock = $receipt.blockNumber; rpcUrl = $rpcUrl }
    # Use UTF-8 without BOM for Node JSON.parse, including on Windows PowerShell 5.1.
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $project 'web/runtime.json'), ($runtime | ConvertTo-Json), $encoding)
    $previousPort = $env:PORT
    try {
        $env:PORT = $Port.ToString()
        Write-Host "`nOpen http://127.0.0.1:$Port in your browser. Press Ctrl+C to stop." -ForegroundColor Green
        & $NodePath 'web/server.mjs'
        if ($LASTEXITCODE -ne 0) { throw 'Web server exited with an error.' }
    } finally { $env:PORT = $previousPort }
} finally {
    if ($ownedNode -and -not $ownedNode.HasExited) { Stop-Process -Id $ownedNode.Id -ErrorAction SilentlyContinue }
    Pop-Location
}
