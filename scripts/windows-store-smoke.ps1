param(
  [Parameter(Mandatory = $true)]
  [string]$Package,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceDirectory,
  [string]$IdentityName = "VitanaHealth.StoreTest",
  [string]$ApplicationId = "VitanaHealth",
  [int]$HealthTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$productName = "Vitana Health"
$applicationName = "$productName.exe"
$evidenceRoot = New-Item -ItemType Directory -Force -Path $EvidenceDirectory
$healthRequestTimeoutSeconds = 2
$healthUris = @(
  "https://127.0.0.1:4317/api/health",
  "http://127.0.0.1:4317/api/health"
)
$activeHealthUri = $null
$installedPackage = $null
$desktopProcess = $null
$storageManifest = $null
$nsisStorageManifest = Join-Path $env:APPDATA "$productName\storage-backend.json"
$nsisStorageManifestHash = if (Test-Path $nsisStorageManifest) {
  (Get-FileHash $nsisStorageManifest -Algorithm SHA256).Hash
} else {
  $null
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

function Wait-ForHealth([string]$Phase) {
  $deadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    foreach ($healthUri in $healthUris) {
      if (Test-HealthEndpoint $healthUri) {
        $script:activeHealthUri = $healthUri
        return
      }
    }
    Start-Sleep -Milliseconds 500
  }
  Save-StoreDiagnostics
  throw "The installed Store-test application did not expose its local health endpoint during $Phase within $HealthTimeoutSeconds seconds."
}

function Get-InstalledDesktopProcess {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    $candidate = Get-CimInstance Win32_Process -Filter "Name = '$applicationName'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -like "$($installedPackage.InstallLocation)*" } |
      Select-Object -First 1
    if ($candidate) {
      return Get-Process -Id $candidate.ProcessId
    }
    Start-Sleep -Milliseconds 500
  }
  throw "The installed Store-test desktop process did not start within 30 seconds."
}

function Wait-ForMainWindow([System.Diagnostics.Process]$Process) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process.HasExited) {
      throw "The Store-test desktop process exited before loading its main window."
    }
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  Save-StoreDiagnostics
  throw "The Store-test desktop process did not load a main window within 30 seconds."
}

function Stop-DesktopProcess([System.Diagnostics.Process]$Process) {
  if (-not $Process -or $Process.HasExited) {
    return
  }
  $Process.Refresh()
  if ($Process.MainWindowHandle -ne 0) {
    $null = $Process.CloseMainWindow()
  }
  if (-not $Process.WaitForExit(30000)) {
    & taskkill /PID $Process.Id /T /F
    if ($LASTEXITCODE -ne 0 -or -not $Process.WaitForExit(10000)) {
      throw "Unable to stop Store-test desktop process $($Process.Id)."
    }
  }
}

function Save-StoreDiagnostics {
  $diagnosticsDirectory = New-Item -ItemType Directory -Force -Path (Join-Path $evidenceRoot "diagnostics")
  try {
    Get-AppxPackage -Name $IdentityName |
      Select-Object Name, PackageFullName, PackageFamilyName, InstallLocation, Status |
      ConvertTo-Json | Set-Content (Join-Path $diagnosticsDirectory "package.json")
  } catch {}
  try {
    Get-CimInstance Win32_Process -Filter "Name = '$applicationName'" -ErrorAction SilentlyContinue |
      Select-Object ProcessId, Name, ExecutablePath, CommandLine |
      ConvertTo-Json | Set-Content (Join-Path $diagnosticsDirectory "processes.json")
  } catch {}
  try {
    (& netstat -ano | Select-String ":4317") | Set-Content (Join-Path $diagnosticsDirectory "port-4317.txt")
  } catch {}
  try {
    Get-NetFirewallRule -DisplayName "*Vitana*" -ErrorAction SilentlyContinue |
      Select-Object DisplayName, Enabled, Direction, Action, Profile |
      ConvertTo-Json | Set-Content (Join-Path $diagnosticsDirectory "firewall-rules.json")
  } catch {}
  try {
    Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue |
      Where-Object { $_.Command -like "*Vitana*" -or $_.Name -like "*Vitana*" } |
      Select-Object Name, Command, Location, User |
      ConvertTo-Json | Set-Content (Join-Path $diagnosticsDirectory "startup-registration.json")
  } catch {}
  try {
    if ($installedPackage) {
      $packageDataRoot = Join-Path $env:LOCALAPPDATA "Packages\$($installedPackage.PackageFamilyName)"
      if (Test-Path $packageDataRoot) {
        Get-ChildItem $packageDataRoot -Filter "*.log" -Recurse -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTimeUtc -Descending |
          Select-Object -First 10 |
          Copy-Item -Destination $diagnosticsDirectory -Force
      }
    }
  } catch {}
}

try {
  $resolvedPackage = (Resolve-Path $Package).Path
  foreach ($healthUri in $healthUris) {
    if (Test-HealthEndpoint $healthUri) {
      throw "Port 4317 is already serving a Vitana health endpoint. Stop the existing NSIS or Store-test app before running this smoke test."
    }
  }
  Get-AppxPackage -Name $IdentityName | Remove-AppxPackage
  Add-AppxPackage -Path $resolvedPackage
  $installedPackage = Get-AppxPackage -Name $IdentityName | Select-Object -First 1
  if (-not $installedPackage) {
    throw "Package identity '$IdentityName' was not installed."
  }

  $launchTarget = "shell:AppsFolder\$($installedPackage.PackageFamilyName)!$ApplicationId"
  Start-Process explorer.exe -ArgumentList $launchTarget
  $launchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Wait-ForHealth "initial startup"
  $launchStopwatch.Stop()
  $desktopProcess = Get-InstalledDesktopProcess
  Wait-ForMainWindow $desktopProcess

  $packageDataRoot = Join-Path $env:LOCALAPPDATA "Packages\$($installedPackage.PackageFamilyName)"
  $storageManifest = Get-ChildItem $packageDataRoot -Filter "storage-backend.json" -Recurse -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $storageManifest) {
    throw "The Store-test runtime did not create an encrypted DuckDB storage manifest under its isolated package data root."
  }
  $storage = Get-Content $storageManifest.FullName -Raw | ConvertFrom-Json
  if ($storage.backend -ne "duckdb") {
    throw "Storage manifest '$($storageManifest.FullName)' selected '$($storage.backend)' instead of encrypted DuckDB."
  }
  if (-not (Get-ChildItem (Join-Path $storageManifest.DirectoryName "duckdb-storage") -Filter "*.duckdb" -Recurse -ErrorAction SilentlyContinue)) {
    throw "The Store-test runtime did not create an encrypted DuckDB database."
  }

  $extensionDirectory = Join-Path $installedPackage.InstallLocation "app\resources\duckdb-extensions"
  $extensionManifest = Get-Content (Join-Path $extensionDirectory "manifest.json") -Raw | ConvertFrom-Json
  $extensionHash = (Get-FileHash (Join-Path $extensionDirectory "httpfs.duckdb_extension") -Algorithm SHA256).Hash
  if ($extensionHash.ToLower() -ne $extensionManifest.sha256.ToLower()) {
    throw "The installed DuckDB extension does not match its manifest."
  }

  Stop-DesktopProcess $desktopProcess
  $desktopProcess = $null
  Start-Process explorer.exe -ArgumentList $launchTarget
  $restartStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Wait-ForHealth "restart"
  $restartStopwatch.Stop()
  $desktopProcess = Get-InstalledDesktopProcess
  Wait-ForMainWindow $desktopProcess

  if (
    ($nsisStorageManifestHash -and (Get-FileHash $nsisStorageManifest -Algorithm SHA256).Hash -ne $nsisStorageManifestHash) -or
    (-not $nsisStorageManifestHash -and (Test-Path $nsisStorageManifest))
  ) {
    throw "The Store-test run modified the existing NSIS storage manifest."
  }
  Save-StoreDiagnostics
  [pscustomobject]@{
    packageSha256 = (Get-FileHash $resolvedPackage -Algorithm SHA256).Hash
    packageFullName = $installedPackage.PackageFullName
    packageFamilyName = $installedPackage.PackageFamilyName
    installLocation = $installedPackage.InstallLocation
    dataRoot = $packageDataRoot
    storageManifest = $storageManifest.FullName
    profileIsolatedFromNsis = -not $storageManifest.FullName.StartsWith((Join-Path $env:APPDATA $productName))
    existingNsisProfilePreserved = $true
    healthUri = $activeHealthUri
    launch_to_health_ms = $launchStopwatch.ElapsedMilliseconds
    restart_to_health_ms = $restartStopwatch.ElapsedMilliseconds
  } | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot "store-smoke-test.json")
} finally {
  Save-StoreDiagnostics
  if ($desktopProcess) {
    Stop-DesktopProcess $desktopProcess
  }
  if ($installedPackage) {
    Remove-AppxPackage -Package $installedPackage.PackageFullName
  }
}
