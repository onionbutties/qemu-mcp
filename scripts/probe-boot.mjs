// Probe: boot the DOS 6.22 setup disk and verify the emulated machine comes up.
import fs from 'node:fs';
import { launch, P, sleep } from './lib/qemu.mjs';
import { machineArgs } from './lib/machine.mjs';

const disk1 = P('media', 'dos622-disks', 'Microsoft DOS 6.22', 'disk1.img');
if (!fs.existsSync(disk1)) throw new Error('missing ' + disk1);

fs.mkdirSync(P('vm', 'shots'), { recursive: true });

const vm = await launch(machineArgs({ floppy0: disk1, boot: 'a', cd: P('media', 'dos622-cd.iso') }));
try {
  await sleep(6000);
  const shot = await vm.mon.screendump(P('vm', 'shots', '01-dos-boot.png'));
  console.log('screenshot:', shot);
  console.log('--- info block ---');
  console.log(await vm.mon.cmd('info block'));
  console.log('--- info usb ---');
  console.log(await vm.mon.cmd('info usb'));
} finally {
  await vm.stop();
}
console.log('--- qemu log ---');
console.log(vm.log().trim().slice(0, 2000));
