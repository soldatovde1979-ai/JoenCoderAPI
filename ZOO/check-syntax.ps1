$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile('c:\projects\copypast\FileTransfer.ps1', [ref]$null, [ref]$errs)
if ($errs) {
    $errs | ForEach-Object { "{0}: {1}" -f $_.Extent.StartLineNumber, $_.Message }
    exit 1
} else {
    'SYNTAX OK'
}
