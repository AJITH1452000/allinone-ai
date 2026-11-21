@echo off
rem Sets Ollama's speed settings, downloads Learn's base models, removes every other model (asks first), rebuilds Learn.
rem Keeps: qwen3:4b-q4_K_M, qwen3:8b, gemma3:4b, nomic-embed-text, learn, learn-vision, learn-32k, learn-max, learn-codeplus
rem Run from the project folder:  cleanup
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "PROJECT=%CD%"
set "OLLAMA_DIR=%LOCALAPPDATA%\Programs\Ollama"
if not exist "%OLLAMA_DIR%\ollama.exe" (echo ERROR: Ollama not found in %OLLAMA_DIR% & exit /b 1)
set "KEEP=qwen3:4b-q4_K_M qwen3:8b gemma3:4b nomic-embed-text learn learn-vision learn-32k learn-max learn-codeplus"

echo [1/5] Saving Ollama speed settings...
for %%V in ("OLLAMA_FLASH_ATTENTION=1" "OLLAMA_KV_CACHE_TYPE=q8_0" "OLLAMA_KEEP_ALIVE=2h" "OLLAMA_MAX_LOADED_MODELS=1" "OLLAMA_NUM_PARALLEL=1") do (
  for /f "tokens=1,2 delims==" %%A in (%%V) do (
    setx %%A %%B >nul || (echo ERROR: could not save %%A & exit /b 1)
    set "%%A=%%B"
  )
)

echo [2/5] Restarting Ollama so it uses the new settings...
taskkill /F /IM "ollama app.exe" >nul 2>&1
taskkill /F /IM "ollama.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "%OLLAMA_DIR%\ollama app.exe"
set /a tries=0
:wait
timeout /t 2 /nobreak >nul
"%OLLAMA_DIR%\ollama.exe" list >nul 2>&1 && goto ready
set /a tries+=1
if !tries! lss 15 goto wait
echo ERROR: Ollama did not start within 30 seconds.
exit /b 1
:ready

echo [3/5] Downloading base models (skipped if you have them)...
for %%M in (qwen3:4b-q4_K_M qwen3:8b gemma3:4b nomic-embed-text) do (
  "%OLLAMA_DIR%\ollama.exe" pull %%M || (echo ERROR: could not download %%M - check your internet & exit /b 1)
)

echo [4/5] Other models on this PC:
pushd "%OLLAMA_DIR%"
set "REMOVE="
for /f "skip=1 tokens=1" %%M in ('ollama.exe list') do (
  set "M=%%M"
  set "SHORT=!M::latest=!"
  set "HIT="
  for %%K in (%KEEP%) do if /i "%%K"=="!SHORT!" set "HIT=1"
  if not defined HIT set "REMOVE=!REMOVE! %%M"
)
popd
if "!REMOVE!"=="" (
  echo    none - nothing to remove.
) else (
  for %%M in (!REMOVE!) do echo    %%M
  set /p "ANS=Remove these models? (Y/N) "
  if /i "!ANS!"=="Y" (
    for %%M in (!REMOVE!) do "%OLLAMA_DIR%\ollama.exe" rm %%M
  ) else (
    echo    Skipped.
  )
)

echo [5/5] Building Learn...
cd /d "%PROJECT%"
call npm run build-models || (echo ERROR: build-models failed & exit /b 1)

echo.
echo Done. Check with:  ollama ps   (PROCESSOR should show as much GPU as possible for learn)
endlocal
