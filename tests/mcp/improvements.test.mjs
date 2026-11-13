import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { VmSession } from '../../scripts/mcp/session.mjs';
import { waitForText, readScreenAscii } from '../../scripts/mcp/screen.mjs';
import { buildFatImage } from '../../scripts/mcp/disk.mjs';
import { textResult } from '../../scripts/mcp/tools/result.mjs';

const ppm = path.join(process.cwd(), 'vm', 'shots', '02-setup.ppm');

test('textResult returns raw strings without JSON quoting', () => {
  assert.equal(textResult('hello\nworld').content[0].text, 'hello\nworld');
  assert.equal(textResult({ ok: true }).content[0].text, '{"ok":true}');
});

test('vm_launch rejects a missing disk before spawning QEMU', async () => {
  const session = new VmSession({ launcher: async () => { throw new Error('must not launch'); } });
  await assert.rejects(
    () => session.launch({ disk: path.join(process.cwd(), 'vm', 'missing.qcow2') }),
    /disk not found/,
  );
});

test('wait_for_text validates regex before capturing', async () => {
  await assert.rejects(
    () => waitForText({}, { pattern: '[', regex: true }),
    /Invalid regular expression/,
  );
});

test('screen_ascii tolerates cols=0', () => {
  const ascii = readScreenAscii(ppm, { cols: 0 });
  assert.ok(ascii.length > 0);
});

test('fat_build rejects tiny images', () => {
  assert.throws(
    () => buildFatImage(path.join(process.cwd(), 'vm', 'test', 'tiny.img'), { sizeBytes: 100, files: [] }),
    /sizeBytes/,
  );
});

test('server exposes the expected tool set', async () => {
  const client = new Client({ name: 'test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['scripts/mcp/server.mjs'],
    cwd: process.cwd(),
  });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      'vm_status', 'vm_launch', 'vm_create_disk', 'vm_quit', 'vm_reset',
      'send_key', 'type_text', 'press', 'mouse_move', 'mouse_button',
      'monitor_command', 'qmp_execute',
      'screenshot', 'screen_text', 'screen_ascii', 'wait_for_text',
      'fat_list', 'fat_read', 'fat_build',
      'macro_list', 'macro_run',
    ]) {
      assert.ok(names.includes(name), `missing tool ${name}`);
    }
  } finally {
    await client.close();
  }
});
