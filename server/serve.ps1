# ============================================================
# LifeLink - optional local web server (no installation needed)
# Usage: double-click ..\start-server.bat  (or run this script)
# Serves the site at  http://127.0.0.1:8931/
# ============================================================

$root   = Split-Path -Parent $PSScriptRoot   # project folder (parent of /server)
$rootFull = (Resolve-Path $root).Path.TrimEnd('\') + '\'
$prefix = "http://127.0.0.1:8931/"

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
  ".sql"  = "text/plain; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
  Write-Host "Could not start server on $prefix : $($_.Exception.Message)" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "LifeLink running at  $prefix  (Ctrl+C to stop)" -ForegroundColor Green

while ($listener.IsListening) {
  $ctx  = $listener.GetContext()
  $path = $ctx.Request.Url.AbsolutePath
  if ($path -eq "/") { $path = "/index.html" }

  $file = Join-Path $root ($path -replace "/", "\")
  try {
    $allowed = $false
    if (Test-Path $file -PathType Leaf) {
      $real = (Resolve-Path $file).Path
      $allowed = $real.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
    }
    if ($allowed) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ct  = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentType = $ct
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - not found")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch { }
  finally { try { $ctx.Response.OutputStream.Close() } catch { } }
}
