# Design: Windows for Workgroups 3.11 workstation VM

Status: in progress. Host: Windows, QEMU 10.0, no admin rights assumed.

## Intent

A WFW 3.11 machine that lives entirely in this folder and works like a period
workstation: start it, use the CD-ROM, move files on and off a USB stick, use a USB
mouse and keyboard, hear Sound Blaster audio, and run the desktop at a high resolution
with true colour.

WFW 3.11 predates USB by three years. "USB support" therefore means a DOS-level USB stack
underneath Windows, not a Windows driver. That shapes most of the decisions below.

## Goals

- Self-contained: disk image, USB stick image, exchange image and media all inside the folder.
- Startable with one command, no admin rights, no host device passthrough required.
- CD-ROM reads ISO images; images can be swapped while the machine runs.
- USB mass storage appears as a DOS drive letter and is reachable from File Manager.
- USB mouse and keyboard work in DOS and in Windows.
- Sound Blaster 16 audio works for DOS and Windows programs.
- Display runs at 1280x1024 in true colour, with 1024x768 and 1600x1200 available.
- Every claim above verified from inside the guest, not assumed.

## Non-goals

- Networking. The machine boots with no NIC; a PCnet card and TCP/IP-32 can be added later
  (media already present).
- Windows 3.11-era software beyond what ships with the OS.
- Host USB passthrough. Virtual USB devices only.
- Any Windows version other than WFW 3.11.

## Approaches considered

1. **VirtualBox with the existing VBE driver.** Would work for video and sound, but virtual
   USB storage cannot be created from a file: VBox only passes host devices through, and
   `USBASPI.SYS` is reported to fail on VBox 7. Ruled out by the USB requirement.
2. **86Box.** Most authentic, real S3/SB16 emulation and genuine drivers, but needs
   copyrighted BIOS ROMs and a large setup with no scriptable install path. Ruled out on
   effort and reproducibility.
3. **QEMU (chosen).** `usb-storage` presents a raw FAT16 image as a USB stick, UHCI matches
   the DOS USB drivers, `sb16` gives ISA Sound Blaster 16, and `-vga std` provides VBE 2.0 for
   a true-colour SVGA driver. Everything is a file, everything is scriptable.

## Design

### Hardware

| Component | Configuration |
|-----------|---------------|
| Machine | `pc` (i440FX + PIIX3), Pentium, 32 MB RAM |
| Disk | 4 GB qcow2: C: 2000 MB FAT16 primary, D: 2000 MB FAT16 logical, E: 87 MB leftover |
| Exchange disk | 64 MB FAT16 image rebuilt from `share/` at launch, seen as D: (letters shift) |
| CD-ROM | IDE secondary master, ISO images |
| Sound | `sb16`, 0x220, IRQ 5, DMA 1/5, host backend `dsound` |
| Video | `-vga std` (Bochs VBE 2.0), 16 MB |
| USB | PIIX3 UHCI: one mass-storage device (stick image), plus keyboard and mouse |
| Input | PS/2 mouse via CuteMouse as the baseline, independent of USB |

### Software stack in the guest

- MS-DOS 6.22 with HIMEM, EMM386, SMARTDRV.
- WFW 3.11 in `C:\WINDOWS`, installed from the retail floppies.
- CD-ROM: Acer VIDE-CD (`CDROM.SYS`) plus MSCDEX.
- Display: `VBESVGA.DRV`, `VDDVBE.386`, `VBEVMDIB.3GR` in `C:\WINDOWS\SYSTEM`,
  `display.drv=` in `[boot]` plus a `[VBESVGA.DRV]` section in SYSTEM.INI.
- Sound: Creative Sound Blaster 16 Windows 3.1 driver from the driver disks, `BLASTER`
  environment set for DOS programs.
- USB: Bret E. Johnson's DOS drivers (`USBUHCI.SYS`, `USBHUB.SYS`, `USBDRIVE.SYS`,
  `USBMOUSE.SYS`, `USBKEYB.SYS`) with Panasonic `USBASPI.SYS` + `DI1000DD.SYS` as the
  fallback for storage only.

### File exchange

- **USB stick** (`vm/usb-stick.img`, FAT16): the read/write medium. Rebuilt from `usb/` on
  the host, extracted back out with the same tool. DOS 6.22 cannot read FAT32, and FAT16
  caps at 2047 MB, so the stick stays at or below 2 GB.
- **Exchange disk** (`vm/share.img`): 64 MB FAT16 built from `share/` on every launch.
  Convenient for dropping installers in, not for keeping files the guest writes.
- **CD-ROM**: data ISOs, read-only, swappable at runtime.

### Tooling written for this

- `scripts/lib/qemu.mjs` — QEMU launcher plus QMP client (clean command output).
- `scripts/lib/machine.mjs` — the single definition of the emulated hardware.
- `scripts/vm-run.mjs`, `scripts/vmctl.mjs` — run a VM and drive it (`shot`, `key`, `type`,
  `cmd`, `change`, `quit`).
- `tools/fatimg.mjs` — build and list FAT12/FAT16 images (7-Zip cannot write FAT images).
- `tools/imgpeek.mjs`, `tools/ppm2png.mjs`, `tools/ocr.ps1` — read guest screens without a
  display: QEMU writes PPM, PNG goes through Windows OCR.

## Constraints discovered

- FDISK prompts are line-buffered: the digit needs Enter after it.
- WFW Setup polls the keyboard slowly; key presses must be held ~500 ms or they are missed.
- FDISK only allows one primary DOS partition; the second volume must be a logical drive.
- DOS assigns letters to primaries on all disks before logical drives; the exchange disk
  taking D: is expected behaviour, not a bug.
- QEMU's `vvfat` (`-drive file=fat:rw:dir`) does not present a readable volume to MS-DOS 6.22.
- QEMU's `screendump` writes PPM in this build; PNG is not available.

## Open items

- Video, sound, CD-ROM and USB drivers are not installed yet.
- Launch command for normal use, README, and a snapshot of the working install.
