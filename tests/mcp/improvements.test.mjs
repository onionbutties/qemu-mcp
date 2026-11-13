import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { VmSession } from '../../scripts/mcp/session.mjs';
import { waitForText, readScreenAscii } from '../../scripts/mcp/screen.mjs';
import { buildFatImage } from '../../scripts/mcp/disk.mjs';
import { textResult } from '../../scripts/mcp/tools/result.mjs';
import { ocrCommand, ocrProvider, runOcr } from '../../tools/ocr.mjs';

const ppm = path.join(process.cwd(), 'tests', 'fixtures', '02-setup.ppm');

test('textResult returns raw strings without JSON quoting', () => {
  assert.equal(textResult('hello\nworld').content[0].text, 'hello\nworld');
  assert.equal(textResult({ ok: true }).content[0].text, '{"ok":true}');
});

test('tesseract OCR command honors environment overrides', () => {
  const saved = {
    bin: process.env.QEMU_MCP_TESSERACT,
    lang: process.env.QEMU_MCP_OCR_LANG,
    psm: process.env.QEMU_MCP_OCR_PSM,
  };
  try {
    process.env.QEMU_MCP_TESSERACT = '/opt/tesseract';
    process.env.QEMU_MCP_OCR_LANG = 'deu';
    process.env.QEMU_MCP_OCR_PSM = '11';
    assert.deepEqual(ocrCommand('tesseract', 'screen.png'), {
      command: '/opt/tesseract',
      args: ['screen.png', 'stdout', '-l', 'deu', '--psm', '11'],
    });
  } finally {
    for (const [key, value] of Object.entries({
      QEMU_MCP_TESSERACT: saved.bin,
      QEMU_MCP_OCR_LANG: saved.lang,
      QEMU_MCP_OCR_PSM: saved.psm,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tesseract provider invokes the configured binary', async () => {
  const dir = path.join(process.cwd(), 'tests', 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'fake-tesseract.mjs');
  fs.writeFileSync(script, "process.stdout.write('fake-ocr\\n');\n");
  const saved = process.env.QEMU_MCP_TESSERACT;
  try {
    process.env.QEMU_MCP_TESSERACT = process.execPath;
    assert.equal(await runOcr(script, { provider: 'tesseract' }), 'fake-ocr');
  } finally {
    if (saved === undefined) delete process.env.QEMU_MCP_TESSERACT;
    else process.env.QEMU_MCP_TESSERACT = saved;
    fs.rmSync(script, { force: true });
  }
});

test('ocrProvider accepts explicit providers and rejects unknown ones', () => {
  const saved = process.env.QEMU_MCP_OCR;
  try {
    process.env.QEMU_MCP_OCR = 'tesseract';
    assert.equal(ocrProvider(), 'tesseract');
    process.env.QEMU_MCP_OCR = 'windows';
    assert.equal(ocrProvider(), 'windows');
    process.env.QEMU_MCP_OCR = 'nope';
    assert.throws(() => ocrProvider(), /unknown OCR provider/);
  } finally {
    if (saved === undefined) delete process.env.QEMU_MCP_OCR;
    else process.env.QEMU_MCP_OCR = saved;
  }
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
