import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('server starts and responds to initialize', async () => {
  const proc = spawn(process.execPath, ['scripts/mcp/server.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  const req = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } };
  proc.stdin.write(JSON.stringify(req) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  proc.kill();
  assert.match(out, /qemu-mcp/);
});