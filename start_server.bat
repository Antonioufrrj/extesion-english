@echo off
:: Inicia o servidor de transcrição em background (sem janela visível)
:: Coloque um atalho deste arquivo em:
::   shell:startup  (C:\Users\SEU_USUARIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup)
:: para iniciar automaticamente com o Windows.

cd /d "%~dp0"
start "" /B pythonw server.py
