/**
 * CDP iframe 穿透工具
 * 通过 chrome.debugger 列出 frame 树、在指定 frame 中执行 JS
 * 解决跨域 iframe（如 reCAPTCHA、支付表单等）无法通过 content script 操作的问题
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { CDPSessionManager } from '../lib/cdp-session';

/** 获取当前活动标签页 ID */
const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
};

/** 将 CDP FrameTree 递归扁平化为列表 */
interface FlatFrame {
  frame_id: string;
  parent_frame_id: string;
  url: string;
  name: string;
  security_origin: string;
  is_main: boolean;
}

const flattenFrameTree = (
  frameTree: any,
  parentFrameId: string = '',
  isMain: boolean = true,
): FlatFrame[] => {
  const result: FlatFrame[] = [];
  const frame = frameTree?.frame;
  if (!frame) return result;

  result.push({
    frame_id: frame.id || '',
    parent_frame_id: parentFrameId,
    url: frame.url || '',
    name: frame.name || '',
    security_origin: frame.securityOrigin || '',
    is_main: isMain,
  });

  const children = frameTree.childFrames;
  if (Array.isArray(children)) {
    for (const child of children) {
      result.push(...flattenFrameTree(child, frame.id, false));
    }
  }

  return result;
};

export const cdpFrameFunction: FunctionDefinition = {
  name: 'cdp_frame',
  description: '跨 iframe 操作工具。列出页面所有 frame（主 frame + 子 iframe），在指定 frame 中执行 JavaScript，或获取 iframe 内的文本内容摘要。适用于操作跨域 iframe 内的元素（如验证码、支付表单等）。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'evaluate', 'snapshot'],
        description: '操作类型：list=列出所有 frame, evaluate=在指定 frame 中执行 JS, snapshot=获取 frame 文本内容',
      },
      frame_id: {
        type: 'string',
        description: 'frame ID（由 list 操作返回）。evaluate 和 snapshot 必填。',
      },
      expression: {
        type: 'string',
        description: '要在 frame 中执行的 JavaScript 表达式（仅 evaluate）。',
      },
      max_length: {
        type: 'number',
        description: 'snapshot 返回文本的最大长度（字符数），默认 3000。',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。不传则使用当前活动标签页。',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return '缺少 action 参数';
    if (!['list', 'evaluate', 'snapshot'].includes(action)) {
      return `不支持的 action: ${action}`;
    }
    if (action === 'evaluate') {
      if (!params.frame_id) return 'evaluate 操作需要 frame_id 参数';
      if (!params.expression) return 'evaluate 操作需要 expression 参数';
    }
    if (action === 'snapshot') {
      if (!params.frame_id) return 'snapshot 操作需要 frame_id 参数';
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      frame_id?: string;
      expression?: string;
      max_length?: number;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, frame_id, expression, max_length = 3000, tab_id } = params;

    // 确定目标 tabId
    let tabId: number;
    if (typeof tab_id === 'number' && tab_id > 0) {
      tabId = tab_id;
    } else if (typeof context?.tabId === 'number' && context.tabId > 0) {
      tabId = context.tabId;
    } else {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        return { success: false, error: '无法确定目标标签页' };
      }
      tabId = activeTabId;
    }

    switch (action) {
      case 'list': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Page.getFrameTree');
        if (!result.success) {
          return { success: false, error: `获取 frame 树失败: ${result.error}` };
        }
        const frames = flattenFrameTree(result.result?.frameTree);
        return {
          success: true,
          data: {
            frames,
            total: frames.length,
            message: `共 ${frames.length} 个 frame（1 个主 frame + ${frames.length - 1} 个子 iframe）`,
          },
        };
      }

      case 'evaluate': {
        // 先尝试用 frameContexts 映射获取 contextId
        let contextId = CDPSessionManager.getFrameContextId(tabId, frame_id!);

        // 如果没有缓存的 contextId，尝试通过 Runtime.evaluate 配合 uniqueContextId
        // 先确保 Runtime 域已启用（attach 会自动启用）
        if (contextId === null) {
          // 重新获取 frame 列表，验证 frame_id 是否有效
          const treeResult = await CDPSessionManager.sendCommand(tabId, 'Page.getFrameTree');
          if (!treeResult.success) {
            return { success: false, error: `无法验证 frame: ${treeResult.error}` };
          }
          const frames = flattenFrameTree(treeResult.result?.frameTree);
          const targetFrame = frames.find((f) => f.frame_id === frame_id);
          if (!targetFrame) {
            return { success: false, error: `未找到 frame_id: ${frame_id}` };
          }

          // 通过 Page.createIsolatedWorld 创建一个 isolated context 来获取 contextId
          // 或直接用 Runtime.evaluate 在指定 frame 中执行
          // 使用 Runtime.evaluate 搭配 contextId 更可靠
          // 如果映射中没有，等待短暂时间再重试（context 可能还没有创建完毕）
          await new Promise((r) => setTimeout(r, 200));
          contextId = CDPSessionManager.getFrameContextId(tabId, frame_id!);

          if (contextId === null) {
            return {
              success: false,
              error: `无法获取 frame ${frame_id} 的执行上下文。可能是跨域 iframe 尚未加载完成，请稍后重试。`,
            };
          }
        }

        const evalResult = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
          expression: expression!,
          contextId,
          returnByValue: true,
          awaitPromise: true,
          timeout: 10_000,
        });

        if (!evalResult.success) {
          return { success: false, error: `JS 执行失败: ${evalResult.error}` };
        }

        const remoteResult = evalResult.result?.result;
        if (remoteResult?.subtype === 'error') {
          return {
            success: false,
            error: remoteResult.description || 'JS 执行出错',
          };
        }

        // 处理异常信息
        const exceptionDetails = evalResult.result?.exceptionDetails;
        if (exceptionDetails) {
          return {
            success: false,
            error: exceptionDetails.text || exceptionDetails.exception?.description || 'JS 执行异常',
          };
        }

        return {
          success: true,
          data: {
            value: remoteResult?.value,
            type: remoteResult?.type,
            frame_id,
            message: `在 frame ${frame_id} 中执行成功`,
          },
        };
      }

      case 'snapshot': {
        // 复用 evaluate 逻辑，执行固定的 innerText 表达式
        const snapshotExpression = 'document.body?.innerText || ""';
        const snapshotResult = await cdpFrameFunction.execute(
          {
            action: 'evaluate',
            frame_id,
            expression: snapshotExpression,
            tab_id,
          },
          context,
        );

        if (!snapshotResult.success) {
          return snapshotResult;
        }

        let text = String(snapshotResult.data?.value || '');
        const originalLength = text.length;
        const maxLen = Math.max(100, Math.min(10000, Math.floor(max_length)));
        if (text.length > maxLen) {
          text = text.substring(0, maxLen) + '…（已截断）';
        }

        return {
          success: true,
          data: {
            text,
            original_length: originalLength,
            truncated: originalLength > maxLen,
            frame_id,
            message: `获取 frame ${frame_id} 文本内容（${originalLength} 字符${originalLength > maxLen ? '，已截断至 ' + maxLen : ''}）`,
          },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
