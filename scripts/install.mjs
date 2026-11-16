import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
process.chdir(root);

const allFlag = process.argv.includes('--all') || process.argv.includes('-all');

function has(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function editJson(file, mutate) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  mutate(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

const home = process.env.HOME || process.env.USERPROFILE || '';

async function ask(question) {
  if (allFlag || !process.stdin.isTTY) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

if (!has('node')) {
  console.error('Node.js 20 or newer is required. Install it first, then rerun.');
  process.exit(1);
}

console.log('Linking qemu-mcp on PATH...');
if (!run('npm link')) {
  console.error('npm link failed.');
  process.exit(1);
}

// OpenCode
const opencodePresent = has('opencode') || fs.existsSync(path.join(home, '.config', 'opencode'));
if (opencodePresent) {
  const file = path.join(home, '.config', 'opencode', 'opencode.json');
  let registered = false;
  try { registered = !!JSON.parse(fs.readFileSync(file, 'utf8')).mcp?.servers?.qemu; } catch {}
  if (registered) {
    console.log('OpenCode: already registered');
  } else if (await ask('Register qemu-mcp with OpenCode?')) {
    if (has('opencode')) run('opencode mcp add qemu --global -- qemu-mcp');
    else {
      editJson(file, (c) => {
        c.mcp = c.mcp || {};
        c.mcp.servers = c.mcp.servers || {};
        c.mcp.servers.qemu = { type: 'local', command: ['qemu-mcp'] };
      });
    }
    console.log('OpenCode: registered');
  } else {
    console.log('OpenCode: skipped');
  }
}

// Claude Code
const claudePresent = has('claude') || fs.existsSync(path.join(home, '.claude.json')) || fs.existsSync(path.join(home, '.claude'));
if (claudePresent) {
  const file = path.join(home, '.claude.json');
  let registered = false;
  try { registered = !!JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.qemu; } catch {}
  if (registered) {
    console.log('Claude Code: already registered');
  } else if (await ask('Register qemu-mcp with Claude Code?')) {
    if (has('claude')) run('claude mcp add --scope user qemu -- qemu-mcp');
    else {
      editJson(file, (c) => {
        c.mcpServers = c.mcpServers || {};
        c.mcpServers.qemu = { type: 'stdio', command: 'qemu-mcp', args: [] };
      });
    }
    console.log('Claude Code: registered');
  } else {
    console.log('Claude Code: skipped');
  }
}

// Gemini CLI
const geminiPresent = has('gemini') || fs.existsSync(path.join(home, '.gemini'));
if (geminiPresent) {
  const file = path.join(home, '.gemini', 'settings.json');
  let registered = false;
  try { registered = !!JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.qemu; } catch {}
  if (registered) {
    console.log('Gemini CLI: already registered');
  } else if (await ask('Register qemu-mcp with Gemini CLI?')) {
    if (has('gemini')) run('gemini mcp add -s user qemu qemu-mcp');
    else {
      editJson(file, (c) => {
        c.mcpServers = c.mcpServers || {};
        c.mcpServers.qemu = { command: 'qemu-mcp', args: [] };
      });
    }
    console.log('Gemini CLI: registered');
  } else {
    console.log('Gemini CLI: skipped');
  }
}

// Codex
const codexPresent = has('codex') || fs.existsSync(path.join(home, '.codex'));
if (codexPresent) {
  const dir = path.join(home, '.codex');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.toml');
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch {}
  const registered = /^\[mcp_servers\.qemu\]/m.test(content);
  if (registered) {
    console.log('Codex: already registered');
  } else if (await ask('Register qemu-mcp with Codex?')) {
    content = content.trimEnd() + '\n\n[mcp_servers.qemu]\ncommand = "qemu-mcp"\nargs = []\n';
    fs.writeFileSync(file, content);
    console.log('Codex: registered');
  } else {
    console.log('Codex: skipped');
  }
}

// Cursor
const cursorPresent = has('cursor') || fs.existsSync(path.join(home, '.cursor'));
if (cursorPresent) {
  const dir = path.join(home, '.cursor');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mcp.json');
  let registered = false;
  try { registered = !!JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.qemu; } catch {}
  if (registered) {
    console.log('Cursor: already registered');
  } else if (await ask('Register qemu-mcp with Cursor?')) {
    editJson(file, (c) => {
      c.mcpServers = c.mcpServers || {};
      c.mcpServers.qemu = { type: 'stdio', command: 'qemu-mcp', args: [] };
    });
    console.log('Cursor: registered');
  } else {
    console.log('Cursor: skipped');
  }
}

const { version } = require(path.join(root, 'package.json'));
console.log();
console.log(`qemu-mcp ${version}`);
console.log();
console.log('OpenCode MCP servers:');
try { execSync('opencode mcp list', { stdio: 'inherit' }); } catch {}

console.log();
console.log('Done. qemu-mcp is installed globally. Pass absolute disk paths when');
console.log('the client cannot set a working directory.');
if (!allFlag) {
  console.log('Tip: rerun with --all to register every detected harness without prompts.');
}
