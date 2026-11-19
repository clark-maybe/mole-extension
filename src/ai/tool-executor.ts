/**
 * 工具执行层
 * 职责：调用 MCP 工具、spawn_subtask 递归、结果截断、事件广播
 */

import type { InputItem, OutputFunctionCallItem, AIStreamEvent, ToolSchema, MessageInputItem } from './types';
import type { PermissionLevel } from '../functions/types';
import { mcpClient, getBuiltinFunction } from '../functions/registry';
import { truncateToolResult, getTextContent } from './context-manager';
import { requestConfirmationFunction } from '../functions/request-confirmation';
import type { AgentRunState } from './run-state';

/** Agent 执行器类型（由 orchestrator 注入） */
export type AgentRunner = (params: {
  type?: string;
  goal: string;
  tab_id?: number;
}, signal?: AbortSignal) => Promise<{ success: boolean; summary: string; agentId: string }>;

// ============ 统一 Agent 工具定义 ============

/** 统一 agent 工具 Schema（替代旧的 4 个独立子 agent 工具） */
const AGENT_TOOL_SCHEMA: ToolSchema = {
  type: 'function',
  name: 'agent',
  description: [
    '启动子 Agent 执行独立任务。支持并行：可同时启动多个 Agent 在不同标签页工作。',
    '',
    '预定义类型：',
    '- explore：只读侦察页面结构和交互元素',
    '- plan：分析任务并制定执行计划',
    '- review：独立验证操作结果',
    '- subtask：执行独立子目标（可使用大部分工具）',
    '',
    '⚠️ 不要用此工具来：',
    '- 简单的单步查询（直接用 page_viewer 等工具）',
    '- 需要当前完整上下文的操作（Agent 上下文是隔离的）',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['explore', 'plan', 'review', 'subtask'],
        description: '预定义 Agent 类型',
      },
      goal: {
        type: 'string',
        description: '任务目标描述，要具体明确',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。不传则继承父 Agent 的 tab',
      },
    },
    required: ['goal'],
  },
};

/** 旧工具名 → agent type 映射（向后兼容） */
const LEGACY_AGENT_MAP: Record<string, string> = {
  spawn_subtask: 'subtask',
  explore: 'explore',
  plan: 'plan',
  review: 'review',
};

/** Agent 类型 → thinking 前缀 */
const AGENT_THINKING_PREFIX: Record<string, string> = {
  explore: '正在探索',
  plan: '正在规划',
  review: '正在审查',
  subtask: '正在处理子任务',
};

/** 判断是否是 agent 相关工具（含旧名别名） */
export const isAgentTool = (name: string): boolean =>
  name === 'agent' || name === 'send_message' || name in LEGACY_AGENT_MAP;

/** 返回 agent 工具的 schema 列表 */
export const getAgentSchemas = (): ToolSchema[] => [AGENT_TOOL_SCHEMA];

// ── 向后兼容导出 ──
export const getSubagentSchemas = getAgentSchemas;
export const isSubagent = isAgentTool;
export const getSubagentNames = (): string[] => ['agent', ...Object.keys(LEGACY_AGENT_MAP)];

/** 执行组类型：并行组或串行组 */
interface ExecutionGroup {
  type: 'parallel' | 'serial';
  calls: OutputFunctionCallItem[];
}

/**
 * 按 supportsParallel 标记将 calls 数组分组
 * 连续的 parallel 工具收集为一个并行组，serial 工具各自独立成组
 */
const buildExecutionGroups = async (calls: OutputFunctionCallItem[]): Promise<ExecutionGroup[]> => {
  const groups: ExecutionGroup[] = [];
  let currentParallelGroup: OutputFunctionCallItem[] = [];

  const flushParallelGroup = () => {
    if (currentParallelGroup.length > 0) {
      groups.push({ type: 'parallel', calls: [...currentParallelGroup] });
      currentParallelGroup = [];
    }
  };

  for (const call of calls) {
    // agent 工具支持并行执行（不再强制串行）
    if (isAgentTool(call.name)) {
      currentParallelGroup.push(call);
      continue;
    }

    const parallel = await mcpClient.isParallel(call.name);
    if (parallel) {
      currentParallelGroup.push(call);
    } else {
      flushParallelGroup();
      groups.push({ type: 'serial', calls: [call] });
    }
  }

  // 收尾：清空剩余的并行组
  flushParallelGroup();

  return groups;
};

/**
 * 执行一批工具调用
 * 支持并行分流：连续的 supportsParallel 工具用 Promise.all 并发执行
 */
/** 会话级敏感操作信任标记：用户选择"本次不再询问"后置为 true，持续到 SW 重启 */
let sensitiveAccessTrusted = false;

/** 重置敏感操作信任标记（新会话时调用） */
export const resetSensitiveAccessTrust = () => { sensitiveAccessTrusted = false; };

export const executeToolCalls = async (
  calls: OutputFunctionCallItem[],
  tabId: number | undefined,
  signal: AbortSignal | undefined,
  emit: (event: AIStreamEvent) => void,
  agentRunner?: AgentRunner,
  sessionId?: string,
  runState?: AgentRunState,
): Promise<InputItem[]> => {
  const results: InputItem[] = [];

  // ===== 元数据驱动的权限检查 =====

  /** 获取工具+action 的实际权限等级（从 FunctionDefinition 元数据读取） */
  const resolvePermissionLevel = (name: string, params: Record<string, any>): PermissionLevel => {
    const def = getBuiltinFunction(name);
    if (!def) return 'interact'; // 动态工具/未知工具默认 interact
    const action = String(params.action || '');
    // action 级覆盖优先
    if (action && def.actionPermissions?.[action]) {
      return def.actionPermissions[action];
    }
    return def.permissionLevel || 'interact';
  };

  /** 生成确认消息（根据工具元数据的 approvalMessageTemplate 或兜底） */
  const buildApprovalMessage = (name: string, params: Record<string, any>): string | null => {
    const level = resolvePermissionLevel(name, params);
    if (level === 'read' || level === 'interact') return null;

    const def = getBuiltinFunction(name);
    const action = String(params.action || '');
    const template = typeof def?.approvalMessageTemplate === 'string'
      ? def.approvalMessageTemplate
      : def?.approvalMessageTemplate?.[action];

    if (template) {
      return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? '?'));
    }
    // 兜底消息
    return `AI 正在执行需要授权的操作: ${name}${action ? ` (${action})` : ''}`;
  };

  /** 判断是否每次必须确认（dangerous 级别不受 trustAll 影响） */
  const isAlwaysConfirmOperation = (name: string, params: Record<string, any>): boolean => {
    return resolvePermissionLevel(name, params) === 'dangerous';
  };

  /**
   * 串行处理敏感操作确认
   * 返回 null 表示已通过（或无需确认），返回 string 表示被拒绝（值为 output）
   */
  const resolveSensitiveApproval = async (
    call: OutputFunctionCallItem,
  ): Promise<string | null> => {
    const params = safeParseArgs(call.arguments);
    const approvalMessage = buildApprovalMessage(call.name, params);
    if (!approvalMessage) return null;
    // 高危操作（导航/关闭标签页）始终需要确认，不受 trustAll 影响
    const alwaysConfirm = isAlwaysConfirmOperation(call.name, params);
    if (sensitiveAccessTrusted && !alwaysConfirm) return null;

    const approvalResult = await requestConfirmationFunction.execute(
      { message: approvalMessage },
      { tabId, signal },
    );
    const approved = approvalResult.success && approvalResult.data?.approved;
    // 用户选择"本次不再询问"时，后续自动跳过确认
    if (approved && approvalResult.data?.trustAll) {
      sensitiveAccessTrusted = true;
    }
    if (approved) return null;

    // 被拒绝：emit 结果并返回 output
    const output = JSON.stringify({
      success: false,
      error: approvalResult.data?.userMessage || '用户拒绝了敏感数据访问请求',
    });
    emit({
      type: 'function_result',
      content: JSON.stringify({
        name: call.name,
        callId: call.call_id,
        success: false,
        message: '用户拒绝',
        cancelled: false,
      }),
    });
    return output;
  };

  /** 执行单个工具调用（不含 emit function_call，由调用方控制；确认已在外部完成） */
  const executeSingleTool = async (
    call: OutputFunctionCallItem,
  ): Promise<{ call: OutputFunctionCallItem; output: string }> => {
    const params = safeParseArgs(call.arguments);
    let output: string;

    if (isAgentTool(call.name) && call.name !== 'send_message') {
      // 统一 Agent 执行（含旧工具名别名映射）
      const agentType = call.name === 'agent'
        ? (params.type || 'subtask')
        : LEGACY_AGENT_MAP[call.name];
      const goal = String(params.goal || '');
      const targetTabId = params.tab_id as number | undefined;
      const prefix = AGENT_THINKING_PREFIX[agentType] || '正在执行 Agent';
      emit({ type: 'thinking', content: `${prefix}：${goal.slice(0, 60)}` });

      if (!agentRunner) {
        output = JSON.stringify({ success: false, error: 'Agent 执行器未注入' });
      } else {
        try {
          const result = await agentRunner({ type: agentType, goal, tab_id: targetTabId }, signal);
          output = JSON.stringify({
            success: result.success,
            data: { summary: result.summary, agentId: result.agentId },
          });
        } catch (err: any) {
          output = JSON.stringify({
            success: false,
            error: err?.message || 'Agent 执行失败',
          });
        }
      }
    } else if (call.name === 'send_message') {
      // send_message 消息投递（Phase 3 完善）
      output = JSON.stringify({ success: false, error: 'send_message 尚未实现' });
    } else {
      // 常规工具执行
      try {
        const result = await mcpClient.callTool(
          call.name,
          params,
          { tabId, sessionId, webAccess: runState?.webAccess, webNavigation: runState?.webNavigation },
          { signal },
        );
        const text = result.content?.[0]?.text || '{}';
        output = truncateToolResult(text);
      } catch (err: any) {
        if (signal?.aborted) {
          output = JSON.stringify({ success: false, error: '任务已取消' });
        } else {
          output = JSON.stringify({
            success: false,
            error: err?.message || '工具执行异常',
          });
        }
      }
    }

    // 从 output 中提取 success/error 供 UI 层展示
    let resultSuccess = true;
    let resultMessage = '';
    let resultCancelled = false;
    let resultCode: string | undefined;
    let resultTabId: number | undefined;
    let verificationWatchId: string | undefined;
    let autoResume = false;
    try {
      const parsed = JSON.parse(output);
      resultSuccess = parsed.success !== false;
      resultMessage = parsed.error || parsed.data?.summary || '';
      resultCancelled = signal?.aborted === true && !resultSuccess;
      resultCode = typeof parsed.code === 'string' ? parsed.code : undefined;
      autoResume = parsed.data?.auto_resume === true;
      resultTabId = Number.isSafeInteger(parsed.data?.tab_id) && parsed.data.tab_id > 0
        ? parsed.data.tab_id : undefined;
      verificationWatchId = typeof parsed.data?.verification_watch_id === 'string'
        ? parsed.data.verification_watch_id : undefined;
    } catch {
      // output 解析失败，保持默认值
    }

    // 工具执行完成后立即 emit 结果（并行组内按完成顺序 emit）
    emit({
      type: 'function_result',
      content: JSON.stringify({
        name: call.name,
        callId: call.call_id,
        success: resultSuccess,
        message: resultMessage,
        cancelled: resultCancelled,
        code: resultCode,
        tabId: resultTabId,
        verificationWatchId,
        autoResume,
      }),
    });

    return { call, output };
  };

  // 构建执行分组
  const groups = await buildExecutionGroups(calls);

  for (const group of groups) {
    if (signal?.aborted) break;

    if (group.type === 'serial' || group.calls.length === 1) {
      // 串行执行（包括只有 1 个工具的"并行组"退化为串行）
      for (const call of group.calls) {
        if (signal?.aborted) break;

        // 串行路径：先确认再执行
        const rejected = await resolveSensitiveApproval(call);
        if (rejected) {
          results.push({ type: 'function_call_output' as const, call_id: call.call_id, output: rejected });
          continue;
        }

        emit({
          type: 'function_call',
          content: JSON.stringify({
            name: call.name,
            callId: call.call_id,
            arguments: call.arguments,
          }),
        });

        const { output } = await executeSingleTool(call);

        results.push({
          type: 'function_call_output' as const,
          call_id: call.call_id,
          output,
        });
      }
    } else {
      // 并行执行：先串行完成所有敏感操作确认，再并发执行工具
      const approvedCalls: OutputFunctionCallItem[] = [];
      for (const call of group.calls) {
        if (signal?.aborted) break;
        const rejected = await resolveSensitiveApproval(call);
        if (rejected) {
          results.push({ type: 'function_call_output' as const, call_id: call.call_id, output: rejected });
        } else {
          approvedCalls.push(call);
        }
      }

      // emit 所有已通过确认的 function_call 事件
      for (const call of approvedCalls) {
        emit({
          type: 'function_call',
          content: JSON.stringify({
            name: call.name,
            callId: call.call_id,
            arguments: call.arguments,
          }),
        });
      }

      // Promise.all 并发执行
      const groupResults = await Promise.all(
        approvedCalls.map((call) => executeSingleTool(call)),
      );

      // 按原始 calls 顺序 push 到 results（保持与输入顺序一致）
      for (const { call, output } of groupResults) {
        results.push({
          type: 'function_call_output' as const,
          call_id: call.call_id,
          output,
        });
      }
    }
  }

  return results;
};

/** 安全解析工具参数 */
const safeParseArgs = (raw: string): Record<string, any> => {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};

/** 从上下文中提取最后一条助手回复 */
export const extractLastAssistantReply = (context: InputItem[]): string => {
  for (let i = context.length - 1; i >= 0; i--) {
    const item = context[i];
    if ('role' in item && item.role === 'assistant') {
      return getTextContent((item as MessageInputItem).content);
    }
  }
  return '';
};
