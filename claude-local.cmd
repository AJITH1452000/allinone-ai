@echo off
rem Starts Claude Code on your own Learn model through Ollama.
rem Usage:  claude-local            (uses learn-32k)
rem         claude-local learn        (8K window, faster)
set "MODEL=%~1"
if "%MODEL%"=="" set "MODEL=learn-32k"
rem learn-32k is Learn built with a 32K window (models/Modelfile.32k).
rem Tell Claude Code the real size so it doesn't assume 1M tokens.
set "CLAUDE_CODE_MAX_CONTEXT_TOKENS=32768"
"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" launch claude --model %MODEL% -y
