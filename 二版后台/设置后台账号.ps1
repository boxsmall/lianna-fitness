param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Roles
)
$secret = Read-Host '设置后台密码（至少 12 位）' -AsSecureString
$credential = [pscredential]::new($Name, $secret)
try {
  $env:LIANNA_OPERATOR_PASSWORD = $credential.GetNetworkCredential().Password
  & node (Join-Path $PSScriptRoot 'server.js') operator $Name $Roles
  if ($LASTEXITCODE -ne 0) { throw '后台账号设置失败' }
} finally {
  Remove-Item Env:LIANNA_OPERATOR_PASSWORD -ErrorAction SilentlyContinue
}
