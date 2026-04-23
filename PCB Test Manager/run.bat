@echo off
cd /d "%~dp0"
pip install -r requirements.txt -q
start http://localhost:5000
python app.py
pause
