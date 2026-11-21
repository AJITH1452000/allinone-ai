@echo off
rem Starts Claude Code on your own Learn model through Ollama.
rem Usage:  claude-local            (uses learn-code)
rem         claude-local learn-max
set "MODEL=%~1"
if "%MODEL%"=="" set "MODEL=learn-code"
rem Learn Code / Max are built with a 32K context window (num_ctx in models/Modelfile.*).
rem Tell Claude Code the real size so it doesn't assume 1M tokens.
set "CLAUDE_CODE_MAX_CONTEXT_TOKENS=32768"
"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" launch claude --model %MODEL% -y
