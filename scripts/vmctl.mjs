// One-shot controller for a running QEMU instance.
//   node scripts/vmctl.mjs shot <file>        screenshot (PPM)
//   node scripts/vmctl.mjs key  <keys>        sendkey sequence, e.g. "ret" or "ctrl-alt-del"
//   node scripts/vmctl.mjs type <text>        type ASCII text
//   node scripts/vmctl.mjs cmd  <command>     raw human-monitor command
//   node scripts/vmctl.mjs change <dev> <file>
//   node scripts/vmctl.mjs quit
import { Monitor, P } from './lib/qemu.mjs';

const [action, ...rest] = process.argv.slice(2);
const mon = await Monitor.connect();
try {
  switch (action) {
    case 'shot': {
      const file = rest[0] ?? 'vm/shots/shot.ppm';
      const abs = file.match(/^[A-Za-z]:/) ? file : P(file);
      console.log(await mon.screendump(abs));
      break;
    }
    case 'key':
      await mon.sendKey(rest.join(' '));
      console.log('ok');
      break;
    case 'type':
      await mon.type(rest.join(' '));
      console.log('ok');
      break;
    case 'cmd':
      console.log(await mon.cmd(rest.join(' ')));
      break;
    case 'change':
      console.log(await mon.change(rest[0], rest[1]));
      break;
    case 'quit':
      await mon.quit();
      console.log('ok');
      break;
    default:
      console.error('unknown action ' + action);
      process.exitCode = 2;
  }
} finally {
  mon.close();
}
