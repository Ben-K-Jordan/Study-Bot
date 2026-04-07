@echo off
echo ============================================
echo   Study Bot - Starting up...
echo ============================================
echo.

:: Check if Docker Desktop is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/4] Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo       Waiting for Docker to start...
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% neq 0 goto wait_docker
    echo       Docker is ready!
) else (
    echo [1/4] Docker Desktop is already running.
)

echo.
echo [2/4] Starting database...
docker compose up -d
if %errorlevel% neq 0 (
    echo       ERROR: Failed to start database. Is Docker Desktop fully loaded?
    pause
    exit /b 1
)

:: Wait for Postgres to accept connections
echo       Waiting for database to be ready...
:wait_db
timeout /t 2 /nobreak >nul
docker compose exec -T db pg_isready -U postgres >nul 2>&1
if %errorlevel% neq 0 goto wait_db
echo       Database is ready!

echo.
echo [3/4] Syncing database schema...
call npx prisma generate
call npx prisma db push --skip-generate
echo       Schema synced!

echo.
echo [4/4] Starting dev server...
echo ============================================
echo   Open http://localhost:3000 in your browser
echo   Press Ctrl+C to stop
echo ============================================
echo.
npm run dev
