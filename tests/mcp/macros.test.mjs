import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { listMacros, runMacro } from '../../scripts/mcp/macros.mjs';

test('listMacros finds the sample macro', async () => {
  const dir = path.join(process.cwd(), 'scripts', 'mcp', 'macros');
  const names = await listMacros(dir);
  assert.ok(names.includes('dos-prompt'));
});

test('runMacro executes the sample macro', async () => {
  const session = {};
  const result = await runMacro('dos-prompt', session, {});
  assert.equal(result.ok, true);
});
