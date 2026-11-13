# qemu-mcp

A stdio MCP server for driving QEMU through QMP and the human monitor. It is designed for text-first control: screenshots can be rendered as OCR text or ASCII, while raw PNG capture stays available on demand.

## Requirements

- Node.js 20 or newer
- QEMU with `qemu-system-i386` and `qemu-img`
- Windows for the OCR path (`powershell.exe` + Windows OCR)

QEMU defaults to `C:\Program Files\qemu\qemu-system-i386.exe`. Override it with:

```sh
QEMU_BIN=/path/to/qemu-system-i386
QEMU_IMG=/path/to/qemu-img
QEMU_MONITOR_PORT=5555
QEMU_DISK=/path/to/disk.qcow2
```

## Install and run

```sh
npm install
npm run mcp
```

Tests:

```sh
npm test
```

## OpenCode / MCP client configuration

Project config with a relative command and working directory:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "qemu": {
      "type": "local",
      "command": ["node", "scripts/mcp/server.mjs"],
      "cwd": ".",
      "enabled": true
    }
  }
}
```

On OpenCode V2, place the `qemu` entry under `mcp.servers` instead:

```jsonc
{
  "mcp": {
    "servers": {
      "qemu": { "type": "local", "command": ["node", "scripts/mcp/server.mjs"], "cwd": "." }
    }
  }
}
```

The repository's `opencode.json` uses an absolute path so it works from this checkout. Adjust the path if you move the repo.

## Tools

VM:
- `vm_status` — running state, PID, monitor port, disk, last error
- `vm_create_disk` — create a qcow2 image with `qemu-img`
- `vm_launch` — start QEMU; the disk must already exist
- `vm_quit`, `vm_reset`

Input:
- `send_key`, `type_text`, `press`
- `mouse_move`, `mouse_button` (bitmask: 1 left, 2 right, 4 middle)

Monitor:
- `monitor_command` — human monitor command
- `qmp_execute` — QMP command with JSON arguments

Screen:
- `screen_text` — OCR text from the current screen
- `screen_ascii` — ASCII rendering, optional columns/rows/crop
- `screenshot` — PNG image content plus the saved path
- `wait_for_text` — poll until text or regex appears

Disk:
- `fat_list`, `fat_read` (UTF-8 or base64), `fat_build` (FAT16)

Macros:
- `macro_list`, `macro_run` — ESM modules in `scripts/mcp/macros/`

## Example flow

```text
vm_create_disk { path: "vm/disk.qcow2", sizeMb: 512, format: "qcow2" }
vm_launch     { disk: "vm/disk.qcow2", diskFormat: "qcow2", boot: "c" }
wait_for_text { pattern: "C:\\>", timeoutMs: 30000 }
type_text     { text: "dir" }
press         { keys: "ret" }
screen_text
vm_quit
```

## Limits

- OCR needs a Windows host and works best on text-heavy screens.
- The server drives a GUI guest through keyboard and mouse; graphical-only screens still need a vision model or a human.
- One VM session per server process.
- `fat_build` writes FAT16 only; `fat_list` and `fat_read` read FAT12 and FAT16.
