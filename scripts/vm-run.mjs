// Launch the VM and hold it open so vmctl.mjs can drive it.
//   node scripts/vm-run.mjs --boot a --floppy <img> [--cd <iso>] [--share <dir>]
import { launch, P } from './lib/qemu.mjs';
import { machineArgs } from './lib/machine.mjs';
import { buildImage } from '../tools/fatimg.mjs';

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const opts = { boot: flag('boot', 'c'), sound: !flag('nosound', false) };
const floppy = flag('floppy');
if (floppy) opts.floppy0 = floppy;
const cd = flag('cd');
if (cd) opts.cd = cd;
const share = flag('share');
if (share) {
  const img = P('vm', 'share.img');
  buildImage(img, {
    sizeBytes: 64 * 1024 * 1024,
    label: 'SHARE',
    partitioned: true,
    files: [{ dosPath: '', hostPath: typeof share === 'string' ? share : P('share') }],
  });
  opts.shareImg = img;
}
const stick = flag('stick');
if (stick) opts.stick = stick;
const disk = flag('disk');
if (disk) opts.disk = disk;
if (flag('usbhid', false)) opts.usbHid = true;

const vm = await launch(machineArgs(opts), { monitor: false });
console.log('qemu pid', vm.proc.pid);
process.on('SIGINT', () => { vm.proc.kill(); process.exit(0); });
await new Promise((resolve) => vm.proc.on('exit', resolve));
