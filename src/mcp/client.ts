/**
 * MCP Client 实现
 * 通过传输层连接 MCP Server，提供工具列表查询和工具调用能力
 */

import type { MCPTool, MCPToolCallResult, MCPListToolsResponse } from './types';
import type { InMemoryTransport } from './transport';

export class MCPClient {
  /** 传输层实例 */
  private transport: InMemoryTransport;

  /** 工具列表缓存（首次调用 isParallel 时填充） */
  private toolsCache: MCPTool[] | null = null;

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

  /**
   * 查询工具是否支持并行执行
   * 内部缓存 listTools 结果，避免重复请求
   * @param toolName 工具名称
   * @returns 是否支持并行，默认 false
   */
  async isParallel(toolName: string): Promise<boolean> {
    if (!this.toolsCache) {
      this.toolsCache = await this.listTools();
    }
    const tool = this.toolsCache.find((t) => t.name === toolName);
    return tool?.supportsParallel ?? false;
  }
}
