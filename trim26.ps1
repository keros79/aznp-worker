$path = 'C:\Users\kerbe\Projects\aznp-worker\_integration.test.mjs'
$bytes = [IO.File]::ReadAllBytes($path)
$markerStr = '// ============ TASK 2.6'
$marker = [Text.Encoding]::ASCII.GetBytes($markerStr)
$idx = -1
for ($i=0; $i -le $bytes.Length - $marker.Length; $i++) {
  $match = $true
  for ($j=0; $j -lt $marker.Length; $j++) {
    if ($bytes[$i+$j] -ne $marker[$j]) { $match = $false; break }
  }
  if ($match) { $idx = $i; break }
}
if ($idx -lt 0) { Write-Output 'MARKER_NOT_FOUND'; exit 1 }
$headLen = $idx
$head = New-Object byte[] $headLen
[Array]::Copy($bytes, 0, $head, 0, $headLen)
[IO.File]::WriteAllBytes($path, $head)
Write-Output ("TRIMMED_BYTES=" + $headLen)
