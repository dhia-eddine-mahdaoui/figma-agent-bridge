param(
  [string]$RemoteHost,
  [ValidateRange(0,4327)][int]$RemotePort=0,
  [string]$RemoteInstallation,
  [switch]$Stop,
  [switch]$Prompt
)
$ErrorActionPreference='Stop'
$bridgeLocal=Join-Path $PSScriptRoot '.local'
$tunnelRecord=Join-Path $bridgeLocal 'ssh-tunnel.json'
function Get-RecordedTunnel {
  if(!(Test-Path -LiteralPath $tunnelRecord)){return $null}
  $record=Get-Content -LiteralPath $tunnelRecord -Raw|ConvertFrom-Json
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$record.pid)
  if(!$process){return $null}
  if($record.forward -notmatch '^(127\.0\.0\.1|\[::1\]):43(1[89]|2[0-7]):127\.0\.0\.1:43(1[89]|2[0-7])$' -or $process.Name-ne 'ssh.exe' -or !$process.CommandLine.Contains([string]$record.forward) -or !$process.CommandLine.TrimEnd().EndsWith([string]$record.remoteHost)){throw 'Recorded tunnel process identity changed; no process was stopped.'}
  if($record.forward6 -and (!$process.CommandLine.Contains([string]$record.forward6) -or $record.forward6-ne ('[::1]:'+$record.localPort+':127.0.0.1:'+$record.remotePort))){throw 'Recorded IPv6 forwarding identity changed; no process was stopped.'}
  return $record
}
function Test-BridgeEndpoint([int]$Port){
  try{$health=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$Port+'/health') -TimeoutSec 1 -MaximumRedirection 0;return $health.product-eq 'figma-local-bridge' -and $health.protocol-eq 2}catch{return $false}
}
function Native-Arguments($Values){
  return (($Values|ForEach-Object {
    $value=[string]$_
    if($value -notmatch '[\s"]'){ $value }
    else { '"'+[regex]::Replace([regex]::Replace($value,'(\\*)"','${1}${1}\"'),'(\\+)$','${1}${1}')+'"' }
  }) -join ' ')
}
$deadline=[DateTime]::UtcNow.AddSeconds(20)
$hasher=[Security.Cryptography.SHA256]::Create()
try{$lockId=([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant())))).Replace('-','')}finally{$hasher.Dispose()}
$mutex=[Threading.Mutex]::new($false,('Local\FigmaBridgeTunnel-'+$lockId))
$locked=$false
try{
  try{$locked=$mutex.WaitOne(20000)}catch [Threading.AbandonedMutexException]{$locked=$true}
  if(!$locked){throw 'Another connection helper is still running. No additional tunnel was started.'}
$existing=Get-RecordedTunnel
if($Stop){if($existing){Stop-Process -Id $existing.pid;Remove-Item -LiteralPath $tunnelRecord;Write-Output 'Stopped only the recorded Figma SSH tunnel.'}else{Write-Output 'No active recorded tunnel.'};exit 0}
if(!$RemoteHost -and $Prompt){
  $saved=if(Test-Path -LiteralPath $tunnelRecord){(Get-Content -LiteralPath $tunnelRecord -Raw|ConvertFrom-Json).remoteHost}else{''}
  $answer=Read-Host ('Existing SSH alias or user@host'+$(if($saved){' ['+$saved+']'}else{''}));$RemoteHost=if($answer){$answer}else{$saved}
}
if($RemoteHost-notmatch '^[A-Za-z0-9][A-Za-z0-9_.@:-]*$'){throw 'Specify an existing SSH alias or user@host without spaces/options.'}
if($RemotePort-ne 0 -and $RemotePort-notin (4318..4327)){throw 'RemotePort must be zero (auto) or 4318-4327.'}
if($existing){
  if($existing.remoteHost-ne $RemoteHost -or ($RemotePort-ne 0 -and $existing.remotePort-ne $RemotePort)){throw 'A tunnel for another target is active. Stop it explicitly before switching.'}
  if($existing.forward.StartsWith('[::1]')){throw 'A legacy IPv6 workaround is active. Stop it explicitly, then rerun to use the portable IPv4 setup.'}
  if(!$existing.PSObject.Properties['forward6']){throw 'An older IPv4-only tunnel is active. Stop it explicitly and rerun to enable safe localhost discovery.'}
  if(Test-BridgeEndpoint ([int]$existing.localPort)){Write-Output ('Verified existing Figma tunnel on localhost:'+$existing.localPort);exit 0}
  throw 'The recorded tunnel does not reach a compatible companion. Stop it explicitly and rerun discovery.'
}
$ssh=(Get-Command ssh.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $bridgeLocal -Force|Out-Null
$checkError=Join-Path $bridgeLocal 'ssh-check-error.log';$checkOutput=Join-Path $bridgeLocal 'ssh-check-output.log'
if($RemoteInstallation){
  if($RemoteInstallation.Contains("`n") -or $RemoteInstallation.Contains("`r")){throw 'Invalid remote installation path'}
  $quote=[string][char]39;$escape=$quote+[char]34+$quote+[char]34+$quote
  $base=$quote+$RemoteInstallation.Replace($quote,$escape)+$quote
  $remoteCommand='exec '+$base+'/runtime/node '+$base+'/ssh-info.mjs'
}else{$remoteCommand='exec "$HOME/.figma-local-bridge/runtime/node" "$HOME/.figma-local-bridge/ssh-info.mjs"'}
Write-Output ('Checking SSH and discovering the remote companion for '+$RemoteHost+' (20-second overall deadline)...')
$checkArguments=@('-n','-T','-o','BatchMode=yes','-o','ConnectionAttempts=1','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',$RemoteHost,$remoteCommand)
$check=Start-Process -FilePath $ssh -ArgumentList (Native-Arguments $checkArguments) -WindowStyle Hidden -PassThru -RedirectStandardError $checkError -RedirectStandardOutput $checkOutput
# Cache the native handle before the short-lived process exits. Windows PowerShell
# can otherwise return a null ExitCode even after WaitForExit succeeds.
$null=$check.Handle
if(!$check.WaitForExit([Math]::Max(1,[int]($deadline-[DateTime]::UtcNow).TotalMilliseconds))){Stop-Process -Id $check.Id -ErrorAction SilentlyContinue;throw ('SSH discovery timed out. Details: '+$checkError)}
if($check.ExitCode-ne 0){throw ('SSH discovery failed; upgrade the remote module and verify SSH access. Details: '+$checkError)}
try{$remote=Get-Content -LiteralPath $checkOutput -Raw|ConvertFrom-Json}catch{throw 'Remote companion did not return valid discovery metadata.'}
if($remote.product-ne 'figma-local-bridge' -or $remote.protocol-ne 2 -or $remote.remotePort-notin (4318..4327)){throw 'Remote installation is incompatible. Upgrade the companion and desktop bundle together.'}
if($RemotePort-ne 0 -and $RemotePort-ne $remote.remotePort){throw 'Configured RemotePort differs from the owned companion session URL. No tunnel was started.'}
$RemotePort=[int]$remote.remotePort
Write-Output ('Remote companion verified on port '+$RemotePort+'. Selecting a free local IPv4 port...')
$errorLog=Join-Path $bridgeLocal 'ssh-tunnel-error.log';$outputLog=Join-Path $bridgeLocal 'ssh-tunnel-output.log'
foreach($candidate in 4318..4327){
  if([DateTime]::UtcNow-ge $deadline){break}
  $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$candidate);$free=$false
  try{$probe.Start();$free=$true}catch{}finally{$probe.Stop()};if(!$free){continue}
  $probe6=[Net.Sockets.TcpListener]::new([Net.IPAddress]::IPv6Loopback,$candidate)
  $useIPv6=$true
  try{$probe6.Start()}catch{
    $socketError=$_.Exception.InnerException
    if($socketError -is [Net.Sockets.SocketException] -and $socketError.SocketErrorCode -in @([Net.Sockets.SocketError]::AddressFamilyNotSupported,[Net.Sockets.SocketError]::AddressNotAvailable)){$useIPv6=$false}else{$free=$false}
  }finally{$probe6.Stop()};if(!$free){continue}
  $forward='127.0.0.1:'+$candidate+':127.0.0.1:'+$RemotePort
  $forward6=if($useIPv6){'[::1]:'+$candidate+':127.0.0.1:'+$RemotePort}else{''}
  $arguments=@('-n','-N','-T','-L',$forward)
  if($useIPv6){$arguments+=@('-L',$forward6)}
  $arguments+=@('-o','BatchMode=yes','-o','ConnectionAttempts=1','-o','ConnectTimeout=8','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',$RemoteHost)
  $child=Start-Process -FilePath $ssh -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardError $errorLog -RedirectStandardOutput $outputLog
  $ready=$false
  while([DateTime]::UtcNow-lt $deadline){
    $child.Refresh();if($child.HasExited){break}
    if(Test-BridgeEndpoint $candidate){$ready=$true;break}
    Start-Sleep -Milliseconds 100
  }
  if($ready){
    @{pid=$child.Id;remoteHost=$RemoteHost;remotePort=$RemotePort;localPort=$candidate;url=('http://127.0.0.1:'+$candidate);forward=$forward;forward6=$forward6}|ConvertTo-Json|Set-Content -LiteralPath $tunnelRecord -Encoding utf8
    Write-Output ('Verified Figma tunnel: localhost:'+$candidate+' -> remote localhost:'+$RemotePort+'. Plugin discovery is automatic; select this port under Advanced connection if several companions are available.')
    Write-Output ('Use this Windows plugin manifest: '+(Join-Path $PSScriptRoot 'plugin/manifest.json'));exit 0
  }
  if(!$child.HasExited){Stop-Process -Id $child.Id -ErrorAction SilentlyContinue}
  $detail=[string](Get-Content -LiteralPath $errorLog -Raw -ErrorAction SilentlyContinue)
  if($detail-notmatch 'Address already in use|cannot listen to port|Could not request local forwarding'){throw ('SSH tunnel did not reach the remote companion before the deadline. Details: '+$errorLog)}
}
throw 'No tunnel became ready within 20 seconds or all bridge ports are occupied. No unrelated process or local companion was stopped.'
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
