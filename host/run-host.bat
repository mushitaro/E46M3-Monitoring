@echo off
rem ============================================================
rem  OldBmwDiagHost — ローカル EdiabasLib ブリッジ 起動
rem  PWA の「EdiabasLibホスト」モードの接続先 (http://127.0.0.1:5199)
rem
rem  使い方:
rem    run-host.bat                                     … mock（ハード不要・既定）
rem    run-host.bat ediabas                             … 実車（要 EdiabasLib, 自動で -p:UseEdiabas）
rem    run-host.bat ediabas --record recordings\m3.json … 実車セッションを記録
rem    run-host.bat replay  --recording recordings\m3.json … 記録を再生（ハード不要・実データ）
rem
rem  実車(ediabas)は COMポート指定が要る（手順: CONNECT-VEHICLE.md）:
rem    set EDIABAS_COMPORT=COM3
rem ============================================================
setlocal
cd /d "%~dp0"

where dotnet >nul 2>nul
if errorlevel 1 ( echo [ERROR] .NET SDK が必要です https://dotnet.microsoft.com/ & pause & exit /b 1 )

set BACKEND=%1
if "%BACKEND%"=="" set BACKEND=mock

rem 実車(ediabas)は EdiabasLib 参照ビルドが要る
set BUILDARGS=
if /I "%BACKEND%"=="ediabas" set BUILDARGS=-p:UseEdiabas=true

echo OldBmwDiagHost 起動  backend=%BACKEND%  http://127.0.0.1:5199/
echo （停止: Ctrl+C）
echo.
dotnet run -c Release %BUILDARGS% -- --backend %BACKEND% --port 5199 %2 %3 %4 %5
pause
