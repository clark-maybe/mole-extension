/**
 * Function-Call 工具函数类型定义
 */

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
