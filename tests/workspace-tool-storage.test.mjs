import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = buildSync({ stdin: { contents: `export {MCPServer} from './src/mcp/server'; export {WorkspacePersistenceError} from './src/workspace/errors';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, format: 'esm', platform: 'node', write: false });
const { MCPServer, WorkspacePersistenceError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('存储失败经过 MCP 协议仍携带停止执行的错误码，区别普通平台失败', async () => {
  const server = new MCPServer();
  server.registerTool({ name: 'storage_fixture', description: '', supportsParallel: false, permissionLevel: 'read', parameters: { type: 'object' }, execute: async () => { throw new WorkspacePersistenceError('本地配额不足'); } });
  const response = await server.handleRequest('tools/call', { name: 'storage_fixture', arguments: {} });
  const result = JSON.parse(response.content[0].text);
  assert.equal(response.isError, true); assert.equal(result.code, 'E_WORKSPACE_STORAGE'); assert.equal(result.retryable, false);
});
