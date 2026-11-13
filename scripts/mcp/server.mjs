#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { VmSession } from './session.mjs';
import { registerVmTools } from './tools/vm-tools.mjs';
import { registerMonitorTools } from './tools/monitor-tools.mjs';
import { registerInputTools } from './tools/input-tools.mjs';
import { registerScreenTools } from './tools/screen-tools.mjs';
import { registerDiskTools } from './tools/disk-tools.mjs';
import { registerMacroTools } from './tools/macro-tools.mjs';

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${pkg.name} ${pkg.version}\n`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`qemu-mcp ${pkg.version}

Usage: qemu-mcp [--help] [--version]

Runs a stdio MCP server for QEMU. Configure it in your MCP client; it does
not print anything else to stdout.

Environment:
  QEMU_BIN            qemu-system binary
  QEMU_IMG            qemu-img binary
  QEMU_DISK           default disk image (./vm/disk.qcow2)
  QEMU_MONITOR_PORT   QMP monitor port (5555)
  QEMU_MCP_MACROS     macro directory override
`);
  process.exit(0);
}

const server = new McpServer({ name: 'qemu-mcp', version: pkg.version });
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
