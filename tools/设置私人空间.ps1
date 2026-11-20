param([switch]$Verify, [switch]$Browser)
$ErrorActionPreference = 'Stop'
$vaultRepo = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $vaultRepo
try {
    $vaultNodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $vaultNode = if ($vaultNodeCommand) { $vaultNodeCommand.Source } else { $null }
    if (-not $vaultNode) {
        $vaultRuntimes = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending
        foreach ($vaultRuntime in $vaultRuntimes) {
            $vaultCandidate = Join-Path $vaultRuntime.InstallLocation 'dependencies\node\bin\node.exe'
            if (Test-Path -LiteralPath $vaultCandidate) { $vaultNode = $vaultCandidate; break }
        }
    }
    if (-not $vaultNode) { throw '找不到 Node.js。请安装 Node.js，或在 Codex 终端运行此脚本。' }

    if ($Browser) {
        $vaultBrowserUrl = & $vaultNode (Join-Path $PSScriptRoot 'private-vault.mjs') browser
        if ($LASTEXITCODE -ne 0) { throw '无法生成本机设置页面。' }
        Write-Host $vaultBrowserUrl
        Start-Process $vaultBrowserUrl
        return
    }
    if (-not $Verify) {
        & $vaultNode (Join-Path $PSScriptRoot 'private-vault.mjs') init
        if ($LASTEXITCODE -ne 0) { throw '初始化失败。' }
    }
    Write-Host '私人文章保存在 .private-local/vault.json，请先编辑并保存这个文件。'
    Write-Host '密码至少 8 个字符。请保存在你的密码管理器中；丢失后无法从网站找回。'
    $first = Read-Host '输入访问密码（不会显示）' -AsSecureString
    $second = if ($Verify) { $first.Copy() } else { Read-Host '再次输入访问密码' -AsSecureString }
    $firstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $secondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
    try {
        $vaultPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPtr)
        $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPtr)
        if ($vaultPassword -cne $confirmation) { throw '两次密码不一致，未生成加密文件。' }
        if ($vaultPassword.Length -lt 8) { throw '密码至少 8 个字符。' }
        $packet = @{ password_base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($vaultPassword)) } | ConvertTo-Json -Compress
        $OutputEncoding = [Text.UTF8Encoding]::new($false)
        $vaultAction = if ($Verify) { 'verify' } else { 'encrypt' }
        $packet | & $vaultNode (Join-Path $PSScriptRoot 'private-vault.mjs') $vaultAction
        if ($LASTEXITCODE -ne 0) { throw '操作未通过；原有私人源文件不会被覆盖。' }
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr)
        $vaultPassword = $null; $confirmation = $null; $packet = $null
        $first.Dispose(); $second.Dispose()
    }
    if ($Verify) { Write-Host '验证结束，未修改加密文件。' }
    else { Write-Host '完成。先在 http://127.0.0.1:4000/private-center/ 输入密码预览，再上传 assets/private-vault 中的密文。' }
} finally { Pop-Location }
