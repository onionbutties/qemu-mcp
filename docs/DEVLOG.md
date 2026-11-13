# Diary

Chronological record of what was done for this request, with results.

## 2026-11-12

**Recon**
- Inventoried the empty target folder and the host: QEMU 10.0 (`C:\Program Files\qemu`),
  VirtualBox 7.2.20, no 86Box.
- Located all install media in `D:\vms\install files`: MS-DOS 6.22 (3 floppies + ISO),
  Windows for Workgroups 3.11 (8 floppies), Sound Blaster 16 driver disks, the
  `win31_vbox_vesa_vbesvga` display driver, a CD-ROM driver floppy (Acer VIDE-CD),
  CuteMouse, DOS 6.22 supplemental disk.
- Confirmed `SETUP.SHH` in the WFW media is a usable batch answer file, so the install can run
  as `SETUP /N /H:` from a flat directory instead of eight floppy swaps.
- Decided on QEMU over VirtualBox: QEMU can present a USB stick and a file-exchange disk as
  plain image files, so the machine stays self-contained in this folder.

**Harness**
- Extracted all media into `media/`, with floppy images renamed to space-free names
  (`media/floppy/dos622-1.img`, `wfw-1.img`..`wfw-8.img`, `sb16-1.img`, `cdrom-drv.img`).
- Wrote `scripts/lib/qemu.mjs` (QEMU launcher + QMP client), `scripts/lib/machine.mjs`
  (hardware definition), `scripts/vm-run.mjs` (runs a VM for driving), `scripts/vmctl.mjs`
  (one-shot `shot`/`key`/`type`/`cmd`/`change`/`quit`).
- First attempts used the human monitor; it echoes commands with terminal control codes and
  only accepts one connection, so switched to QMP (`qmp_capabilities` + `human-monitor-command`).
- QEMU's `screendump` writes PPM in this build, not PNG.
- Added `tools/imgpeek.mjs` (PPM/PNG to ASCII), `tools/ppm2png.mjs`, and `tools/ocr.ps1`
  (Windows OCR) so guest screens can be read instead of guessed at.

**Disk layout**
- Started with a 1 GB image; per request, recreated as 4 GB with two FAT16 volumes.
  FAT16 tops out at 2047 MB per volume under DOS 6.22, which is why it is two 2000 MB volumes.
- `FDISK` created C: (2000 MB primary, active) and an extended partition holding D: (2000 MB).
  FDISK auto-assigned the 87 MB remainder as E:, which DOS Setup formatted.
- Learned FDISK is line-buffered: the digit needs Enter after it, which cost two false starts.
- Formatted C: 2000 MB (`/s`, system transferred) and D: 2000 MB.

**DOS 6.22**
- Installed from the three retail floppies, swapping `floppy0` via QMP at each prompt.
- Result: C: boots MS-DOS 6.22, 2,088,534,716 bytes free.

## 2026-11-13

**File exchange, first attempt (failed)**
- Tried QEMU's `vvfat` (`-drive file=fat:rw:share`) as a live host folder. DOS 6.22 saw the
  drive letter but reported an empty root and no free space, so it is unusable here.

**FAT image tool**
- Wrote `tools/fatimg.mjs`: builds FAT12/FAT16 images (optional MBR partition table, 8.3 names,
  subdirectories) and lists them back. Needed because 7-Zip cannot write FAT images, and the
  USB stick has to be a real FAT16 volume.
- First build was rejected by 7-Zip: `BPB_SecPerClus` was written at offset 12 instead of 13,
  overwriting the high byte of `BPB_BytsPerSec` (512 became 1024). Fixed; 7-Zip now reads the
  image and shows the file.
- Second bug: the FAT/root/data offsets ignored the MBR partition offset, so a "partitioned"
  image was written 1 MB early and DOS saw an empty volume. Fixed by carrying the partition
  offset into the layout.
- Added `scripts/build-share.mjs`, which rebuilds `vm/share.img` (64 MB FAT16, MBR, label SHARE)
  from `share/` on every launch. DOS reads it as D: (primaries across disks get letters before
  logical drives), which is why `dir f:` looked empty for a while.

**WFW 3.11 install**
- `SETUP /N /H:ANSWER.SHH` from a flat copy of the 8 disks did not work: Setup still demanded
  "Disk 2" and never advanced. Pressing Enter on that dialog does nothing because the key press
  was too short for Setup's keyboard polling.
- Built an administrative install point with `SETUP /A` into `C:\WFWADM` (that part worked), but
  `/N` from it showed the same disk-2 prompt.
- Root cause of the stuck dialog: short `sendkey` taps are missed by Setup. A 500 ms hold
  (`sendkey ret 500`) advances it. This matters for every WFW Setup dialog.
- Installed with plain Express Setup from the eight floppy images instead: Enter, name
  "Workstation", printer "No Printer Attached", network "No Network Installed", accepted the
  application-name prompts, swapped `floppy0` for disks 3-6 at each "insert disk" prompt.
- Setup completed and started Windows for Workgroups 3.11 (the tutorial opened automatically).
  Guest disk is 97.6 MB written of 4 GB.
- Machine was then powered off rather than left running; the guest is at first-boot Windows.

**Post-install boot diagnosis**
- Booting the hard disk appeared to stall after "HIMEM is testing extended memory... done", at
  720x400 text mode, with a blank screen. Booting the DOS floppy and copying the two startup
  files out to a floppy image proved it:
  - `CONFIG.SYS` = SETVER, `C:\WINDOWS\HIMEM.SYS`, `DOS=HIGH`, `FILES=30`,
    `C:\WINDOWS\IFSHLP.SYS`, `STACKS=9,256`.
  - `AUTOEXEC.BAT` = SMARTDRV, PROMPT, PATH, TEMP. **No `WIN` line.**
- So the machine is not hung: it reaches the DOS prompt, but the screen stops repainting after
  HIMEM (a QEMU/VGA text-mode redraw quirk seen repeatedly). Windows never starts because
  nothing launches it.
- Next action: append `WIN` to AUTOEXEC.BAT (or launch `C:\WINDOWS\WIN.COM` manually), then
  re-test the boot. Also worth trying `-vga cirrus` later if the invisible-text quirk persists,
  though the VBE driver should replace text modes anyway.

**Fix and first successful boot**
- Appended `win` to `C:\AUTOEXEC.BAT` from the guest (`echo win >> c:\autoexec.bat`), reset.
- Machine now boots straight into Program Manager at 640x480 (standard VGA driver), 16 colours.
- Saved qcow2 internal snapshot `wfw-installed` as the rollback point.

## Pause schedule

Working only during DeepSeek off-peak (16:30-00:30 UTC). Pause at 01:00 UTC, resume at 16:30 UTC.
