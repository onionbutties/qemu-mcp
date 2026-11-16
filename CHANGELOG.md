# Changelog

## [0.3.0] - 2026-11-16

### Added

- `screen_text` reads an 80x25 VGA text screen exactly from guest memory, with
  OCR as the graphical fallback.
- `screen_hash` and `wait_for_idle` to detect a guest repaint without OCR.
- `vm_log`, `vm_events`, and `vm_info` for diagnosis and QMP state.
- `vm_pause`, `vm_resume`, `vm_snapshot`, and `vm_media`.
- `serial_read` and `serial_write` for the guest serial console.
- `click_at` through absolute `input-send-event` coordinates.
- `vm_launch` options: `memoryMb`, `serial`, `snapshot`, `display`, `tablet`,
  and `noShutdown`.
- `QEMU_DISPLAY` and `QEMU_MCP_SHOTS` environment variables.
- `fat_build` streams file data and writes images atomically.
- `screen_text` `mode`, `crop`, and `savePng` options.
- `wait_for_text` `crop` and `mode` options.
- Cross-platform install and uninstall scripts for OpenCode, Claude Code,
  Gemini CLI, Codex, and Cursor.
- MCP server `instructions` describing the text-first workflow.
- Windows CI job and a GitLab CI pipeline.

### Changed

- `vm_create_disk` refuses to replace an existing image unless `force: true`.
- FAT16 images now use a legal cluster count; sub-2.2 MiB images are rejected.
- Root directory overflow is reported instead of crashing the server.
- Colliding 8.3 names get a unique `~N` suffix.
- A missing `QEMU_BIN` is a tool error instead of an unhandled crash.
- QMP is decoded as UTF-8.
- `withLock` is reentrant.
- Screenshot captures are deleted after use.
- `mouse_move` stays relative; `click_at` is the absolute path.
- Error results are plain text with `isError: true`.

### Fixed

- Launching with a missing QEMU binary no longer kills the server.
- Relative disk and media paths no longer resolve against two directories.
- A stale monitor can no longer be attached to a new VM.
- Nested locked calls no longer hang.
- `type_text` validates the whole string before sending.
- `fat_build` handles directory cycles and symlinks safely.
- Partition detection no longer misreads a boot sector as an MBR.
- The PPM decoder no longer hangs on a malformed header.
- Screenshots work on Node 20.0-20.14.

### Notes

- `fat_build` writes FAT16 only, between about 2.2 MiB and 512 MiB.
- `screen_text` reads 80x25 colour text mode exactly; other geometries use OCR.
- `vm_snapshot` needs qcow2 on every writable disk.
- `vm_media` handles CD and floppy media only.
- Serial output is buffered from the first `serial_read` connection onward.
- Macro modules are cached for the server's lifetime.
