/**
 * CDP DOM 操作工具
 * 通过 chrome.debugger 的 DOM 域实现跨域 DOM 查询与修改
 * 可无视同源策略直接操作页面 DOM（包括跨域 iframe 内的节点）
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

/** 确保 DOM 域已启用 */
const ensureDOMEnabled = async (tabId: number): Promise<{ success: boolean; error?: string }> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) {
    return { success: false, error: `无法连接调试器: ${attachResult.error}` };
  }
  const enableResult = await CDPSessionManager.sendCommand(tabId, 'DOM.enable', {});
  if (!enableResult.success) {
    return { success: false, error: `启用 DOM 域失败: ${enableResult.error}` };
  }
  return { success: true };
};

/** 获取文档根节点 nodeId */
const getDocumentNodeId = async (tabId: number): Promise<{ success: boolean; nodeId?: number; error?: string }> => {
  const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getDocument', { depth: 0 });
  if (!result.success) {
    return { success: false, error: `获取文档根节点失败: ${result.error}` };
  }
  const nodeId = result.result?.root?.nodeId;
  if (!nodeId) {
    return { success: false, error: '无法获取文档根节点 nodeId' };
  }
  return { success: true, nodeId };
};

export const cdpDomFunction: FunctionDefinition = {
  name: 'cdp_dom',
  description: 'DOM 深度操作工具（CDP DOM 域）。跨域查询/修改 DOM 节点，获取元素精确几何信息（box model）、属性读写、HTML 读写、节点删除。比 content script 的 DOM API 更底层，可操作跨域 iframe 内的节点。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['query_selector', 'query_selector_all', 'get_outer_html', 'get_attributes', 'get_box_model', 'set_attribute', 'remove_attribute', 'set_outer_html', 'remove_node', 'get_document'],
        description: '操作类型：query_selector=CSS选择器查询, query_selector_all=查询所有匹配, get_outer_html=获取HTML, get_attributes=获取属性, get_box_model=获取几何信息, set_attribute=设置属性, remove_attribute=删除属性, set_outer_html=修改HTML, remove_node=删除节点, get_document=获取文档结构',
      },
      selector: {
        type: 'string',
        description: 'CSS 选择器（query_selector/query_selector_all 必填）',
      },
      node_id: {
        type: 'number',
        description: '目标节点 ID（get_outer_html/get_attributes/get_box_model/set_attribute/set_outer_html/remove_node 使用）。通过 query_selector 获取。',
      },
      name: {
        type: 'string',
        description: 'set_attribute/remove_attribute 的属性名',
      },
      value: {
        type: 'string',
        description: 'set_attribute 的属性值',
      },
      outer_html: {
        type: 'string',
        description: 'set_outer_html 的新 HTML 内容',
      },
      depth: {
        type: 'number',
        description: 'get_document 时的遍历深度，默认 2（-1 表示完整遍历）',
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
    const validActions = ['query_selector', 'query_selector_all', 'get_outer_html', 'get_attributes', 'get_box_model', 'set_attribute', 'remove_attribute', 'set_outer_html', 'remove_node', 'get_document'];
    if (!validActions.includes(action)) {
      return `不支持的 action: ${action}`;
    }
    if (['query_selector', 'query_selector_all'].includes(action) && !params.selector) {
      return `${action} 需要 selector 参数`;
    }
    if (['get_outer_html', 'get_attributes', 'get_box_model', 'set_attribute', 'remove_attribute', 'set_outer_html', 'remove_node'].includes(action)) {
      if (typeof params.node_id !== 'number') {
        return `${action} 需要 node_id 参数（数字类型）`;
      }
    }
    if (action === 'set_attribute') {
      if (!params.name) return 'set_attribute 需要 name 参数';
      if (params.value === undefined) return 'set_attribute 需要 value 参数';
    }
    if (action === 'remove_attribute' && !params.name) {
      return 'remove_attribute 需要 name 参数';
    }
    if (action === 'set_outer_html' && !params.outer_html) {
      return 'set_outer_html 需要 outer_html 参数';
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      selector?: string;
      node_id?: number;
      name?: string;
      value?: string;
      outer_html?: string;
      depth?: number;
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

    // 确保 DOM 域已启用
    const domReady = await ensureDOMEnabled(tabId);
    if (!domReady.success) {
      return { success: false, error: domReady.error! };
    }

    switch (action) {
      case 'get_document': {
        const depth = params.depth ?? 2;
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getDocument', {
          depth,
          pierce: true,
        });
        if (!result.success) {
          return { success: false, error: `获取文档结构失败: ${result.error}` };
        }
        // 简化输出，只保留关键字段
        const simplifyNode = (node: any, maxDepth: number, currentDepth: number = 0): any => {
          if (!node) return null;
          const simplified: any = {
            nodeId: node.nodeId,
            nodeType: node.nodeType,
            nodeName: node.nodeName,
          };
          if (node.attributes?.length) {
            const attrs: Record<string, string> = {};
            for (let i = 0; i < node.attributes.length; i += 2) {
              attrs[node.attributes[i]] = node.attributes[i + 1] || '';
            }
            simplified.attributes = attrs;
          }
          if (node.nodeValue) simplified.nodeValue = node.nodeValue.substring(0, 200);
          if (node.childNodeCount !== undefined) simplified.childNodeCount = node.childNodeCount;
          if (node.children && currentDepth < maxDepth) {
            simplified.children = node.children.map((c: any) => simplifyNode(c, maxDepth, currentDepth + 1));
          }
          return simplified;
        };
        return {
          success: true,
          data: {
            document: simplifyNode(result.result?.root, depth === -1 ? 999 : depth),
            message: '文档结构已获取',
          },
        };
      }

      case 'query_selector': {
        const docResult = await getDocumentNodeId(tabId);
        if (!docResult.success) {
          return { success: false, error: docResult.error! };
        }
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.querySelector', {
          nodeId: docResult.nodeId,
          selector: params.selector,
        });
        if (!result.success) {
          return { success: false, error: `查询失败: ${result.error}` };
        }
        const nodeId = result.result?.nodeId;
        if (!nodeId || nodeId === 0) {
          return {
            success: true,
            data: { node_id: null, message: `未找到匹配 "${params.selector}" 的元素` },
          };
        }
        return {
          success: true,
          data: {
            node_id: nodeId,
            selector: params.selector,
            message: `找到匹配元素，node_id=${nodeId}`,
          },
        };
      }

      case 'query_selector_all': {
        const docResult = await getDocumentNodeId(tabId);
        if (!docResult.success) {
          return { success: false, error: docResult.error! };
        }
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.querySelectorAll', {
          nodeId: docResult.nodeId,
          selector: params.selector,
        });
        if (!result.success) {
          return { success: false, error: `查询失败: ${result.error}` };
        }
        const nodeIds: number[] = result.result?.nodeIds || [];
        return {
          success: true,
          data: {
            node_ids: nodeIds,
            total: nodeIds.length,
            selector: params.selector,
            message: nodeIds.length > 0
              ? `找到 ${nodeIds.length} 个匹配元素`
              : `未找到匹配 "${params.selector}" 的元素`,
          },
        };
      }

      case 'get_outer_html': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getOuterHTML', {
          nodeId: params.node_id,
        });
        if (!result.success) {
          return { success: false, error: `获取 HTML 失败: ${result.error}` };
        }
        let html = result.result?.outerHTML || '';
        const truncated = html.length > 50000;
        if (truncated) html = html.substring(0, 50000);
        return {
          success: true,
          data: {
            node_id: params.node_id,
            outer_html: html,
            length: result.result?.outerHTML?.length || 0,
            truncated,
            message: truncated ? 'HTML 内容已截断至 50000 字符' : '获取 HTML 成功',
          },
        };
      }

      case 'get_attributes': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getAttributes', {
          nodeId: params.node_id,
        });
        if (!result.success) {
          return { success: false, error: `获取属性失败: ${result.error}` };
        }
        const rawAttrs: string[] = result.result?.attributes || [];
        const attributes: Record<string, string> = {};
        for (let i = 0; i < rawAttrs.length; i += 2) {
          attributes[rawAttrs[i]] = rawAttrs[i + 1] || '';
        }
        return {
          success: true,
          data: {
            node_id: params.node_id,
            attributes,
            count: Object.keys(attributes).length,
            message: `获取到 ${Object.keys(attributes).length} 个属性`,
          },
        };
      }

      case 'get_box_model': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getBoxModel', {
          nodeId: params.node_id,
        });
        if (!result.success) {
          return { success: false, error: `获取 box model 失败: ${result.error}` };
        }
        const model = result.result?.model;
        if (!model) {
          return { success: false, error: '无法获取元素的几何信息（可能是不可见元素）' };
        }
        // 将 quad 数组转为可读格式
        const quadToRect = (quad: number[]) => {
          if (!quad || quad.length < 8) return null;
          return {
            x: quad[0],
            y: quad[1],
            width: quad[2] - quad[0],
            height: quad[5] - quad[1],
          };
        };
        return {
          success: true,
          data: {
            node_id: params.node_id,
            content: quadToRect(model.content),
            padding: quadToRect(model.padding),
            border: quadToRect(model.border),
            margin: quadToRect(model.margin),
            width: model.width,
            height: model.height,
            message: `元素尺寸: ${model.width}x${model.height}`,
          },
        };
      }

      case 'set_attribute': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.setAttributeValue', {
          nodeId: params.node_id,
          name: params.name,
          value: params.value,
        });
        if (!result.success) {
          return { success: false, error: `设置属性失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            node_id: params.node_id,
            name: params.name,
            value: params.value,
            message: `属性 "${params.name}" 已设置为 "${params.value}"`,
          },
        };
      }

      case 'remove_attribute': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.removeAttribute', {
          nodeId: params.node_id,
          name: params.name,
        });
        if (!result.success) {
          return { success: false, error: `删除属性失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            node_id: params.node_id,
            name: params.name,
            message: `属性 "${params.name}" 已删除`,
          },
        };
      }

      case 'set_outer_html': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.setOuterHTML', {
          nodeId: params.node_id,
          outerHTML: params.outer_html,
        });
        if (!result.success) {
          return { success: false, error: `修改 HTML 失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            node_id: params.node_id,
            message: 'HTML 内容已修改',
          },
        };
      }

      case 'remove_node': {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOM.removeNode', {
          nodeId: params.node_id,
        });
        if (!result.success) {
          return { success: false, error: `删除节点失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            node_id: params.node_id,
            message: '节点已删除',
          },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
