param(
  [string]$OutputDirectory = "C:\secure",
  [string]$CommonName = "Vitana Health",
  [ValidateRange(1, 10)]
  [int]$ValidYears = 2,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$pfxPath = Join-Path $OutputDirectory "vitana-lan-test.pfx"
$publicCertificatePath = Join-Path $OutputDirectory "vitana-lan-test.cer"

if ((Test-Path $pfxPath) -and -not $Force) {
  throw "A LAN signing PFX already exists at $pfxPath. Use -Force only when deliberately rotating the LAN signing identity."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$password = Read-Host "Choose a password for the LAN signing PFX" -AsSecureString
$certificate = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=$CommonName" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($ValidYears) `
  -FriendlyName "$CommonName LAN Test"

try {
  Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $password | Out-Null
  Export-Certificate -Cert $certificate -FilePath $publicCertificatePath | Out-Null
} catch {
  Remove-Item "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  throw
}

Write-Host "Created LAN signing certificate $($certificate.Thumbprint)."
Write-Host "Protected PFX: $pfxPath"
Write-Host "Public certificate: $publicCertificatePath"
Write-Host "Install the public certificate on each trusted test PC in Local Machine Trusted Root Certification Authorities and Trusted Publishers."