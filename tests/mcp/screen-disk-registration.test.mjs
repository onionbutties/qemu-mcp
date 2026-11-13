import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VmSession } from '../../scripts/mcp/session.mjs';
import { registerScreenTools } from '../../scripts/mcp/tools/screen-tools.mjs';
import { registerDiskTools } from '../../scripts/mcp/tools/disk-tools.mjs';

test('screen and disk tools register', () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const session = new VmSession();
  registerScreenTools(server, session);
  registerDiskTools(server, session);
  assert.ok(true);
});
