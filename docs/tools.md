# Tool reference

One VM per server process. Every tool returns text; failures set
`isError: true` and keep the message readable.

## VM lifecycle

| Tool | What it does |
| --- | --- |
| `vm_status` | Running state, PID, monitor port, disk, last error. |
| `vm_create_disk` | Create a disk with `qemu-img` (`qcow2`, `raw`, `vmdk`, `vdi`, `vpc`). Refuses to replace an existing file unless `force: true`. |
| `vm_launch` | Start QEMU. Options: `disk`, `diskFormat`, `floppy0`, `cd`, `shareImg`, `stick`, `boot`, `sound`, `memoryMb`, `serial`, `snapshot`, `display`, `tablet`, `monitorPort`. |
| `vm_quit` | Stop QEMU. |
| `vm_reset` | Reset the guest. |
| `vm_pause` / `vm_resume` | Pause and resume with QMP `stop` / `cont`. |
| `vm_snapshot` | `list`, `save`, `load`, or `delete` an internal qcow2 snapshot. A writable raw disk blocks `savevm`, and the error is returned. |
| `vm_media` | Insert or eject a `cdrom` or `floppy` image. |
| `vm_info` | QMP status, version, and inserted block devices. |
| `vm_log` | Last lines of QEMU stdout/stderr. |
| `vm_events` | Recent QMP events: `SHUTDOWN`, `RESET`, `STOP`, `GUEST_PANICKED`, and others. |

`vm_launch { snapshot: true }` writes to a temporary overlay, so the base disk
is never modified. The USB tablet is attached by default; pass `tablet: false`
for guests that object to it.

## Screen

| Tool | What it does |
| --- | --- |
| `screen_text` | Guest text. Reads VGA memory exactly on an 80x25 text screen; falls back to OCR. Options: `mode` (`auto`, `vga`, `ocr`), `crop`, `savePng`. |
| `wait_for_text` | Poll until a string or regex appears. Prefer it over sleeping. |
| `screen_hash` | Hash of the current frame. Call twice to detect a repaint. |
| `wait_for_idle` | Wait until the frame stops changing (`stableMs`, `timeoutMs`). |
| `screen_ascii` | Luminance rendering for graphics; not a text reader. |
| `screenshot` | PNG as MCP image content plus its saved path. |

A `crop` uses OCR; `mode: "vga"` with a crop is rejected because VGA text is
read as a character grid. `savePng: true` keeps a screenshot next to the text
for a vision model. Screenshots are written to `QEMU_MCP_SHOTS` (default
`./vm/shots/mcp`).

## Input

| Tool | What it does |
| --- | --- |
| `type_text` | Type ASCII text. Validates the whole string before sending, so a bad character does not leave half a command. |
| `press` | Named key sequence (`ret`, `esc`, `ctrl-alt-del`) with an optional hold time. |
| `send_key` | Raw QEMU key sequence. |
| `click_at` | Absolute click; needs the USB tablet and a guest driver. |
| `mouse_move` / `mouse_button` | Relative pointer and raw button state. |

## Serial

| Tool | What it does |
| --- | --- |
| `serial_read` / `serial_write` | Guest serial console when launched with `serial: true`. Output is buffered from the first `serial_read` onward. |

## Disk images

| Tool | What it does |
| --- | --- |
| `fat_build` | Build a FAT16 image from host files. 2.2 MiB to 512 MiB; rejects symlinks and directory cycles. |
| `fat_list` | List a FAT12/FAT16 image. |
| `fat_read` | Read a file; use `encoding: "base64"` for binary payloads. |

## Raw and macros

| Tool | What it does |
| --- | --- |
| `monitor_command` | Human monitor command. |
| `qmp_execute` | QMP command with JSON arguments. |
| `macro_list` / `macro_run` | Named host-side routines from the macro directory. |
