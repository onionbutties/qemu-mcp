// Single source of truth for the emulated machine's hardware.
import { P } from './qemu.mjs';

export const DISK = P('vm', 'wfw.qcow2');
export const SHARE = P('share');
export const MON_PORT = 5555;

/**
 * Build the QEMU argument list.
 *
 * opts:
 *   disk      qcow2 image (default vm/wfw.qcow2)
 *   floppy0   floppy image to insert in A: (install media)
 *   cd        ISO to insert in the CD-ROM drive
 *   shareImg  raw FAT16 image exposed as a second hard disk
 *   stick     raw FAT image presented as a USB mass storage device
 *   usbHid    attach emulated USB keyboard/mouse
 *   boot      'a' | 'c' | 'd'
 *   sound     enable Sound Blaster 16
 */
export function machineArgs(opts = {}) {
  const {
    disk = DISK,
    floppy0 = null,
    cd = null,
    shareImg = null,
    stick = null,
    usbHid = false,
    boot = 'c',
    sound = true,
  } = opts;

  const args = [
    '-name', 'Windows for Workgroups 3.11',
    '-machine', 'pc',
    '-cpu', 'pentium',
    '-m', '32',
    '-vga', 'std',
    '-rtc', 'base=localtime',
    '-boot', boot,
    '-drive', `file=${disk},if=ide,index=0,media=disk,format=qcow2`,
    '-nic', 'none',
    '-parallel', 'none',
    '-serial', 'none',
    '-device', 'piix3-usb-uhci,id=uhci',
  ];

  if (floppy0) args.push('-drive', `file=${floppy0},if=floppy,index=0,format=raw`);
  if (cd) args.push('-drive', `file=${cd},if=ide,index=2,media=cdrom,format=raw`);
  if (shareImg) args.push('-drive', `file=${shareImg},if=ide,index=1,format=raw`);
  if (stick) args.push('-drive', `file=${stick},if=none,id=stick,format=raw`, '-device', 'usb-storage,drive=stick,bus=uhci.0');
  if (usbHid) {
    args.push('-device', 'usb-kbd,bus=uhci.0');
    args.push('-device', 'usb-mouse,bus=uhci.0');
  }
  if (sound) args.push('-audiodev', 'dsound,id=snd0', '-device', 'sb16,audiodev=snd0');

  return args;
}
