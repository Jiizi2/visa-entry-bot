Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@
$p = Start-Process -FilePath 'C:\visa-entry-bot\passport-desktop\src-tauri\target\release\entrymate-by-ghaniya.exe' -PassThru
Start-Sleep -Seconds 5
$p.Refresh()
$hwnd = $p.MainWindowHandle
Write-Output "hwnd=$hwnd"
if ($hwnd -eq 0) { Stop-Process -Id $p.Id -Force; exit 1 }
[Win32]::ShowWindow($hwnd, 9) | Out-Null
[Win32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 800
$rect = New-Object RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = [Math]::Max(1, $rect.Right - $rect.Left)
$h = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$out = 'C:\visa-entry-bot\passport-desktop\tauri-window.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$p.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 1
if (!$p.HasExited) { Stop-Process -Id $p.Id -Force }
Write-Output $out
Write-Output "size=${w}x${h}"
