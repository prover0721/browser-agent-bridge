import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';

test('MCP advertises snapshot revisions, validates arguments and forwards them to the browser', async () => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as any).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))], env: { ...process.env as Record<string, string>, BRIDGE_PORT: String(port) }, stderr: 'pipe' });
  const client = new Client({ name: 'bridge-test', version: '1.0.0' });
  let browser: WebSocket | undefined;
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const name of ['browser_click', 'browser_type', 'browser_get_text']) assert.ok(tools.find(tool => tool.name === name)?.inputSchema.properties?.snapshot_id);
    for (const [name, args] of [['browser_type', { element_id: 1 }], ['browser_click', { element_id: -1 }], ['browser_wait', { seconds: -1 }], ['browser_click', { element_id: 'wrong' }], ['browser_list_tabs', { unexpected: true }]] as const) {
      const result = await client.callTool({ name, arguments: args }); assert.equal(result.isError, true);
    }
    browser = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'chrome-extension://' + 'a'.repeat(32) });
    await once(browser, 'open');
    const request = once(browser, 'message');
    const resultPromise = client.callTool({ name: 'browser_type', arguments: { tab_id: 7, element_id: 3, snapshot_id: 'revision', text: 'example' } });
    const msg = JSON.parse((await request)[0].toString());
    assert.equal(msg.params.snapshot_id, 'revision');
    assert.ok(msg.session_id);
    browser.send(JSON.stringify({ id: msg.id, result: 'Filled' }));
    assert.deepEqual((await resultPromise).content, [{ type: 'text', text: 'Filled' }]);
  } finally { browser?.terminate(); await client.close(); }
});
