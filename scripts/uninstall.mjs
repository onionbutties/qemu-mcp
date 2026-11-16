import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const home = process.env.HOME || process.env.USERPROFILE || '';

function removeJson(file, mutate) {
  if (!fs.existsSync(file)) return;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  mutate(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

removeJson(path.join(home, '.config', 'opencode', 'opencode.json'), (c) => {
  if (c.mcp && c.mcp.servers) delete c.mcp.servers.qemu;
});
removeJson(path.join(home, '.claude.json'), (c) => {
  if (c.mcpServers) delete c.mcpServers.qemu;
});
removeJson(path.join(home, '.gemini', 'settings.json'), (c) => {
  if (c.mcpServers) delete c.mcpServers.qemu;
});
removeJson(path.join(home, '.cursor', 'mcp.json'), (c) => {
  if (c.mcpServers) delete c.mcpServers.qemu;
});

const codexFile = path.join(home, '.codex', 'config.toml');
if (fs.existsSync(codexFile)) {
  const lines = fs.readFileSync(codexFile, 'utf8').split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    if (/^\[mcp_servers\.qemu\]\s*$/.test(line)) { skip = true; continue; }
    if (skip && /^\[/.test(line)) { skip = false; }
    if (!skip) out.push(line);
  }
  fs.writeFileSync(codexFile, out.join('\n').replace(/\n+$/, '\n'));
}

try { execSync('npm rm -g qemu-mcp', { stdio: 'ignore' }); } catch {}

console.log('OpenCode MCP servers:');
try { execSync('opencode mcp list', { stdio: 'inherit' }); } catch {}
console.log();
console.log('qemu-mcp has been removed from the harnesses above.');
