# Force build - just calls auto_builder.ps1 with -Force
& "$PSScriptRoot\auto_builder.ps1" -Force

# 창이 바로 꺼지지 않도록 사용자 입력을 대기
Write-Host "`nPress Enter to exit..." -ForegroundColor Cyan
Read-Host
