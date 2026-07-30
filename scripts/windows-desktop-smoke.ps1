param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [string]$BaselineInstaller,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,
  [ValidateSet("Fast", "Full")]
  [string]$Scope = "Full",
  [int]$HealthTimeoutSeconds = 0
)

$ErrorActionPreference = "Stop"
$productName = "Vitana Health"
$applicationName = "$productName.exe"
$installRoot = Join-Path $env:RUNNER_TEMP "vitana-smoke"
$evidenceRoot = New-Item -ItemType Directory -Force -Path $EvidenceDirectory
$gracefulShutdownTimeoutMs = 30000
$forcedShutdownTimeoutMs = 10000
$forcedShutdownTimeoutSeconds = [int]($forcedShutdownTimeoutMs / 1000)
$effectiveHealthTimeoutSeconds = if ($HealthTimeoutSeconds -gt 0) {
  $HealthTimeoutSeconds
} elseif ($Scope -eq "Fast") {
  60
} else {
  120
}
$healthRequestTimeoutSeconds = 2
$healthUris = @(
  "https://127.0.0.1:4317/api/health",
  "http://127.0.0.1:4317/api/health"
)
$activeHealthUri = $null

function Stop-DesktopProcess([System.Diagnostics.Process]$Process) {
  if (-not $Process.HasExited) {
    try {
      $null = $Process.CloseMainWindow()
    } catch {
      # Process does not expose a main window in this session.
    }
    if (-not $Process.WaitForExit($gracefulShutdownTimeoutMs)) {
      & taskkill /PID $Process.Id /T /F
      if ($LASTEXITCODE -ne 0) {
        throw "Unable to stop desktop process $($Process.Id)."
      }
      if (-not $Process.WaitForExit($forcedShutdownTimeoutMs)) {
        throw "Desktop process $($Process.Id) did not exit within $forcedShutdownTimeoutSeconds seconds after force stop."
      }
    }
  }
}

function Close-DesktopMainWindow([System.Diagnostics.Process]$Process) {
  for ($elapsedSeconds = 0; $elapsedSeconds -lt 30; $elapsedSeconds++) {
    if ($Process.HasExited) {
      throw "Desktop process $($Process.Id) exited before its main window could be closed."
    }
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne 0 -and $Process.CloseMainWindow()) {
      return
    }
    Start-Sleep -Seconds 1
  }
  Save-HealthDiagnostics
  throw "Desktop process $($Process.Id) did not expose a closeable main window within 30 seconds."
}

function Test-HealthEndpoint([string]$Uri) {
  try {
    if ($Uri.StartsWith("https://")) {
      $health = Invoke-RestMethod -Uri $Uri -SkipCertificateCheck -TimeoutSec $healthRequestTimeoutSeconds
    } else {
      $health = Invoke-RestMethod -Uri $Uri -TimeoutSec $healthRequestTimeoutSeconds
    }
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

function Invoke-DesktopApi([string]$Method, [string]$Path, $Body, [Microsoft.PowerShell.Commands.WebRequestSession]$Session) {
  $root = $activeHealthUri.Substring(0, $activeHealthUri.Length - "/api/health".Length)
  $parameters = @{
    Uri = "$root$Path"
    Method = $Method
    WebSession = $Session
    ContentType = "application/json"
  }
  if ($activeHealthUri.StartsWith("https://")) {
    $parameters.SkipCertificateCheck = $true
  }
  if ($null -ne $Body) {
    $parameters.Body = ($Body | ConvertTo-Json -Compress)
  }
  Invoke-RestMethod @parameters
}

function Wait-ForHealthStop {
  for ($elapsedSeconds = 0; $elapsedSeconds -lt 30; $elapsedSeconds++) {
    if (-not (Test-HealthEndpoint $activeHealthUri)) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "The desktop health endpoint remained available after background mode was disabled and the window closed."
}

function Get-LoginStartupCommand {
  $runKey = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
  return @($runKey.PSObject.Properties.Value | Where-Object {
    $_ -is [string] -and $_ -like "*$applicationName*"
  }) | Select-Object -First 1
}

function Wait-ForHealth([string]$Phase) {
  $deadline = [DateTime]::UtcNow.AddSeconds($effectiveHealthTimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    foreach ($healthUri in $healthUris) {
      if (Test-HealthEndpoint $healthUri) {
        $script:activeHealthUri = $healthUri
        return
      }
    }
    Start-Sleep -Milliseconds 500
  }
  Save-HealthDiagnostics
  throw "The installed desktop application did not expose its local health endpoint during $Phase within $effectiveHealthTimeoutSeconds seconds."
}

function Save-HealthDiagnostics {
  $diagnosticsDirectory = New-Item -ItemType Directory -Force -Path (Join-Path $evidenceRoot "health-diagnostics")
  try {
    Get-CimInstance Win32_Process -Filter "Name = '$applicationName'" -ErrorAction SilentlyContinue |
      Select-Object ProcessId, Name, CommandLine |
      ConvertTo-Json | Set-Content (Join-Path $diagnosticsDirectory "processes.json")
  } catch {}
  try {
    (& netstat -ano | Select-String ":4317") | Set-Content (Join-Path $diagnosticsDirectory "port-4317.txt")
  } catch {}
  try {
    $appDataDirectory = Join-Path $env:APPDATA $productName
    if (Test-Path $appDataDirectory) {
      Get-ChildItem $appDataDirectory -Filter "*.log" -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 10 |
        Copy-Item -Destination $diagnosticsDirectory -Force
    }
  } catch {}
}

try {
  Remove-Item -Recurse -Force $installRoot -ErrorAction SilentlyContinue
  $installStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $initialInstaller = if ($BaselineInstaller) { $BaselineInstaller } else { $Installer }
  $installerProcess = Start-Process -FilePath $initialInstaller -ArgumentList "/S", "/D=$installRoot" -Wait -PassThru
  $installStopwatch.Stop()
  if ($installerProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installerProcess.ExitCode)."
  }

  $application = Join-Path $installRoot $applicationName
  if (-not (Test-Path $application)) {
    throw "Desktop application not found at expected installation path: $application."
  }
  if ($Scope -eq "Full") {
    $rule = Get-NetFirewallRule -DisplayName $productName -ErrorAction Stop
    $filter = $rule | Get-NetFirewallApplicationFilter
    if (-not (@($filter.Program) | Where-Object { $_ -eq $application })) {
      throw "Installed firewall rule does not target the desktop executable."
    }
    $profiles = @($rule.Profile)
    if ($profiles.Count -ne 1 -or $profiles -notcontains "Private") {
      throw "Installed firewall rule is not restricted to the private profile."
    }
  }

  $firstLaunch = Start-Process -FilePath $application -PassThru
  $firstLaunchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Wait-ForHealth "initial startup"
  $firstLaunchStopwatch.Stop()
  $manifest = Get-ChildItem $env:APPDATA -Filter "storage-backend.json" -Recurse |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $manifest) {
    throw "The packaged runtime did not create an encrypted DuckDB storage manifest."
  }
  $storage = Get-Content $manifest.FullName -Raw | ConvertFrom-Json
  if ($storage.backend -ne "duckdb") {
    throw "Storage manifest '$($manifest.FullName)' selected '$($storage.backend)' instead of encrypted DuckDB."
  }
  # Evidence that the DuckDB native binding loaded under Electron's module ABI: `npmRebuild` is off,
  # so the prebuild is compiled for Node and only ever exercised against Electron here and in the
  # `verify:native-abi` gate. A database file exists only if a real query ran through the binding.
  if (-not (Get-ChildItem (Join-Path $manifest.DirectoryName "duckdb-storage") -Filter "*.duckdb" -Recurse -ErrorAction SilentlyContinue)) {
    throw "The packaged runtime did not create an encrypted DuckDB database."
  }
  if ($Scope -eq "Fast") {
    Stop-DesktopProcess $firstLaunch
    [pscustomobject]@{
      scope = "fast"
      installerSha256 = (Get-FileHash $Installer -Algorithm SHA256).Hash
      storageManifest = $manifest.FullName
      nativeBindingLoaded = $true
      install_ms = $installStopwatch.ElapsedMilliseconds
      launch_to_health_ms = $firstLaunchStopwatch.ElapsedMilliseconds
    } | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot "smoke-test-fast.json")
    return
  }
  $manifestHash = (Get-FileHash $manifest.FullName -Algorithm SHA256).Hash
  $ownerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $null = Invoke-DesktopApi "POST" "/api/auth/local" $null $ownerSession
  $enabledSettings = Invoke-DesktopApi "PUT" "/api/settings/desktop" @{ backgroundServiceEnabled = $true } $ownerSession
  if (-not $enabledSettings.backgroundServiceEnabled) {
    throw "The desktop API did not enable background service mode."
  }
  Close-DesktopMainWindow $firstLaunch
  # Poll rather than sleeping a fixed two seconds: the assertion is that health survives the
  # window closing, and Wait-ForHealth already captures diagnostics when it does not.
  Wait-ForHealth "background service mode"
  $loginCommand = Get-LoginStartupCommand
  if (-not $loginCommand -or $loginCommand -notlike "*--background*") {
    throw "Per-user login registration does not include --background."
  }
  $relaunch = Start-Process -FilePath $application -PassThru
  if (-not $relaunch.WaitForExit(30000)) {
    throw "A second desktop launch did not hand off to the existing singleton process."
  }
  if ($firstLaunch.HasExited -or -not (Test-HealthEndpoint $activeHealthUri)) {
    throw "A second desktop launch replaced or stopped the existing service process."
  }
  if ($BaselineInstaller) {
    $disabledSettings = Invoke-DesktopApi "PUT" "/api/settings/desktop" @{ backgroundServiceEnabled = $false } $ownerSession
    if ($disabledSettings.backgroundServiceEnabled -or (Get-LoginStartupCommand)) {
      throw "Disabling background service mode did not remove login registration."
    }
    Close-DesktopMainWindow $firstLaunch
    Wait-ForHealthStop
    $upgradeProcess = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$installRoot" -Wait -PassThru
    if ($upgradeProcess.ExitCode -ne 0) {
      throw "Upgrade installer exited with code $($upgradeProcess.ExitCode)."
    }
  } else {
    $disabledSettings = Invoke-DesktopApi "PUT" "/api/settings/desktop" @{ backgroundServiceEnabled = $false } $ownerSession
    if ($disabledSettings.backgroundServiceEnabled -or (Get-LoginStartupCommand)) {
      throw "Disabling background service mode did not remove login registration."
    }
    Close-DesktopMainWindow $firstLaunch
    Wait-ForHealthStop
  }

  $secondLaunch = Start-Process -FilePath $application -PassThru
  if (-not $secondLaunch) {
    throw "Updated desktop process was not running after restart."
  }
  $secondLaunchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Wait-ForHealth "restart"
  $secondLaunchStopwatch.Stop()
  if ((Get-FileHash $manifest.FullName -Algorithm SHA256).Hash -ne $manifestHash) {
    throw "Encrypted DuckDB storage metadata did not persist across restart."
  }
  $extensionDirectory = Join-Path $installRoot "resources\duckdb-extensions"
  $extensionManifest = Get-Content (Join-Path $extensionDirectory "manifest.json") -Raw | ConvertFrom-Json
  if ((Get-FileHash (Join-Path $extensionDirectory "httpfs.duckdb_extension") -Algorithm SHA256).Hash.ToLower() -ne $extensionManifest.sha256.ToLower()) {
    throw "The installed DuckDB extension does not match its manifest."
  }
  Stop-DesktopProcess $secondLaunch

  $uninstaller = Join-Path $installRoot "Uninstall Vitana Health.exe"
  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "Uninstaller exited with code $($uninstallProcess.ExitCode)."
  }
  if (Get-NetFirewallRule -DisplayName $productName -ErrorAction SilentlyContinue) {
    throw "The firewall rule remained after uninstall."
  }
  if (-not (Test-Path $manifest.FullName)) {
    throw "Uninstall removed retained encrypted DuckDB app data."
  }

  [pscustomobject]@{
    scope = "full"
    installerSha256 = (Get-FileHash $Installer -Algorithm SHA256).Hash
    storageManifest = $manifest.FullName
    storageManifestSha256 = $manifestHash
    upgraded = [bool]$BaselineInstaller
    firewallRuleRemoved = $true
    install_ms = $installStopwatch.ElapsedMilliseconds
    launch_to_health_ms = $firstLaunchStopwatch.ElapsedMilliseconds
    restart_to_health_ms = $secondLaunchStopwatch.ElapsedMilliseconds
  } | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot "smoke-test.json")
} finally {
  if ($firstLaunch) {
    Stop-DesktopProcess $firstLaunch
  }
  if ($secondLaunch) {
    Stop-DesktopProcess $secondLaunch
  }
}
