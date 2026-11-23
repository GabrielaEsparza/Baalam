# Compila y firma la app de Android (BÁALAM GYM).
#
# IMPORTANTE: la app tiene código propio (avisos nativos con Firebase: FcmService.java,
# LauncherActivity.java, Application.java). NO usar `bubblewrap update`: regenera el proyecto
# y borra esos cambios. Para una versión nueva: subir versionCode/versionName en app/build.gradle
# y correr este script.
#
# Requisitos: JDK 17, Android SDK en C:\Users\multi\android-sdk, app/google-services.json y la
# llave de subida en Documentos\BAALAM-firma-android (con LEEME-contrasena.txt).

$ErrorActionPreference = "Stop"
$proj = $PSScriptRoot
$sdk = "C:\Users\multi\android-sdk"
$keyDir = "C:\Users\multi\Documents\BAALAM-firma-android"
$out = "C:\Users\multi\Documents\BAALAM-android"

$jdk = (cmd /c 'for %I in ("C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot") do @echo %~sI').Trim()
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue

if (-not (Test-Path "$proj\app\google-services.json")) { throw "Falta app\google-services.json (Firebase)." }
$pw = ((Get-Content "$keyDir\LEEME-contrasena.txt" | Select-String "^Contrasena").Line -split ": ", 2)[1].Trim()
$bt = (Get-ChildItem "$sdk\build-tools" | Sort-Object Name -Descending | Select-Object -First 1).FullName

Set-Location $proj
[Environment]::CurrentDirectory = $proj
cmd /c "cd /d $proj && gradlew.bat --no-daemon clean bundleRelease assembleRelease"
if ($LASTEXITCODE -ne 0) { throw "Falló la compilación de Gradle." }

$version = (Select-String -Path "$proj\app\build.gradle" -Pattern 'versionName "([^"]+)"').Matches[0].Groups[1].Value

# App Bundle (.aab) para Play Console: firmado con la llave de subida
$aab = "$proj\app\build\outputs\bundle\release\app-release.aab"
& "$jdk\bin\jarsigner.exe" -keystore "$keyDir\baalam-upload.jks" -storepass $pw -keypass $pw -sigalg SHA256withRSA -digestalg SHA-256 $aab baalam | Out-Null
Copy-Item $aab "$out\baalam-v$version.aab" -Force

# APK de prueba (instalación directa)
$unsigned = "$proj\app\build\outputs\apk\release\app-release-unsigned.apk"
$aligned = "$proj\app\build\outputs\apk\release\app-release-aligned.apk"
& "$bt\zipalign.exe" -f -p 4 $unsigned $aligned
& "$jdk\bin\java.exe" -jar "$bt\lib\apksigner.jar" sign --ks "$keyDir\baalam-upload.jks" --ks-key-alias baalam --ks-pass "pass:$pw" --key-pass "pass:$pw" --out "$out\baalam-v$version-prueba.apk" $aligned

Write-Output "Listo: $out\baalam-v$version.aab y baalam-v$version-prueba.apk"
