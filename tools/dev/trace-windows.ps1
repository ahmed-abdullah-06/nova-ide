<#
.SYNOPSIS
Diagnostic-only Windows launcher/window tracer for `npm run dev`.

.DESCRIPTION
Runs for a fixed time while `npm run dev` is started from another terminal.
Every 50 ms it records:
  - every process not seen before (time, name, pid, ppid, full command line,
    parent chain),
  - every visible top-level window from EnumWindows and from
    Get-Process.MainWindowHandle (time, source, hwnd, class, title, owner pid,
    parent chain), including new, changed and disappeared windows.

The first poll also records the processes/windows that already existed, so a
later report can separate pre-existing windows from ones created by the dev
start.

.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\dev\trace-windows.ps1 `
  -OutputFile "$env:TEMP\nova-dev-window-trace.txt"
#>
param(
  [string]$OutputFile = (Join-Path $env:TEMP 'nova-dev-window-trace.txt'),
  [int]$DurationSeconds = 90,
  [int]$IntervalMs = 50
)

if ($IsLinux -or $IsMacOS) {
  throw 'This diagnostic is Windows-only (EnumWindows / ConsoleWindowClass).'
}

$ErrorActionPreference = 'Stop'

if (-not ('NativeWindowTrace' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class NativeWindowTrace
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
}

$directory = Split-Path -Parent $OutputFile
if ($directory -and -not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$writer = New-Object System.IO.StreamWriter(
  $OutputFile, $false, (New-Object System.Text.UTF8Encoding($false)))
$writer.AutoFlush = $true

function Write-Line([string]$line) {
  $writer.WriteLine($line)
}

function Get-Stamp() {
  return (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')
}

function Get-ProcessInfo([uint32]$processId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return $null
  }
  return [pscustomobject]@{
    Name         = [string]$process.Name
    ProcessId    = [uint32]$process.ProcessId
    ParentId     = [uint32]$process.ParentProcessId
    CommandLine  = [string]$process.CommandLine
    CreationDate = [DateTime]$process.CreationDate
  }
}

function Get-ParentChain([uint32]$processId, $processMap) {
  $chain = New-Object System.Collections.Generic.List[string]
  $seen = New-Object 'System.Collections.Generic.HashSet[uint32]'
  $current = $processId
  $terminalNames = @(
    'WindowsTerminal.exe', 'conhost.exe', 'cmd.exe', 'powershell.exe',
    'pwsh.exe', 'opencode.exe', 'Code.exe'
  )

  for ($depth = 0; $depth -lt 40; $depth++) {
    if (-not $processMap.ContainsKey($current)) {
      $fetched = Get-ProcessInfo $current
      if ($null -eq $fetched) {
        $chain.Add("unknown($current)")
        break
      }
      $processMap[$current] = $fetched
    }
    $info = $processMap[$current]
    $marker = if ($terminalNames -contains $info.Name) { ' [terminal]' } else { '' }
    $chain.Add(('{0}({1}) ppid={2}{3}' -f $info.Name, $info.ProcessId, $info.ParentId, $marker))
    if (-not $seen.Add($info.ProcessId)) {
      break
    }
    if ($info.ParentId -eq 0 -or $info.ParentId -eq $info.ProcessId) {
      break
    }
    $current = [uint32]$info.ParentId
  }
  return ($chain -join ' <- ')
}

function Get-VisibleWindows() {
  $windows = New-Object System.Collections.Generic.List[object]
  $seenHandles = New-Object 'System.Collections.Generic.HashSet[IntPtr]'

  $callback = [NativeWindowTrace+EnumWindowsProc] {
    param($windowHandle, $unused)

    if (-not [NativeWindowTrace]::IsWindowVisible($windowHandle)) {
      return $true
    }

    $owner = [uint32]0
    [void][NativeWindowTrace]::GetWindowThreadProcessId($windowHandle, [ref]$owner)

    $length = [NativeWindowTrace]::GetWindowTextLength($windowHandle)
    $titleBuilder = New-Object System.Text.StringBuilder ($length + 1)
    [void][NativeWindowTrace]::GetWindowText($windowHandle, $titleBuilder, $titleBuilder.Capacity)

    $classBuilder = New-Object System.Text.StringBuilder 256
    [void][NativeWindowTrace]::GetClassName($windowHandle, $classBuilder, $classBuilder.Capacity)

    $windows.Add([pscustomobject]@{
      Source  = 'EnumWindows'
      Handle  = [IntPtr]$windowHandle
      Class   = $classBuilder.ToString()
      Title   = $titleBuilder.ToString()
      Pid     = $owner
    })
    [void]$seenHandles.Add($windowHandle)
    return $true
  }

  [void][NativeWindowTrace]::EnumWindows($callback, [IntPtr]::Zero)

  foreach ($process in (Get-Process -ErrorAction SilentlyContinue)) {
    $handle = $process.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero -or $seenHandles.Contains($handle)) {
      continue
    }
    if (-not [NativeWindowTrace]::IsWindowVisible($handle)) {
      continue
    }

    $classBuilder = New-Object System.Text.StringBuilder 256
    [void][NativeWindowTrace]::GetClassName($handle, $classBuilder, $classBuilder.Capacity)
    $windows.Add([pscustomobject]@{
      Source  = 'MainWindowHandle'
      Handle  = [IntPtr]$handle
      Class   = $classBuilder.ToString()
      Title   = [string]$process.MainWindowTitle
      Pid     = [uint32]$process.Id
    })
  }

  return $windows
}

function Format-CommandLine([string]$commandLine) {
  if ($null -eq $commandLine) {
    return '<null>'
  }
  return ($commandLine -replace '\r?\n', ' ')
}

function Write-ProcessEvent([string]$event, $info, $processMap) {
  $chain = Get-ParentChain ([uint32]$info.ProcessId) $processMap
  Write-Line (('{0} PROCESS {1} name={2} pid={3} ppid={4} created={5} chain={6} command={7}' -f
    (Get-Stamp), $event, $info.Name, $info.ProcessId, $info.ParentId,
    $info.CreationDate.ToString('o'), $chain, (Format-CommandLine $info.CommandLine)))
}

function Write-WindowEvent([string]$event, $window, $processMap) {
  $chain = if ($window.Pid -gt 0) {
    Get-ParentChain ([uint32]$window.Pid) $processMap
  } else {
    '<none>'
  }
  Write-Line (('{0} WINDOW {1} source={2} hwnd=0x{3} class={4} title="{5}" pid={6} chain={7}' -f
    (Get-Stamp), $event, $window.Source, $window.Handle.ToInt64().ToString('X'),
    $window.Class, $window.Title, $window.Pid, $chain))
}

function Get-WindowKey($window) {
  return ('{0}|0x{1}|{2}|{3}|{4}' -f
    $window.Source, $window.Handle.ToInt64().ToString('X'),
    $window.Class, $window.Title, $window.Pid)
}

Write-Line '=== nova dev Windows process/window trace ==='
Write-Line ('started=' + (Get-Date).ToString('o'))
Write-Line ('script=' + $MyInvocation.MyCommand.Path)
Write-Line ('output=' + $OutputFile)
Write-Line ('duration_seconds=' + $DurationSeconds)
Write-Line ('poll_interval_ms=' + $IntervalMs)
Write-Line ('user_interactive=' + [Environment]::UserInteractive)
Write-Line ('session_id=' + (Get-Process -Id $PID).SessionId)
Write-Line ('explorer_processes=' + @(Get-Process -Name explorer -ErrorAction SilentlyContinue).Count)
Write-Line 'dedup=existing pids are baselined without command lines; NEW processes are logged once with full command lines; windows are logged on first sight, title/class change, and disappearance'
Write-Line '=== baseline: existing processes and windows ==='

$knownProcesses = New-Object 'System.Collections.Generic.HashSet[uint32]'
$knownWindows = @{}
$processMap = @{}

foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
  [void]$knownProcesses.Add([uint32]$process.Id)
}
Write-Line ('initial_process_count=' + $knownProcesses.Count)

$initialWindows = Get-VisibleWindows
foreach ($window in $initialWindows) {
  $key = Get-WindowKey $window
  $knownWindows[$key] = $true
  Write-WindowEvent 'INITIAL' $window $processMap
}
Write-Line ('initial_visible_window_count=' + @($initialWindows).Count)

Write-Line 'READY: start `npm run dev` in another terminal now'
$end = (Get-Date).AddSeconds($DurationSeconds)

while ((Get-Date) -lt $end) {
  $pollStart = Get-Date

  foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
    $processId = [uint32]$process.Id
    if ($knownProcesses.Contains($processId)) {
      continue
    }
    $info = Get-ProcessInfo $processId
    if ($null -eq $info) {
      continue
    }
    [void]$knownProcesses.Add($processId)
    $processMap[$processId] = $info
    Write-ProcessEvent 'NEW' $info $processMap
  }

  $currentWindows = Get-VisibleWindows
  $currentKeys = @{}
  foreach ($window in $currentWindows) {
    $key = Get-WindowKey $window
    $currentKeys[$key] = $true
    if (-not $knownWindows.ContainsKey($key)) {
      Write-WindowEvent 'NEW' $window $processMap
    }
    $knownWindows[$key] = $true
  }
  foreach ($key in @($knownWindows.Keys)) {
    if (-not $currentKeys.ContainsKey($key)) {
      # The key itself contains all identifying fields; reconstruct a minimal
      # record for the disappearance line.
      $parts = $key -split '\|', 5
      Write-Line (('{0} WINDOW GONE source={1} hwnd={2} class={3} title="{4}" pid={5}' -f
        (Get-Stamp), $parts[0], $parts[1], $parts[2], $parts[3], $parts[4]))
      $knownWindows.Remove($key) | Out-Null
    }
  }

  $elapsed = [int](((Get-Date) - $pollStart).TotalMilliseconds)
  $sleep = $IntervalMs - $elapsed
  if ($sleep -gt 0) {
    Start-Sleep -Milliseconds $sleep
  }
}

Write-Line ('=== finished=' + (Get-Date).ToString('o') + ' ===')
Write-Line ('new_processes=' + @($knownProcesses).Count)
Write-Line ('visible_window_keys_seen=' + $knownWindows.Count)
$writer.Dispose()
