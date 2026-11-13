import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VmSession } from '../../scripts/mcp/session.mjs';
import { registerVmTools } from '../../scripts/mcp/tools/vm-tools.mjs';

test('VM tools register on an MCP server', () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const session = new VmSession();
  registerVmTools(server, session);
  assert.ok(true);
});
