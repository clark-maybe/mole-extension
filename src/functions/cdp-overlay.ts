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
    return { success: false, error: `无法连接调试器: ${attachResult.error}` };
  }
  // Overlay 域需要 DOM 域先启用
  await CDPSessionManager.sendCommand(tabId, 'DOM.enable', {});
  const overlayResult = await CDPSessionManager.sendCommand(tabId, 'Overlay.enable', {});
  if (!overlayResult.success) {
    return { success: false, error: `启用 Overlay 域失败: ${overlayResult.error}` };
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
  description: '视觉高亮标注工具（CDP Overlay 域）。高亮页面元素或指定区域，让用户直观看到 AI 正在操作的对象。支持自定义高亮颜色。适用于标注目标元素后截图、辅助用户定位元素、配合 cdp_input 进行可视化操作。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['highlight_node', 'highlight_selector', 'highlight_rect', 'hide'],
        description: '操作类型：highlight_node=高亮指定nodeId元素, highlight_selector=通过CSS选择器高亮, highlight_rect=高亮矩形区域, hide=隐藏所有高亮',
      },
      node_id: {
        type: 'number',
        description: 'highlight_node 的节点 ID',
      },
      selector: {
        type: 'string',
        description: 'highlight_selector 的 CSS 选择器',
      },
      // highlight_rect 参数
      x: {
        type: 'number',
        description: '矩形左上角 x 坐标（视口坐标）',
      },
      y: {
        type: 'number',
        description: '矩形左上角 y 坐标（视口坐标）',
      },
      width: {
        type: 'number',
        description: '矩形宽度',
      },
      height: {
        type: 'number',
        description: '矩形高度',
      },
      // 样式参数
      content_color: {
        type: 'string',
        description: '内容区域高亮颜色（hex 如 "#FF000066" 或 rgba 如 "rgba(255,0,0,0.4)"），默认蓝色半透明',
      },
      border_color: {
        type: 'string',
        description: '边框高亮颜色，默认蓝色',
      },
      padding_color: {
        type: 'string',
        description: 'padding 区域颜色，默认绿色半透明',
      },
      margin_color: {
        type: 'string',
        description: 'margin 区域颜色，默认橙色半透明',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID，不传则使用当前活动标签页',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return '缺少 action 参数';
    const validActions = ['highlight_node', 'highlight_selector', 'highlight_rect', 'hide'];
    if (!validActions.includes(action)) {
      return `不支持的 action: ${action}`;
    }
    if (action === 'highlight_node' && typeof params.node_id !== 'number') {
      return 'highlight_node 需要 node_id 参数（数字类型）';
    }
    if (action === 'highlight_selector' && !params.selector) {
      return 'highlight_selector 需要 selector 参数';
    }
    if (action === 'highlight_rect') {
      if (params.x === undefined || params.y === undefined) return 'highlight_rect 需要 x 和 y 参数';
      if (!params.width || !params.height) return 'highlight_rect 需要 width 和 height 参数';
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
          return { success: false, error: `高亮节点失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            node_id: params.node_id,
            message: `已高亮节点 ${params.node_id}`,
          },
        };
      }

      case 'highlight_selector': {
        // 先通过选择器找到 nodeId
        const docNodeId = await getDocumentNodeId(tabId);
        if (!docNodeId) {
          return { success: false, error: '无法获取文档根节点' };
        }
        const queryResult = await CDPSessionManager.sendCommand(tabId, 'DOM.querySelector', {
          nodeId: docNodeId,
          selector: params.selector,
        });
        if (!queryResult.success) {
          return { success: false, error: `查询选择器失败: ${queryResult.error}` };
        }
        const nodeId = queryResult.result?.nodeId;
        if (!nodeId || nodeId === 0) {
          return { success: false, error: `未找到匹配 "${params.selector}" 的元素` };
        }

        const result = await CDPSessionManager.sendCommand(tabId, 'Overlay.highlightNode', {
          highlightConfig,
          nodeId,
        });
        if (!result.success) {
          return { success: false, error: `高亮元素失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            selector: params.selector,
            node_id: nodeId,
            message: `已高亮 "${params.selector}" 对应的元素`,
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
          return { success: false, error: `高亮区域失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            rect: { x: params.x, y: params.y, width: params.width, height: params.height },
            message: `已高亮区域 (${params.x}, ${params.y}) ${params.width}x${params.height}`,
          },
        };
      }

      case 'hide': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Overlay.hideHighlight', {});
        if (!result.success) {
          return { success: false, error: `隐藏高亮失败: ${result.error}` };
        }
        return {
          success: true,
          data: { message: '所有高亮已隐藏' },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
