@echo off
rem Builds the Windows installer into the dist folder: build the app, sign it for video playback, then package it.
cd /d "%~dp0"
call npx electron-builder --win dir || exit /b 1
python -m castlabs_evs.vmp sign-pkg dist/win-unpacked || exit /b 1
call npx electron-builder --win nsis --prepackaged dist/win-unpacked
