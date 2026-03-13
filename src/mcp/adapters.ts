/**
 * MCP ↔ OpenAI Responses API 格式转换适配器
 * 将 MCP Tool 列表转换为 Responses API ToolSchema 格式，供 LLM API 使用
 */

import type { ToolSchema } from '../ai/types';
import type { MCPTool } from './types';

/**
 * 将 MCP 工具列表转换为 Responses API ToolSchema 数组
 * Responses API 工具格式使用顶层 name/description/parameters，并带有 type: 'function'
 * @param mcpTools MCP 工具定义列表
 * @returns Responses API 格式的 ToolSchema 数组
 */
export const mcpToolsToSchema = (mcpTools: MCPTool[]): ToolSchema[] =>
  mcpTools.map(tool => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
