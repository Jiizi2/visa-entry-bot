Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Enum {
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
 public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
"@
$p = Start-Process -FilePath 'C:\visa-entry-bot\passport-desktop\src-tauri\target\release\entrymate-by-ghaniya.exe' -PassThru
Start-Sleep -Seconds 5
$p.Refresh(); $main=$p.MainWindowHandle; Write-Output "main=$main"
$cb = [Win32Enum+EnumWindowsProc]{ param($hwnd,$lparam)
 $cls=New-Object System.Text.StringBuilder 256; [Win32Enum]::GetClassName($hwnd,$cls,256)|Out-Null
 $txt=New-Object System.Text.StringBuilder 256; [Win32Enum]::GetWindowText($hwnd,$txt,256)|Out-Null
 $r=New-Object RECT; [Win32Enum]::GetWindowRect($hwnd,[ref]$r)|Out-Null
 Write-Output ("child=$hwnd class=$($cls.ToString()) text=$($txt.ToString()) rect=$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)")
 return $true
}
[Win32Enum]::EnumChildWindows($main,$cb,[IntPtr]::Zero)|Out-Null
if (!$p.HasExited) { $p.CloseMainWindow()|Out-Null; Start-Sleep -Seconds 1 }
if (!$p.HasExited) { Stop-Process -Id $p.Id -Force }
