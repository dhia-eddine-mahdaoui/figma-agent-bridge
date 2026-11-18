import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCodex, mergeClaude } from '../setup.mjs';
test('setup preserves other client configuration and updates only its own server',()=>{
  const original='model="existing"\n[mcp_servers.other]\ncommand="other"\n[mcp_servers.figma-local]\ncommand="old"\n[mcp_servers.figma-local.env]\nOLD="value"\n[profiles.work]\nmodel="existing"\n';
  const block='[mcp_servers.figma-local]\ncommand="new"\n';
  const merged=mergeCodex(original,block);
  assert.ok(merged.includes('[mcp_servers.other]'));assert.ok(merged.includes('[profiles.work]'));assert.ok(!merged.includes('OLD='));
  assert.equal(mergeCodex(merged,block),merged);
  const json=mergeClaude('{"preference":true,"mcpServers":{"other":{"command":"other"}}}',{command:'node',args:['mcp.mjs']});
  const value=JSON.parse(json);assert.equal(value.preference,true);assert.equal(value.mcpServers.other.command,'other');
  assert.throws(()=>mergeClaude('not JSON',{}));
});
