import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { VmSession } from './session.mjs';
import { registerVmTools } from './tools/vm-tools.mjs';
import { registerMonitorTools } from './tools/monitor-tools.mjs';
import { registerInputTools } from './tools/input-tools.mjs';
import { registerScreenTools } from './tools/screen-tools.mjs';
import { registerDiskTools } from './tools/disk-tools.mjs';
import { registerMacroTools } from './tools/macro-tools.mjs';

const server = new McpServer({ name: 'qemu-mcp', version: '0.2.0' });
const session = new VmSession();

registerVmTools(server, session);
registerMonitorTools(server, session);
registerInputTools(server, session);
registerScreenTools(server, session);
registerDiskTools(server, session);
registerMacroTools(server, session);

const transport = new StdioServerTransport();
await server.connect(transport);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await session.quit(); } catch {}
  process.stderr.write(`qemu-mcp: ${signal}, exiting\n`);
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
