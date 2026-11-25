$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoPath
$env:Path = 'C:\Ruby34-x64\bin;' + $env:Path
$env:JEKYLL_ENV = 'production'
& 'C:\Ruby34-x64\bin\ruby.exe' -rbundler/setup (Join-Path $repoPath 'vendor\bundle\ruby\3.4.0\bin\jekyll') build
if ($LASTEXITCODE -ne 0) { throw '本地构建失败，未启动管理器。' }
if (-not (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process python -ArgumentList @('-m','http.server','4000','--bind','127.0.0.1') -WorkingDirectory (Join-Path $repoPath '_site') -WindowStyle Hidden
}
if (-not (Get-NetTCPConnection -LocalPort 4012 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process node -ArgumentList @('tools/section-visibility-server.mjs') -WorkingDirectory $repoPath -WindowStyle Hidden
}
Write-Host '本机栏目管理：http://127.0.0.1:4012/private-center/'
Write-Host '公开效果预览：http://127.0.0.1:4000/'
Write-Host '设置只修改本地文件，不会自动提交或上传 GitHub。'
