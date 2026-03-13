/**
 * MCP Server 实现
 * 管理工具注册，处理 tools/list 和 tools/call 请求
 * 内部使用 FunctionDefinition 作为工具实现载体
 */

import type { FunctionDefinition } from '../functions/types';
import { validateSchema } from './validator';
import type {
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResult,
  MCPListToolsResponse,
  MCPMethod,
} from './types';

export class MCPServer {
  /** 已注册的工具函数映射（name → FunctionDefinition） */
  private tools: Map<string, FunctionDefinition> = new Map();

  /**
   * 注册一个工具函数
   * @param tool 工具函数定义
   */
  registerTool(tool: FunctionDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 取消注册工具
   * @param name 工具名
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 判断工具是否存在
   * @param name 工具名
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 处理 MCP 请求
   * @param method 请求方法（tools/list 或 tools/call）
   * @param params 请求参数
   * @returns 响应结果
   */
  async handleRequest(method: MCPMethod, params?: any, signal?: AbortSignal): Promise<any> {
    switch (method) {
      case 'tools/list':
        return this.handleListTools();
      case 'tools/call':
        return this.handleCallTool(params as MCPToolCallRequest, signal);
      default:
        throw new Error(`不支持的 MCP 方法: ${method}`);
    }
  }

  /**
   * 处理 tools/list 请求
   * 返回所有已注册工具的 MCP 格式定义
   */
  private handleListTools(): MCPListToolsResponse {
    const tools: MCPTool[] = [];

    for (const [, funcDef] of this.tools) {
      tools.push({
        name: funcDef.name,
        description: funcDef.description,
        inputSchema: funcDef.parameters,
        supportsParallel: funcDef.supportsParallel === true,
      });
    }

    return { tools };
  }

  /**
   * 处理 tools/call 请求
   * 查找并执行指定工具，将结果转为 MCP 格式
   */
  private async handleCallTool(request: MCPToolCallRequest, inheritedSignal?: AbortSignal): Promise<MCPToolCallResult> {
    const { name, arguments: rawArgs, _meta } = request;
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const signal = request.signal || inheritedSignal;

    const funcDef = this.tools.get(name);
    if (!funcDef) {
      return {
        content: [{ type: 'text', text: `工具 ${name} 不存在` }],
        isError: true,
      };
    }

    // 从 _meta 中提取浏览器上下文
    const context = _meta?.tabId ? { tabId: _meta.tabId, signal } : { signal };

    if (signal?.aborted) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'aborted by user',
            code: 'E_CANCELLED',
            retryable: true,
          }),
        }],
        isError: true,
      };
    }

    const schemaValidation = validateSchema(funcDef.parameters, args, 'arguments');
    if (!schemaValidation.valid) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `参数校验失败: ${schemaValidation.errors.slice(0, 3).join('; ')}`,
            code: 'E_TOOL_PARAM_INVALID',
            retryable: false,
          }),
        }],
        isError: true,
      };
    }

    if (typeof funcDef.validate === 'function') {
      const customError = funcDef.validate(args);
      if (customError) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `参数校验失败: ${customError}`,
              code: 'E_TOOL_PARAM_INVALID',
              retryable: false,
            }),
          }],
          isError: true,
        };
      }
    }

    try {
      const executePromise = funcDef.execute(args, context);
      let result;
      if (signal) {
        result = await new Promise<Awaited<typeof executePromise>>((resolve, reject) => {
          const onAbort = () => {
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          };
          signal.addEventListener('abort', onAbort, { once: true });
          executePromise.then(resolve, reject).finally(() => {
            signal.removeEventListener('abort', onAbort);
          });
        });
      } else {
        result = await executePromise;
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !result.success,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'aborted by user',
              code: 'E_CANCELLED',
              retryable: true,
            }),
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message || '工具执行出错' }) }],
        isError: true,
      };
    }
  }
}
