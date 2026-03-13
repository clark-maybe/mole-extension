/**
 * MCP（Model Context Protocol）协议核心类型定义
 * 自实现轻量 MCP 层，仅覆盖 tools/list 和 tools/call 协议
 */

/** MCP 工具定义 */
export interface MCPTool {
  /** 工具唯一名称 */
  name: string;
  /** 工具描述（供 AI 理解） */
  description: string;
  /** 工具输入参数的 JSON Schema */
  inputSchema: Record<string, any>;
  /** 是否支持并行执行（默认 false） */
  supportsParallel: boolean;
}

/** MCP 工具调用请求参数 */
export interface MCPToolCallRequest {
  /** 工具名称 */
  name: string;
  /** 调用参数 */
  arguments: Record<string, any>;
  /** 元数据，用于传递浏览器上下文（如 tabId） */
  _meta?: {
    tabId?: number;
    [key: string]: any;
  };
  /** 取消信号（仅内存传输使用，不做序列化） */
  signal?: AbortSignal;
}

/** MCP 工具调用结果中的单条内容 */
export interface MCPToolCallContent {
  /** 内容类型 */
  type: 'text';
  /** 文本内容 */
  text: string;
}

/** MCP 工具调用结果 */
export interface MCPToolCallResult {
  /** 结果内容列表 */
  content: MCPToolCallContent[];
  /** 是否为错误结果 */
  isError?: boolean;
}

/** MCP tools/list 响应 */
export interface MCPListToolsResponse {
  /** 可用工具列表 */
  tools: MCPTool[];
}

/** MCP 请求方法类型 */
export type MCPMethod = 'tools/list' | 'tools/call';

/** MCP 通用请求 */
export interface MCPRequest {
  /** 请求方法 */
  method: MCPMethod;
  /** 请求参数 */
  params?: any;
}

/** MCP 通用响应 */
export interface MCPResponse {
  /** 响应结果 */
  result?: any;
  /** 错误信息 */
  error?: {
    code: number;
    message: string;
  };
}
