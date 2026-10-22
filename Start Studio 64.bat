@echo off
rem Studio 64 for Windows: double-click this file.
rem The first start downloads what Studio 64 needs and opens the setup in your browser.
rem (If Windows says "Windows protected your PC": click "More info", then "Run anyway".)
title Studio 64
cd /d "%~dp0"
where powershell >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Windows PowerShell was not found. Studio 64 needs Windows 10 or 11.
  echo.
  pause
  exit /b 1
)
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1" %*
if errorlevel 1 (
  echo.
  pause
)
