/**
 * CDP JS 执行工具（含 iframe 穿透）
 * 通过 chrome.debugger 在页面中执行 JavaScript 代码
 * 不传 frame_id 时在主 frame 执行（替代原 js_execute）
 * 传 frame_id 时在指定 iframe 中执行（跨域穿透）
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

/** 检测代码是否包含 return 语句，如果包含则包装为 IIFE */
const wrapExpressionIfNeeded = (code: string): string => {
  const trimmed = code.trim();
  // 检测是否包含 return 语句（排除字符串内的 return）
  if (/(?:^|\n)\s*return\s/m.test(trimmed)) {
    return `(function() { ${trimmed} })()`;
  }
  return trimmed;
};

export const cdpFrameFunction: FunctionDefinition = {
  name: 'cdp_frame',
  description: [
    '在页面中执行 JavaScript 代码并返回结果。代码在页面上下文中运行，可访问 DOM 和全局变量。',
    '支持 return 语句和 async/await。',
    '传 frame_id 时可在指定 iframe 中执行（跨域穿透）。',
    '其他操作：list=列出所有 frame，snapshot=获取 frame 文本内容。',
  ].join(' '),
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'evaluate', 'snapshot'],
        description: '操作类型：list=列出所有 frame, evaluate=执行 JS 代码（默认主 frame，传 frame_id 可指定 iframe）, snapshot=获取 frame 文本内容',
      },
      frame_id: {
        type: 'string',
        description: 'frame ID（由 list 操作返回）。evaluate 不传时在主 frame 执行。snapshot 必填。',
      },
      expression: {
        type: 'string',
        description: '要执行的 JavaScript 代码。支持 return 语句（自动包装为 IIFE）。如 "return document.title" 或 "return document.querySelectorAll(\'a\').length"',
      },
      code: {
        type: 'string',
        description: 'expression 的别名，与 expression 等价。两者都传时优先 expression。',
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
      // expression 和 code 都可以，至少一个
      if (!params.expression && !params.code) return 'evaluate 操作需要 expression 或 code 参数';
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
      code?: string;
      max_length?: number;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, frame_id, max_length = 3000, tab_id } = params;
    // expression 优先，code 作为别名
    const rawExpression = params.expression || params.code || '';

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
        // 自动检测 return 语句并包装为 IIFE
        const finalExpression = wrapExpressionIfNeeded(rawExpression);

        if (frame_id) {
          // ——— 指定 frame 中执行（iframe 穿透） ———
          let contextId = CDPSessionManager.getFrameContextId(tabId, frame_id);

          if (contextId === null) {
            // 验证 frame_id 是否有效
            const treeResult = await CDPSessionManager.sendCommand(tabId, 'Page.getFrameTree');
            if (!treeResult.success) {
              return { success: false, error: `无法验证 frame: ${treeResult.error}` };
            }
            const frames = flattenFrameTree(treeResult.result?.frameTree);
            const targetFrame = frames.find((f) => f.frame_id === frame_id);
            if (!targetFrame) {
              return { success: false, error: `未找到 frame_id: ${frame_id}` };
            }

            // 等待短暂时间再重试（context 可能还没有创建完毕）
            await new Promise((r) => setTimeout(r, 200));
            contextId = CDPSessionManager.getFrameContextId(tabId, frame_id);

            if (contextId === null) {
              return {
                success: false,
                error: `无法获取 frame ${frame_id} 的执行上下文。可能是跨域 iframe 尚未加载完成，请稍后重试。`,
              };
            }
          }

          const evalResult = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
            expression: finalExpression,
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
            return { success: false, error: remoteResult.description || 'JS 执行出错' };
          }

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
        } else {
          // ——— 主 frame 执行（替代原 js_execute） ———
          const evalResult = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
            expression: finalExpression,
            returnByValue: true,
            awaitPromise: true,
            timeout: 10_000,
          });

          if (!evalResult.success) {
            return { success: false, error: `JS 执行失败: ${evalResult.error}` };
          }

          const remoteResult = evalResult.result?.result;
          if (remoteResult?.subtype === 'error') {
            return { success: false, error: remoteResult.description || 'JS 执行出错' };
          }

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
              result: remoteResult?.value,
              type: remoteResult?.type,
              message: '在主 frame 中执行成功',
            },
          };
        }
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
