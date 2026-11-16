// Injected into the MCP client's system prompt at initialize time.
export const INSTRUCTIONS = `qemu-mcp drives one QEMU virtual machine over QMP.

Read the guest, do not guess:
1. Call vm_status first. Create a disk with vm_create_disk and start it with
   vm_launch only when no VM is running.
2. Call screen_text before anything visual. On a BIOS or DOS 80x25 text screen
   it reads VGA memory directly and returns exact characters; otherwise it
   falls back to OCR.
3. To wait for a prompt or the end of boot, call wait_for_text with a short
   pattern such as "C:\\>" or "login:". Prefer it over sleeping.
4. Type with type_text, send named keys with press (ret, esc, ctrl-alt-del),
   and use send_key for a raw QEMU key sequence.
5. After an action that should repaint the screen, call wait_for_idle or
   screen_hash. Do not assume the guest reacted.
6. screen_ascii is a luminance fallback for graphics. It is poor at reading
   text. If both screen_text and screen_ascii return useless output, call
   screenshot and give the PNG to a vision model or a human.
7. When the VM misbehaves, call vm_log for QEMU output and vm_events for
   SHUTDOWN, RESET, GUEST_PANICKED, or BLOCK_IO_ERROR before retrying.
8. Use vm_info for QMP state and block devices. Use monitor_command or
   qmp_execute only when a typed tool does not cover the operation.
9. Call vm_quit when finished. A guest power-off is not a server shutdown.

Safety: vm_create_disk refuses to replace a disk without force. vm_media
changes or ejects install media. Keep monitor and QMP commands away from the
boot disk unless you intend to modify it.`;
