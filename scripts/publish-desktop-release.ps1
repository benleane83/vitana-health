[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
  throw "Version must be a SemVer tag beginning with 'v', for example v0.1.27."
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "This script must run inside the Vitana Git repository."
}
Set-Location $repoRoot

$branch = (git symbolic-ref --quiet --short HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
  throw "Refusing to publish from a detached HEAD."
}

$trackedFiles = @("apps/desktop/package.json", "package-lock.json")
git diff --quiet -- $trackedFiles
$workingTreeChanges = $LASTEXITCODE
git diff --cached --quiet -- $trackedFiles
$stagedChanges = $LASTEXITCODE
if ($workingTreeChanges -ne 0 -or $stagedChanges -ne 0) {
  throw "The release files already have changes. Commit or discard them before publishing."
}

git rev-parse --verify --quiet "refs/tags/$Version" *> $null
if ($LASTEXITCODE -eq 0) {
  throw "Local tag '$Version' already exists."
}
git ls-remote --exit-code --tags origin "refs/tags/$Version" *> $null
if ($LASTEXITCODE -eq 0) {
  throw "Remote tag '$Version' already exists."
}
if ($LASTEXITCODE -ne 2) {
  throw "Unable to check whether remote tag '$Version' already exists."
}

$desktopPackage = Get-Content "apps/desktop/package.json" -Raw | ConvertFrom-Json
if ($desktopPackage.version -eq $Version.Substring(1)) {
  throw "Desktop package is already version $Version."
}

if ($WhatIfPreference) {
  Write-Host "Would update apps/desktop/package.json and package-lock.json to $Version."
  Write-Host "Would commit, create tag $Version, push $branch, then push tag $Version."
  exit 0
}

npm version $Version.Substring(1) --workspace @vitana/desktop --no-git-tag-version --ignore-scripts
if ($LASTEXITCODE -ne 0) {
  throw "npm version failed."
}

npm install --package-lock-only --ignore-scripts
if ($LASTEXITCODE -ne 0) {
  throw "Updating package-lock.json failed."
}

$updatedDesktopPackage = Get-Content "apps/desktop/package.json" -Raw | ConvertFrom-Json
$lockfile = Get-Content "package-lock.json" -Raw | ConvertFrom-Json -AsHashtable
if ($updatedDesktopPackage.version -ne $Version.Substring(1) -or
    $lockfile.packages["apps/desktop"].version -ne $Version.Substring(1)) {
  throw "Version verification failed for apps/desktop/package.json or package-lock.json."
}

$changedFiles = @(git diff --name-only)
if ($changedFiles.Count -ne 2 -or
    $changedFiles -notcontains "apps/desktop/package.json" -or
    $changedFiles -notcontains "package-lock.json") {
  throw "Versioning changed unexpected files: $($changedFiles -join ', ')."
}

git add -- "apps/desktop/package.json" "package-lock.json"
git commit -m "chore: release $Version`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
if ($LASTEXITCODE -ne 0) {
  throw "Git commit failed."
}

git tag -a $Version -m "Release $Version"
if ($LASTEXITCODE -ne 0) {
  throw "Creating tag '$Version' failed."
}

git push origin HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Pushing branch '$branch' failed. The tag '$Version' remains local."
}

git push origin $Version
if ($LASTEXITCODE -ne 0) {
  throw "Pushing tag '$Version' failed. The commit is pushed, but the release workflow was not triggered."
}

Write-Host "Published $Version from $branch. The GitHub release workflow should now be running."
