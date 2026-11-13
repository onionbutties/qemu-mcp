import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { VmSession } from '../../scripts/mcp/session.mjs';

test('VmSession reports not running initially', () => {
  const s = new VmSession();
  assert.equal(s.status().running, false);
});

test('VmSession serializes monitor access', async () => {
  const order = [];
  const fakeMon = { cmd: async (c) => { order.push('start-' + c); await new Promise((r) => setTimeout(r, 10)); order.push('end-' + c); return c; } };
  const s = new VmSession({ monitorFactory: async () => fakeMon, launcher: async () => ({ proc: { pid: 1, killed: false, exitCode: null }, mon: fakeMon }) });
  await s.launch({ disk: path.join(process.cwd(), 'vm', 'shots', '02-setup.ppm') });
  const [a, b] = await Promise.all([s.command('a'), s.command('b')]);
  assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b']);
  assert.deepEqual([a, b], ['a', 'b']);
});
