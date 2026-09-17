$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$existingNode = Get-Command node -ErrorAction SilentlyContinue
if ($existingNode) {
  & $existingNode.Source -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'
  if ($LASTEXITCODE -eq 0) {
    & $existingNode.Source (Join-Path $PSScriptRoot 'start-desktop.mjs')
    exit $LASTEXITCODE
  }
}
Write-Host 'Welcome to Youbot. Getting the tools ready for this computer...'
$nodeArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ($env:PROCESSOR_ARCHITECTURE -eq 'AMD64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'AMD64') { 'x64' } else { throw 'Youbot needs a 64-bit Windows computer.' }
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Youbot\runtime'
$runtimeNode = Join-Path $runtimeRoot 'node\node.exe'
if (!(Test-Path $runtimeNode)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $downloadRoot = Join-Path ([IO.Path]::GetTempPath()) ('youbot-' + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
  $checksumText = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt').Content
  $match = [regex]::Match($checksumText, '(?m)^([a-f0-9]{64})\s+(node-v22\.\d+\.\d+-win-' + $nodeArch + '\.zip)\s*$')
  if (!$match.Success) { throw 'Could not find the correct Node.js download. Try again later.' }
  $archiveName = $match.Groups[2].Value
  $archivePath = Join-Path $downloadRoot $archiveName
  Invoke-WebRequest -UseBasicParsing ('https://nodejs.org/dist/latest-v22.x/' + $archiveName) -OutFile $archivePath
  if ((Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLower() -ne $match.Groups[1].Value) { throw 'The download could not be verified. Please try again.' }
  Expand-Archive $archivePath -DestinationPath $downloadRoot
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  Move-Item (Join-Path $downloadRoot ($archiveName -replace '\.zip$', '')) (Join-Path $runtimeRoot 'node')
  Remove-Item $downloadRoot -Recurse -Force
}
$env:PATH = (Split-Path $runtimeNode) + ';' + $env:PATH
& $runtimeNode (Join-Path $PSScriptRoot 'start-desktop.mjs')
exit $LASTEXITCODE
