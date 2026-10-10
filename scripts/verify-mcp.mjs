import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {build} from 'esbuild';

const binary = process.argv[2];
if (!binary || process.argv.length !== 3) throw Error('Use verify-mcp.mjs <packaged native MCP executable>');
const directory = await mkdtemp(join(tmpdir(), 'xsec-attack-path-contract-'));
const pending = new Map();
let serial = 0, diagnostic = '', stopped = false, exited;
const env = {...process.env, PLUGIN_DATA: directory};
delete env.XSEC_PLUGIN_HOST_RPC_ENDPOINT;
const child = spawn('rtk', ['proxy', resolve(binary)], {env, stdio: ['pipe', 'pipe', 'pipe']});
const exit = new Promise((fulfill, reject) => {
  child.once('exit', (code, signal) => {exited = {code, signal}; fulfill(exited);});
  child.once('error', reject);
});
function fail(error) {
  for (const entry of pending.values()) {clearTimeout(entry.timer); entry.reject(error);}
  pending.clear();
}
child.on('error', fail);
child.stdout.on('error', fail);
child.stderr.on('error', fail);
child.on('exit', () => {if (!stopped) fail(Error('MCP exited during the contract check'));});
child.stderr.on('data', bytes => {
  diagnostic += String(bytes);
  if (Buffer.byteLength(diagnostic) > 256 * 1024) {fail(Error('MCP diagnostic capacity exceeded')); child.kill('SIGTERM');}
});
const lines = createInterface({input: child.stdout});
lines.on('line', line => {
  try {
    const message = JSON.parse(line), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  } catch (error) {fail(error);}
});
function request(method, params) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {pending.delete(id); reject(Error('MCP request deadline: ' + method));}, 10000);
    pending.set(id, {timer, resolve, reject});
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n', error => {if (error) fail(error);});
  });
}
const call = (name, args = {}) => request('tools/call', {name, arguments: args});
let failure;
try {
  const output = await build({entryPoints: [new URL('../frontend-src/core.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', target: 'node22', write: false});
  const core = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].contents).toString('base64'));
  const initialized = await request('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'xsec-attack-path-contract', version: '1'}});
  assert.ok(initialized.serverInfo.name.includes('attack-path'));
  child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
  const descriptor = await request('tools/list', {});
  const mcp = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url)));
  const tools = Object.values(mcp.extensions['com.xsec.desktop'].contributes.agentTools).map(row => row.mcpTool).sort();
  assert.deepEqual(descriptor.tools.map(row => row.name).sort(), tools);
  assert.deepEqual(core.readAttackPathNodes(await call('attack_path_list'), 'standalone'), []);
  const created = await call('attack_path_node_create', {title: '本地契约根节点'});
  assert.equal(created.isError, false);
  const rootId = JSON.parse(created.content[0].text).item.id;
  await call('attack_path_node_create', {title: '本地契约子节点', parentId: rootId, kind: 'trigger'});
  const nodes = core.readAttackPathNodes(await call('attack_path_list'), 'standalone');
  assert.equal(nodes.length, 2);
  assert.equal(nodes.find(row => row.parent_id)?.parent_id, rootId);
  const rejected = await call('attack_path_node_create', {});
  assert.equal(rejected.isError, true);
  assert.throws(() => core.readAttackPathNodes(rejected, 'standalone'), /invalid attack-path arguments/);
  const listed = await call('attack_path_list');
  assert.throws(() => core.readAttackPathNodes(listed, 'other-assignment'), /当前任务不匹配/);
  assert.equal(core.readAttackPathNodes(listed, 'standalone').length, 2);
  console.log('Real MCP contract passed: discovery, empty read, parent/child writes, error propagation and assignment admission');
} catch (error) {failure = error;}
stopped = true;
child.stdin.end();
const deadline = setTimeout(() => child.kill('SIGTERM'), 5000);
try {
  const result = await exit;
  if (result.code !== 0) throw Error('MCP shutdown failed: ' + JSON.stringify(result));
} catch (error) {failure = failure ? new AggregateError([failure, error], 'MCP contract and shutdown failed') : error;}
finally {clearTimeout(deadline); lines.close(); fail(Error('MCP contract ended'));}
if (failure) throw failure;
assert.ok(exited);
await rm(directory, {recursive: true});
