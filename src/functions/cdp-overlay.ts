/**
 * CDP 视觉高亮标注工具
 * 通过 chrome.debugger 的 Overlay 域实现页面元素和区域的高亮标注
 * AI 操作时可视化标注目标元素，让用户观察到 AI 的操作对象
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

/** 确保 DOM + Overlay 域已启用 */
const ensureOverlayEnabled = async (tabId: number): Promise<{ success: boolean; error?: string }> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) {
    return { success: false, error: `Unable to connect debugger: ${attachResult.error}` };
  }
  // Overlay 域需要 DOM 域先启用
  await CDPSessionManager.sendCommand(tabId, 'DOM.enable', {});
  const overlayResult = await CDPSessionManager.sendCommand(tabId, 'Overlay.enable', {});
  if (!overlayResult.success) {
    return { success: false, error: `Failed to enable Overlay domain: ${overlayResult.error}` };
  }
  return { success: true };
};

/** 获取文档根节点 nodeId */
const getDocumentNodeId = async (tabId: number): Promise<number | null> => {
  const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getDocument', { depth: 0 });
  return result.result?.root?.nodeId || null;
};

/** 解析颜色参数为 RGBA 对象 */
const parseColor = (color?: string, defaultColor?: { r: number; g: number; b: number; a: number }) => {
  const fallback = defaultColor || { r: 111, g: 168, b: 220, a: 0.66 };
  if (!color) return fallback;

  // 支持 hex 格式 (#RRGGBB 或 #RRGGBBAA)
  const hexMatch = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1], 16),
      g: parseInt(hexMatch[2], 16),
      b: parseInt(hexMatch[3], 16),
      a: hexMatch[4] ? parseInt(hexMatch[4], 16) / 255 : 0.66,
    };
  }

  // 支持 rgba 格式
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 0.66,
    };
  }

  return fallback;
};

export const cdpOverlayFunction: FunctionDefinition = {
  name: 'cdp_overlay',
  description: 'Visual highlight annotation tool (CDP Overlay domain). Highlight page elements or specified regions so the user can visually see what the AI is operating on. Supports custom highlight colors. Useful for annotating target elements before screenshots, helping users locate elements, and performing visual operations with cdp_input.',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['highlight_node', 'highlight_selector', 'highlight_rect', 'hide'],
        description: 'Action type: highlight_node=highlight element by nodeId, highlight_selector=highlight by CSS selector, highlight_rect=highlight a rectangular region, hide=hide all highlights',
      },
      node_id: {
        type: 'number',
        description: 'Node ID for highlight_node.',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for highlight_selector.',
      },
      // highlight_rect 参数
      x: {
        type: 'number',
        description: 'Top-left x coordinate of the rectangle (viewport coordinates).',
      },
      y: {
        type: 'number',
        description: 'Top-left y coordinate of the rectangle (viewport coordinates).',
      },
      width: {
        type: 'number',
        description: 'Rectangle width.',
      },
      height: {
        type: 'number',
        description: 'Rectangle height.',
      },
      // 样式参数
      content_color: {
        type: 'string',
        description: 'Content area highlight color (hex e.g. "#FF000066" or rgba e.g. "rgba(255,0,0,0.4)"). Default: semi-transparent blue.',
      },
      border_color: {
        type: 'string',
        description: 'Border highlight color. Default: blue.',
      },
      padding_color: {
        type: 'string',
        description: 'Padding area color. Default: semi-transparent green.',
      },
      margin_color: {
        type: 'string',
        description: 'Margin area color. Default: semi-transparent orange.',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID. Uses the current active tab if omitted.',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return 'Missing action parameter';
    const validActions = ['highlight_node', 'highlight_selector', 'highlight_rect', 'hide'];
    if (!validActions.includes(action)) {
      return `Unsupported action: ${action}`;
    }
    if (action === 'highlight_node' && typeof params.node_id !== 'number') {
      return 'highlight_node requires node_id parameter (number type)';
    }
    if (action === 'highlight_selector' && !params.selector) {
      return 'highlight_selector requires selector parameter';
    }
    if (action === 'highlight_rect') {
      if (params.x === undefined || params.y === undefined) return 'highlight_rect requires x and y parameters';
      if (!params.width || !params.height) return 'highlight_rect requires width and height parameters';
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      node_id?: number;
      selector?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      content_color?: string;
      border_color?: string;
      padding_color?: string;
      margin_color?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, tab_id } = params;

    // 检查取消信号
    if (context?.signal?.aborted) {
      return { success: false, error: '操作已取消' };
    }

    // 确定目标 tabId
    let tabId: number;
    if (typeof tab_id === 'number' && tab_id > 0) {
      tabId = tab_id;
    } else if (typeof context?.tabId === 'number' && context.tabId > 0) {
      tabId = context.tabId;
    } else {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        return { success: false, error: 'Unable to determine target tab' };
      }
      tabId = activeTabId;
    }

    // 确保 Overlay 域已启用
    const ready = await ensureOverlayEnabled(tabId);
    if (!ready.success) {
      return { success: false, error: ready.error! };
    }

    // 构建高亮配置
    const highlightConfig: Record<string, any> = {
      showInfo: true,
      showStyles: true,
      showExtensionLines: false,
      contentColor: parseColor(params.content_color, { r: 111, g: 168, b: 220, a: 0.66 }),
      paddingColor: parseColor(params.padding_color, { r: 147, g: 196, b: 125, a: 0.55 }),
      borderColor: parseColor(params.border_color, { r: 255, g: 229, b: 153, a: 0.75 }),
      marginColor: parseColor(params.margin_color, { r: 246, g: 178, b: 107, a: 0.66 }),
    };

    switch (action) {
      case 'highlight_node': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Overlay.highlightNode', {
          highlightConfig,
          nodeId: params.node_id,
        });
        if (!result.success) {
          return { success: false, error: `Failed to highlight node: ${result.error}` };
        }
        return {
          success: true,
          data: {
            node_id: params.node_id,
            message: `Highlighted node ${params.node_id}`,
          },
        };
      }

      case 'highlight_selector': {
        // 先通过选择器找到 nodeId
        const docNodeId = await getDocumentNodeId(tabId);
        if (!docNodeId) {
          return { success: false, error: 'Unable to get document root node' };
        }
        const queryResult = await CDPSessionManager.sendCommand(tabId, 'DOM.querySelector', {
          nodeId: docNodeId,
          selector: params.selector,
        });
        if (!queryResult.success) {
          return { success: false, error: `Failed to query selector: ${queryResult.error}` };
        }
        const nodeId = queryResult.result?.nodeId;
        if (!nodeId || nodeId === 0) {
          return { success: false, error: `No element found matching "${params.selector}"` };
        }

        const result = await CDPSessionManager.sendCommand(tabId, 'Overlay.highlightNode', {
          highlightConfig,
          nodeId,
        });
        if (!result.success) {
          return { success: false, error: `Failed to highlight element: ${result.error}` };
        }
        return {
          success: true,
          data: {
            selector: params.selector,
            node_id: nodeId,
            message: `Highlighted element matching "${params.selector}"`,
          },
        };
      }

      case 'highlight_rect': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Overlay.highlightRect', {
          x: Math.floor(params.x!),
          y: Math.floor(params.y!),
          width: Math.floor(params.width!),
          height: Math.floor(params.height!),
          color: parseColor(params.content_color, { r: 111, g: 168, b: 220, a: 0.66 }),
          outlineColor: parseColor(params.border_color, { r: 255, g: 0, b: 0, a: 1 }),
        });
        if (!result.success) {
          return { success: false, error: `Failed to highlight rect: ${result.error}` };
        }
        return {
          success: true,
          data: {
            rect: { x: params.x, y: params.y, width: params.width, height: params.height },
            message: `Highlighted rect (${params.x}, ${params.y}) ${params.width}x${params.height}`,
          },
        };
      }

      case 'hide': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Overlay.hideHighlight', {});
        if (!result.success) {
          return { success: false, error: `Failed to hide highlight: ${result.error}` };
        }
        return {
          success: true,
          data: { message: 'All highlights hidden' },
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};
