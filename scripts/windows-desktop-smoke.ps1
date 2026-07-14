param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [string]$BaselineInstaller,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory
)

$ErrorActionPreference = "Stop"
$productName = "Local Fitness Advisor"
$applicationName = "$productName.exe"
$installRoot = Join-Path $env:RUNNER_TEMP "lfa-smoke"
$evidenceRoot = New-Item -ItemType Directory -Force -Path $EvidenceDirectory
$healthTimeoutSeconds = 240

function Stop-DesktopProcess([System.Diagnostics.Process]$Process) {
  if (-not $Process.HasExited) {
    try {
      $null = $Process.CloseMainWindow()
    } catch {
      # Process does not expose a main window in this session.
    }
    if (-not $Process.WaitForExit(30000)) {
      & taskkill /PID $Process.Id /T /F
      if ($LASTEXITCODE -ne 0) {
        throw "Unable to stop desktop process $($Process.Id)."
      }
      if (-not $Process.WaitForExit(10000)) {
        throw "Desktop process $($Process.Id) did not exit within 10 seconds after force stop."
      }
    }
  }
}

function Wait-ForHealth {
  for ($attempt = 0; $attempt -lt $healthTimeoutSeconds; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "https://127.0.0.1:4317/api/health" -SkipCertificateCheck
      if ($health.ok -eq $true) {
        return
      }
    } catch {
      # Server not yet ready
    }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/health"
      if ($health.ok -eq $true) {
        return
      }
    } catch {
      # Server not yet ready
    }
    Start-Sleep -Seconds 1
  }
  throw "The installed desktop application did not expose its local health endpoint within $healthTimeoutSeconds seconds."
}

try {
  Remove-Item -Recurse -Force $installRoot -ErrorAction SilentlyContinue
  $initialInstaller = if ($BaselineInstaller) { $BaselineInstaller } else { $Installer }
  $installerProcess = Start-Process -FilePath $initialInstaller -ArgumentList "/S", "/D=$installRoot" -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installerProcess.ExitCode)."
  }

  $application = Join-Path $installRoot $applicationName
  if (-not (Test-Path $application)) {
    throw "Desktop application not found at expected installation path: $application."
  }
  $rule = Get-NetFirewallRule -DisplayName $productName -ErrorAction Stop
  $filter = $rule | Get-NetFirewallApplicationFilter
  if (-not (@($filter.Program) | Where-Object { $_ -eq $application })) {
    throw "Installed firewall rule does not target the desktop executable."
  }
  $profiles = @($rule.Profile)
  if ($profiles.Count -ne 1 -or $profiles -notcontains "Private") {
    throw "Installed firewall rule is not restricted to the private profile."
  }

  $firstLaunch = Start-Process -FilePath $application -PassThru
  Wait-ForHealth
  $manifest = Get-ChildItem $env:APPDATA -Filter "storage-backend.json" -Recurse |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $manifest) {
    throw "The packaged runtime did not create an encrypted DuckDB storage manifest."
  }
  $storage = Get-Content $manifest.FullName -Raw | ConvertFrom-Json
  if ($storage.storageBackend -ne "duckdb") {
    throw "The packaged runtime selected '$($storage.storageBackend)' instead of encrypted DuckDB."
  }
  if (-not (Get-ChildItem (Join-Path $manifest.DirectoryName "duckdb-storage") -Filter "*.duckdb" -Recurse -ErrorAction SilentlyContinue)) {
    throw "The packaged runtime did not create an encrypted DuckDB database."
  }
  $manifestHash = (Get-FileHash $manifest.FullName -Algorithm SHA256).Hash
  Stop-DesktopProcess $firstLaunch

  if ($BaselineInstaller) {
    $upgradeProcess = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$installRoot" -Wait -PassThru
    if ($upgradeProcess.ExitCode -ne 0) {
      throw "Upgrade installer exited with code $($upgradeProcess.ExitCode)."
    }
  }

  $secondLaunch = Start-Process -FilePath $application -PassThru
  Wait-ForHealth
  if ((Get-FileHash $manifest.FullName -Algorithm SHA256).Hash -ne $manifestHash) {
    throw "Encrypted DuckDB storage metadata did not persist across restart."
  }
  $extensionDirectory = Join-Path $installRoot "resources\duckdb-extensions"
  $extensionManifest = Get-Content (Join-Path $extensionDirectory "manifest.json") -Raw | ConvertFrom-Json
  if ((Get-FileHash (Join-Path $extensionDirectory "httpfs.duckdb_extension") -Algorithm SHA256).Hash.ToLower() -ne $extensionManifest.sha256.ToLower()) {
    throw "The installed DuckDB extension does not match its manifest."
  }
  Stop-DesktopProcess $secondLaunch

  $uninstaller = Join-Path $installRoot "Uninstall Local Fitness Advisor.exe"
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
    installerSha256 = (Get-FileHash $Installer -Algorithm SHA256).Hash
    storageManifest = $manifest.FullName
    storageManifestSha256 = $manifestHash
    upgraded = [bool]$BaselineInstaller
    firewallRuleRemoved = $true
  } | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot "smoke-test.json")
} finally {
  if ($firstLaunch) {
    Stop-DesktopProcess $firstLaunch
  }
  if ($secondLaunch) {
    Stop-DesktopProcess $secondLaunch
  }
}
