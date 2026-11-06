@echo off
title LifeLink - Organ ^& Blood Matching System
echo ============================================
echo   LifeLink - Organ ^& Blood Matching System
echo   http://127.0.0.1:8931
echo   (keep this window open, then Ctrl+C)
echo ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\serve.ps1"
pause
