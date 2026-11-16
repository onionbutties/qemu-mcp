// Single source of truth for the emulated machine's hardware.
import path from 'node:path';

export const DISK = process.env.QEMU_DISK || path.resolve(process.cwd(), 'vm', 'disk.qcow2');
export { MON_PORT } from './qemu.mjs';

/**
 * Build the QEMU argument list.
 *
 * opts:
 *   disk      disk image (default ./vm/disk.qcow2 or $QEMU_DISK)
 *   diskFormat  QEMU disk format (default qcow2)
 *   floppy0   floppy image to insert in A: (install media)
 *   cd        ISO to insert in the CD-ROM drive
 *   shareImg  raw FAT16 image exposed as a second hard disk
 *   stick     raw FAT image presented as a USB mass storage device
 *   usbHid    attach emulated USB keyboard/mouse
 *   tablet    attach a USB tablet for absolute pointer coordinates
 *   boot      'a' | 'c' | 'd'
 *   sound     enable Sound Blaster 16
 *   audioBackend  QEMU audiodev backend (default dsound on Windows, none elsewhere)
 *   memoryMb  guest RAM in MiB (default 32)
 *   noShutdown  keep QEMU alive after a guest power-off (default true)
 *   serial    QEMU -serial spec, or 'none' (default)
 */
export function machineArgs(opts = {}) {
  const {
    disk = DISK,
    diskFormat = 'qcow2',
    floppy0 = null,
    cd = null,
    shareImg = null,
    stick = null,
    usbHid = false,
    tablet = true,
    boot = 'c',
    sound = true,
    audioBackend = process.platform === 'win32' ? 'dsound' : 'none',
    memoryMb = 32,
    noShutdown = true,
    snapshot = false,
    serial = 'none',
  } = opts;

  const ram = Number.isInteger(memoryMb) && memoryMb > 0 ? memoryMb : 32;
  const serialSpec = typeof serial === 'string' && serial ? serial : 'none';

  const args = [
    '-name', 'QEMU guest',
    '-machine', 'pc',
    '-cpu', 'pentium',
    '-m', String(ram),
    '-vga', 'std',
    '-rtc', 'base=localtime',
    '-boot', boot,
    '-drive', `file=${disk},if=ide,index=0,media=disk,format=${diskFormat}`,
    '-nic', 'none',
    '-parallel', 'none',
    '-serial', serialSpec,
    '-device', 'piix3-usb-uhci,id=uhci',
  ];

  if (noShutdown) args.push('-no-shutdown');
  // Writes go to a temporary overlay; the base image is never modified.
  if (snapshot) args.push('-snapshot');
  if (floppy0) args.push('-drive', `file=${floppy0},if=floppy,index=0,format=raw`);
  if (cd) args.push('-drive', `file=${cd},if=ide,index=2,media=cdrom,format=raw`);
  if (shareImg) args.push('-drive', `file=${shareImg},if=ide,index=1,format=raw`);
  if (stick) args.push('-drive', `file=${stick},if=none,id=stick,format=raw`, '-device', 'usb-storage,drive=stick,bus=uhci.0,id=stick0');
  if (usbHid) {
    args.push('-device', 'usb-kbd,bus=uhci.0');
    args.push('-device', 'usb-mouse,bus=uhci.0');
  }
  if (tablet) args.push('-device', 'usb-tablet,bus=uhci.0');
  if (sound && audioBackend !== 'none') {
    args.push('-audiodev', `${audioBackend},id=snd0`, '-device', 'sb16,audiodev=snd0');
  }

  return args;
}
