Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Capture {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@
$p = Start-Process -FilePath 'C:\visa-entry-bot\passport-desktop\src-tauri\target\release\entrymate-by-ghaniya.exe' -PassThru
Start-Sleep -Seconds 6
$p.Refresh()
$hwnd = $p.MainWindowHandle
Write-Output "hwnd=$hwnd"
if ($hwnd -eq 0) { Stop-Process -Id $p.Id -Force; exit 1 }
[Win32Capture]::ShowWindow($hwnd, 9) | Out-Null
[Win32Capture]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 1000
$rect = New-Object RECT
[Win32Capture]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = [Math]::Max(1, $rect.Right - $rect.Left)
$h = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win32Capture]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$out = 'C:\visa-entry-bot\passport-desktop\tauri-printwindow.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$p.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 1
if (!$p.HasExited) { Stop-Process -Id $p.Id -Force }
Write-Output "ok=$ok"
Write-Output $out
Write-Output "size=${w}x${h}"
