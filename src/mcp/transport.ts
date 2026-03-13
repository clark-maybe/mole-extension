/**
 * MCP 内存传输层
 * 同进程内直接方法调用，无序列化开销
 * 未来可替换为 Native Messaging 等其他传输方式
 */

import type { MCPMethod } from './types';
import type { MCPServer } from './server';

interface MCPTransportRequestOptions {
  signal?: AbortSignal;
}

export class InMemoryTransport {
  /** 关联的 MCP Server 实例 */
  private server: MCPServer;

  constructor(server: MCPServer) {
    this.server = server;
  }

  /**
   * 发送请求到 MCP Server
   * 直接调用 server.handleRequest()，无需网络通信
   * @param method 请求方法
   * @param params 请求参数
   * @returns 响应结果
   */
  async request(method: MCPMethod, params?: any, options?: MCPTransportRequestOptions): Promise<any> {
    return this.server.handleRequest(method, params, options?.signal);
  }
}
