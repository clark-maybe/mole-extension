/**
 * MCP Client 实现
 * 通过传输层连接 MCP Server，提供工具列表查询和工具调用能力
 */

import type { MCPTool, MCPToolCallResult, MCPListToolsResponse } from './types';
import type { InMemoryTransport } from './transport';

export class MCPClient {
  /** 传输层实例 */
  private transport: InMemoryTransport;

  constructor(transport: InMemoryTransport) {
    this.transport = transport;
  }

  /**
   * 获取所有可用工具列表
   * @returns MCP 工具定义数组
   */
  async listTools(): Promise<MCPTool[]> {
    const response: MCPListToolsResponse = await this.transport.request('tools/list');
    return response.tools;
  }

  /**
   * 调用指定工具
   * @param name 工具名称
   * @param args 调用参数
   * @param context 可选的浏览器上下文（如 tabId）
   * @returns MCP 工具调用结果
   */
  async callTool(
    name: string,
    args: Record<string, any>,
    context?: { tabId?: number },
    options?: { signal?: AbortSignal },
  ): Promise<MCPToolCallResult> {
    return this.transport.request('tools/call', {
      name,
      arguments: args,
      _meta: context,
      signal: options?.signal,
    }, { signal: options?.signal });
  }
}
