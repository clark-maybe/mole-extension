/**
 * Function-Call 工具函数类型定义
 */

/** 工具权限等级 */
export type PermissionLevel = 'read' | 'interact' | 'sensitive' | 'dangerous';

/** 单个工具函数的定义 */
export interface ToolExecutionContext {
  tabId?: number;
  signal?: AbortSignal;
}

export interface FunctionDefinition {
  /** 函数唯一标识，如 "jd_search" */
  name: string;
  /** 给 AI 看的函数描述（中文），AI 据此判断是否调用 */
  description: string;
  /** JSON Schema 格式的参数描述 */
  parameters: Record<string, any>;
  /** 是否允许与其他工具并行执行（必须显式声明） */
  supportsParallel: boolean;
  /** 工具整体权限等级（默认 'interact'）：read=只读自动放行 | interact=交互自动放行 | sensitive=需确认可跳过 | dangerous=每次必须确认 */
  permissionLevel?: PermissionLevel;
  /** 细粒度：action 级别的权限覆盖（key = action 名称，优先于 permissionLevel） */
  actionPermissions?: Record<string, PermissionLevel>;
  /** 敏感操作的确认消息模板，支持 {action}/{key}/{url} 等占位符。字符串对所有 action 生效；Record 按 action 分别指定 */
  approvalMessageTemplate?: string | Record<string, string>;
  /** 自定义参数校验（可选，返回错误文案表示校验失败） */
  validate?: (params: any) => string | null;
  /** 执行函数，返回结果对象 */
  execute: (params: any, context?: ToolExecutionContext) => Promise<FunctionResult>;
}

/** 函数执行结果 */
export interface FunctionResult {
  success: boolean;
  data?: any;
  error?: string;
}
