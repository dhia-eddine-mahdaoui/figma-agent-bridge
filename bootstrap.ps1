param(
  [ValidateSet('claude-code','claude-desktop','codex','both')][string]$Client = 'claude-code',
  [string]$InstallDir,
  [switch]$NoStart,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Use a verified, local runtime. No administrator rights, npm, or global Node changes.
$checksums = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-checksums.json') -Raw | ConvertFrom-Json
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$nodeArch = switch ($architecture) { 'AMD64' { 'x64' }; 'ARM64' { 'arm64' }; default { throw "Unsupported Windows architecture: $architecture" } }
$archiveName = "node-v$($checksums.version)-win-$nodeArch.zip"
$expectedHash = $checksums.files.$archiveName
if (!$expectedHash) { throw 'No pinned checksum for this platform' }
$cache = Join-Path $PSScriptRoot '.bootstrap'
$runtimeDirectory = Join-Path $cache "node-v$($checksums.version)-win-$nodeArch"
$runtimeExecutable = Join-Path $runtimeDirectory 'node.exe'
$archivePath = Join-Path $cache $archiveName
New-Item -ItemType Directory -Path $cache -Force | Out-Null
if (!(Test-Path -LiteralPath $archivePath)) {
  $downloadPath = "$archivePath.$([guid]::NewGuid().ToString('N')).download"
  try {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$($checksums.version)/$archiveName" -OutFile $downloadPath
    if ((Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Node archive checksum mismatch; refusing to execute it' }
    Move-Item -LiteralPath $downloadPath -Destination $archivePath
  } finally { if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath } }
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Cached Node archive checksum mismatch. Remove only the corrupt archive and rerun.' }
# Extract to temporary storage and validate even on reruns; do not trust a replaced cached executable.
$extractDirectory = Join-Path $cache ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $extractDirectory "node-v$($checksums.version)-win-$nodeArch") -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$nodeZip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  foreach ($runtimeFile in @('node.exe', 'LICENSE')) {
    $zipEntry = $nodeZip.GetEntry("node-v$($checksums.version)-win-$nodeArch/$runtimeFile")
    if (!$zipEntry) { throw "Verified archive is missing $runtimeFile" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($zipEntry, (Join-Path $extractDirectory "node-v$($checksums.version)-win-$nodeArch/$runtimeFile"))
  }
} finally { $nodeZip.Dispose() }
$verifiedExecutable = Join-Path $extractDirectory "node-v$($checksums.version)-win-$nodeArch/node.exe"
if (!(Test-Path -LiteralPath $runtimeExecutable) -or (Get-FileHash -LiteralPath $runtimeExecutable).Hash -ne (Get-FileHash -LiteralPath $verifiedExecutable).Hash) {
  New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
  Copy-Item -LiteralPath $verifiedExecutable -Destination $runtimeExecutable
}
Copy-Item -LiteralPath (Join-Path $extractDirectory "node-v$($checksums.version)-win-$nodeArch/LICENSE") -Destination (Join-Path $runtimeDirectory 'LICENSE') -Force
$resolvedExtract = [IO.Path]::GetFullPath($extractDirectory)
$resolvedCache = [IO.Path]::GetFullPath($cache) + [IO.Path]::DirectorySeparatorChar
if (!$resolvedExtract.StartsWith($resolvedCache, [StringComparison]::OrdinalIgnoreCase)) { throw 'Temporary extraction escaped cache' }
Remove-Item -LiteralPath $resolvedExtract -Recurse -Force
$installerArguments = @((Join-Path $PSScriptRoot 'install-agent.mjs'), '--client', $Client, '--node-license', (Join-Path $runtimeDirectory 'LICENSE'))
if ($InstallDir) { $installerArguments += @('--install-dir', $InstallDir) }
if ($NoStart) { $installerArguments += '--no-start' }
if ($DryRun) { $installerArguments += '--dry-run' }
& $runtimeExecutable @installerArguments
if ($LASTEXITCODE -ne 0) { throw "Bridge installation failed (exit $LASTEXITCODE). Read the diagnostic above; do not delete existing settings." }
