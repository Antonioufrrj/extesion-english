@echo off
:: Para o servidor de transcrição
taskkill /F /IM pythonw.exe /T >nul 2>&1
echo Servidor parado.
timeout /t 2 >nul
