# PC 앱 빌드: desktop\dist\ActionItem.exe 생성 (별도 설치 없이 윈도우 기본 C# 컴파일러 사용)
$ErrorActionPreference = 'Stop'
$d = $PSScriptRoot
$b = "$d\.build"
$wv = "$b\webview2"
if (-not (Test-Path "$wv\lib\net462\Microsoft.Web.WebView2.Core.dll")) {
  New-Item -ItemType Directory -Force $b | Out-Null
  Invoke-WebRequest -UseBasicParsing "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.4314.35" -OutFile "$b\webview2.zip"
  Expand-Archive "$b\webview2.zip" -DestinationPath $wv -Force
}
if (-not (Test-Path "$d\app.ico")) { & "$d\make-icon.ps1" }
New-Item -ItemType Directory -Force "$d\dist" | Out-Null

$core = "$wv\lib\net462\Microsoft.Web.WebView2.Core.dll"
$wf = "$wv\lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$loader = "$wv\runtimes\win-x64\native\WebView2Loader.dll"
$fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"

& "$fw\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 `
  /out:"$d\dist\ActionItem.exe" /win32icon:"$d\app.ico" `
  /r:"$core" /r:"$wf" /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /resource:"$core,Microsoft.Web.WebView2.Core.dll" `
  /resource:"$wf,Microsoft.Web.WebView2.WinForms.dll" `
  /resource:"$loader,WebView2Loader.dll" `
  "$d\ActionItem.cs"
if ($LASTEXITCODE -ne 0) { throw "build failed" }
Get-Item "$d\dist\ActionItem.exe" | Select-Object FullName, Length
