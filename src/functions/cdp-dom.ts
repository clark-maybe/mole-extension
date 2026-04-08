/**
 * CDP DOM 操作工具（增强版）
 * 统一的 DOM 读写、CSS 样式、页面存储操作入口
 * 通过 chrome.debugger 的 DOM / CSS / DOMStorage 域实现跨域操作
 *
 * DOM 操作组：query_selector / get_outer_html / set_attribute / remove_node / get_text / set_text / get_html / set_html / insert_html / add_class / remove_class / set_inline_style 等
 * CSS 样式组（css_ 前缀）：css_get_computed_style / css_get_matched_rules / css_set_style / css_add_rule / css_get_stylesheets 等
 * 页面存储组（storage_ 前缀）：storage_get_items / storage_get_item / storage_set_item / storage_remove_item / storage_clear
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { CDPSessionManager } from '../lib/cdp-session';

// ==================== 所有 action 枚举 ====================
const ALL_ACTIONS = [
  // 原有 DOM 域操作
  'query_selector', 'query_selector_all', 'get_outer_html', 'get_attributes', 'get_box_model',
  'set_attribute', 'remove_attribute', 'set_outer_html', 'remove_node', 'get_document',
  // 新增 DOM 操作组（Runtime.evaluate）
  'get_text', 'set_text', 'get_html', 'set_html', 'insert_html',
  'set_inline_style', 'get_computed_style_simple',
  'add_class', 'remove_class', 'toggle_class',
  'clone_element', 'wait_for',
  // CSS 域操作组
  'css_get_computed_style', 'css_get_matched_rules', 'css_set_style', 'css_add_rule',
  'css_get_stylesheets', 'css_get_stylesheet', 'css_set_stylesheet',
  // Storage 域操作组
  'storage_get_items', 'storage_get_item', 'storage_set_item', 'storage_remove_item', 'storage_clear',
] as const;

// ==================== 辅助函数 ====================

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

/** 通用域启用函数 */
const ensureDomainsEnabled = async (tabId: number, domains: string[]): Promise<{ success: boolean; error?: string }> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) {
    return { success: false, error: `无法连接调试器: ${attachResult.error}` };
  }
  for (const domain of domains) {
    const result = await CDPSessionManager.sendCommand(tabId, `${domain}.enable`, {});
    if (!result.success) {
      return { success: false, error: `启用 ${domain} 域失败: ${result.error}` };
    }
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

/** 通过选择器查找 nodeId（支持 selector 自动解析为 nodeId） */
const resolveNodeId = async (tabId: number, selector?: string, nodeId?: number): Promise<{ success: boolean; nodeId?: number; error?: string }> => {
  if (typeof nodeId === 'number' && nodeId > 0) {
    return { success: true, nodeId };
  }
  if (selector) {
    const docResult = await getDocumentNodeId(tabId);
    if (!docResult.success) return { success: false, error: docResult.error };
    const result = await CDPSessionManager.sendCommand(tabId, 'DOM.querySelector', {
      nodeId: docResult.nodeId,
      selector,
    });
    if (!result.success) return { success: false, error: `查询选择器失败: ${result.error}` };
    const nid = result.result?.nodeId;
    if (!nid || nid === 0) return { success: false, error: `未找到匹配 "${selector}" 的元素` };
    return { success: true, nodeId: nid };
  }
  return { success: false, error: '需要 node_id 或 selector 参数来定位元素' };
};

/** 获取页面的 securityOrigin */
const getSecurityOrigin = async (tabId: number): Promise<string | null> => {
  const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression: 'location.origin',
    returnByValue: true,
  });
  if (result.success && result.result?.result?.value) {
    return result.result.result.value;
  }
  return null;
};

/** 构建 storageId 对象 */
const buildStorageId = (securityOrigin: string, isLocalStorage: boolean) => ({
  securityOrigin,
  isLocalStorage,
});

/** 通过 Runtime.evaluate 在页面执行 DOM 操作 */
const evaluateDOM = async (
  tabId: number,
  selector: string | undefined,
  jsCode: string, // 代码中用 __el__ 引用元素，用 __els__ 引用元素数组
  options?: { all?: boolean; limit?: number },
): Promise<FunctionResult> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) return { success: false, error: `连接调试器失败: ${attachResult.error}` };

  if (!selector) return { success: false, error: '需要 selector 参数' };

  const all = options?.all === true;
  const limit = options?.limit || 20;

  const expression = all
    ? `(function() {
        const __els__ = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0, ${limit});
        if (__els__.length === 0) return { success: false, error: '未找到匹配的元素' };
        ${jsCode}
      })()`
    : `(function() {
        const __el__ = document.querySelector(${JSON.stringify(selector)});
        if (!__el__) return { success: false, error: '未找到匹配 "${selector}" 的元素' };
        ${jsCode}
      })()`;

  const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });

  if (!result.success) return { success: false, error: result.error };
  const value = result.result?.result?.value;
  if (!value) return { success: false, error: '执行结果为空' };
  if (typeof value === 'object' && value.success === false) {
    return { success: false, error: value.error || 'DOM 操作失败' };
  }
  return { success: true, data: value };
};

/** 通过 node_id 使用 Runtime.evaluate 操作元素（先通过 DOM.resolveNode 获取 objectId） */
const evaluateDOMByNodeId = async (
  tabId: number,
  nodeId: number,
  jsCode: string, // 代码中用 __el__ 引用元素
): Promise<FunctionResult> => {
  // 通过 DOM.resolveNode 获取 Runtime 对象引用
  const resolveResult = await CDPSessionManager.sendCommand(tabId, 'DOM.resolveNode', {
    nodeId,
  });
  if (!resolveResult.success) {
    return { success: false, error: `解析节点失败: ${resolveResult.error}` };
  }
  const objectId = resolveResult.result?.object?.objectId;
  if (!objectId) {
    return { success: false, error: '无法获取节点的运行时引用' };
  }

  // 使用 Runtime.callFunctionOn 在目标对象上执行代码
  const callResult = await CDPSessionManager.sendCommand(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function() { const __el__ = this; ${jsCode} }`,
    returnByValue: true,
  });
  if (!callResult.success) return { success: false, error: callResult.error };
  const value = callResult.result?.result?.value;
  if (!value) return { success: false, error: '执行结果为空' };
  if (typeof value === 'object' && value.success === false) {
    return { success: false, error: value.error || 'DOM 操作失败' };
  }
  return { success: true, data: value };
};

// ==================== 工具定义 ====================

export const cdpDomFunction: FunctionDefinition = {
  name: 'cdp_dom',
  description: [
    'Read and write page DOM elements, CSS styles, and page storage.',
    'DOM operations: query_selector/get_text/set_text/get_html/set_html/insert_html/set_attribute/remove_node/add_class/remove_class/set_inline_style/clone_element/wait_for, etc.',
    'CSS styles (css_ prefix): css_get_computed_style/css_get_matched_rules/css_set_style/css_add_rule, etc.',
    'Page storage (storage_ prefix): storage_get_items/storage_get_item/storage_set_item/storage_remove_item/storage_clear.',
    'Targeting: selector (CSS selector) or node_id.',
  ].join(' ') + '\n\n⚠️ Do NOT use this tool for:\n- Click or input operations (use cdp_input)\n- Reading page body content (use page_viewer)',
  supportsParallel: true,
  permissionLevel: 'interact',
  actionPermissions: {
    storage_get_items: 'sensitive',
    storage_get_item: 'sensitive',
    storage_set_item: 'sensitive',
    storage_remove_item: 'sensitive',
    storage_clear: 'dangerous',
    set_html: 'sensitive',
    set_text: 'sensitive',
    insert_html: 'sensitive',
    remove_node: 'sensitive',
    set_outer_html: 'sensitive',
  },
  approvalMessageTemplate: {
    storage_get_items: 'AI 正在请求读取页面 {storage_type}Storage 数据',
    storage_get_item: 'AI 正在请求读取页面 {storage_type}Storage 数据',
    storage_set_item: 'AI 正在请求写入页面 {storage_type}Storage（key: {key}）',
    storage_remove_item: 'AI 正在请求删除页面 {storage_type}Storage 中的 "{key}"',
    storage_clear: 'AI 正在请求清空页面的 {storage_type}Storage',
    set_html: 'AI 正在请求修改页面内容（set_html）',
    set_text: 'AI 正在请求修改页面内容（set_text）',
    insert_html: 'AI 正在请求修改页面内容（insert_html）',
    remove_node: 'AI 正在请求删除页面元素',
    set_outer_html: 'AI 正在请求替换页面元素',
  },
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...ALL_ACTIONS],
        description: 'Action type. DOM operations: query_selector/query_selector_all/get_outer_html/get_attributes/get_box_model/set_attribute/remove_attribute/set_outer_html/remove_node/get_document/get_text/set_text/get_html/set_html/insert_html/set_inline_style/get_computed_style_simple/add_class/remove_class/toggle_class/clone_element/wait_for. CSS styles: css_get_computed_style/css_get_matched_rules/css_set_style/css_add_rule/css_get_stylesheets/css_get_stylesheet/css_set_stylesheet. Page storage: storage_get_items/storage_get_item/storage_set_item/storage_remove_item/storage_clear.',
      },
      selector: {
        type: 'string',
        description: 'CSS selector (required for query_selector/query_selector_all, can substitute node_id for other actions)',
      },
      node_id: {
        type: 'number',
        description: 'Target node ID (obtained via query_selector). Most actions also support selector as alternative.',
      },
      name: {
        type: 'string',
        description: 'Attribute name for set_attribute/remove_attribute',
      },
      value: {
        type: 'string',
        description: 'Multi-purpose value parameter: attribute value for set_attribute / content for set_text/set_html/insert_html / class names (space-separated) for add_class/remove_class/toggle_class / value for storage_set_item',
      },
      outer_html: {
        type: 'string',
        description: 'New HTML content for set_outer_html',
      },
      depth: {
        type: 'number',
        description: 'Traversal depth for get_document, default 2 (-1 for full traversal)',
      },
      all: {
        type: 'boolean',
        description: 'Batch operation flag. Operates on all matching elements for get_text/set_text/get_html/set_html/insert_html/set_inline_style/add_class/remove_class/toggle_class, default false',
      },
      outer: {
        type: 'boolean',
        description: 'Whether get_html returns outerHTML (including the element tag itself), default false (returns innerHTML)',
      },
      position: {
        type: 'string',
        enum: ['beforebegin', 'afterbegin', 'beforeend', 'afterend'],
        description: 'Insertion position for insert_html/clone_element, default beforeend',
      },
      new_id: {
        type: 'string',
        description: 'New ID for clone_element to assign to the clone (to avoid duplicates)',
      },
      styles: {
        type: 'object',
        description: 'Style object for set_inline_style, e.g. {"color":"red","display":"none"}',
      },
      property: {
        type: 'string',
        description: 'CSS property name for get_computed_style_simple (required)',
      },
      limit: {
        type: 'number',
        description: 'Result limit for query operations, default 20',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds for wait_for, default 5000',
      },
      // CSS 域参数
      properties: {
        type: 'array',
        items: { type: 'string' },
        description: 'Return only specified properties for css_get_computed_style (e.g. ["color", "font-size"]), returns all if not provided',
      },
      style_text: {
        type: 'string',
        description: 'CSS text for css_set_style (e.g. "color: red; font-size: 16px;")',
      },
      rule_selector: {
        type: 'string',
        description: 'CSS selector for css_add_rule (e.g. ".my-class", "#my-id")',
      },
      rule_text: {
        type: 'string',
        description: 'CSS rule text for css_add_rule (e.g. "color: red; display: none;")',
      },
      stylesheet_id: {
        type: 'string',
        description: 'Stylesheet ID (obtained from css_get_matched_rules or css_get_stylesheets)',
      },
      stylesheet_text: {
        type: 'string',
        description: 'New stylesheet content for css_set_stylesheet',
      },
      // Storage 域参数
      storage_type: {
        type: 'string',
        enum: ['local', 'session'],
        description: 'Storage type: local=localStorage (default), session=sessionStorage',
      },
      key: {
        type: 'string',
        description: 'Key name for storage_get_item/storage_set_item/storage_remove_item',
      },
      security_origin: {
        type: 'string',
        description: 'Target page origin (e.g. "https://example.com"), auto-detected if not provided',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID, uses current active tab if not provided',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return 'Missing action parameter';
    if (!(ALL_ACTIONS as readonly string[]).includes(action)) {
      return `Unsupported action: ${action}`;
    }

    // 原有 DOM 域操作校验
    if (['query_selector', 'query_selector_all'].includes(action) && !params.selector) {
      return `${action} requires selector parameter`;
    }
    if (['get_outer_html', 'get_attributes', 'get_box_model', 'set_attribute', 'remove_attribute', 'set_outer_html', 'remove_node'].includes(action)) {
      if (typeof params.node_id !== 'number') {
        return `${action} requires node_id parameter (number type)`;
      }
    }
    if (action === 'set_attribute') {
      if (!params.name) return 'set_attribute requires name parameter';
      if (params.value === undefined) return 'set_attribute requires value parameter';
    }
    if (action === 'remove_attribute' && !params.name) {
      return 'remove_attribute requires name parameter';
    }
    if (action === 'set_outer_html' && !params.outer_html) {
      return 'set_outer_html requires outer_html parameter';
    }

    // 新增 DOM 操作组校验（需要 selector 或 node_id）
    if (['get_text', 'set_text', 'get_html', 'set_html', 'insert_html', 'set_inline_style', 'get_computed_style_simple', 'add_class', 'remove_class', 'toggle_class', 'clone_element'].includes(action)) {
      if (!params.selector && typeof params.node_id !== 'number') {
        return `${action} requires selector or node_id parameter`;
      }
    }
    if (action === 'insert_html' && params.value === undefined) {
      return 'insert_html requires value parameter (HTML content)';
    }
    if (action === 'set_inline_style') {
      if (!params.styles || typeof params.styles !== 'object') {
        return 'set_inline_style requires styles parameter (object format)';
      }
    }
    if (action === 'get_computed_style_simple' && !params.property) {
      return 'get_computed_style_simple requires property parameter';
    }
    if (['add_class', 'remove_class', 'toggle_class'].includes(action) && !params.value) {
      return `${action} requires value parameter (space-separated class names)`;
    }
    if (action === 'wait_for' && !params.selector) {
      return 'wait_for requires selector parameter';
    }

    // CSS 域操作校验
    if (['css_get_computed_style', 'css_get_matched_rules', 'css_set_style'].includes(action)) {
      if (typeof params.node_id !== 'number' && !params.selector) {
        return `${action} requires node_id or selector parameter`;
      }
    }
    if (action === 'css_set_style' && !params.style_text) {
      return 'css_set_style requires style_text parameter';
    }
    if (action === 'css_add_rule') {
      if (!params.rule_selector) return 'css_add_rule requires rule_selector parameter';
      if (!params.rule_text) return 'css_add_rule requires rule_text parameter';
    }
    if (action === 'css_get_stylesheet' && !params.stylesheet_id) {
      return 'css_get_stylesheet requires stylesheet_id parameter';
    }
    if (action === 'css_set_stylesheet') {
      if (!params.stylesheet_id) return 'css_set_stylesheet requires stylesheet_id parameter';
      if (!params.stylesheet_text) return 'css_set_stylesheet requires stylesheet_text parameter';
    }

    // Storage 域操作校验
    if (['storage_get_item', 'storage_remove_item'].includes(action) && !params.key) {
      return `${action} requires key parameter`;
    }
    if (action === 'storage_set_item') {
      if (!params.key) return 'storage_set_item requires key parameter';
      if (params.value === undefined) return 'storage_set_item requires value parameter';
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
      all?: boolean;
      outer?: boolean;
      position?: string;
      new_id?: string;
      styles?: Record<string, string>;
      property?: string;
      limit?: number;
      timeout?: number;
      properties?: string[];
      style_text?: string;
      rule_selector?: string;
      rule_text?: string;
      stylesheet_id?: string;
      stylesheet_text?: string;
      storage_type?: string;
      key?: string;
      security_origin?: string;
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

    // 根据 action 前缀分发到不同的处理组
    if (action.startsWith('css_')) {
      return executeCSSAction(tabId, action, params);
    }
    if (action.startsWith('storage_')) {
      return executeStorageAction(tabId, action, params, context?.signal);
    }
    return executeDOMAction(tabId, action, params, context);
  },
};

// ==================== DOM 操作组 ====================

const executeDOMAction = async (
  tabId: number,
  action: string,
  params: any,
  context?: ToolExecutionContext,
): Promise<FunctionResult> => {
  // 确保 DOM 域已启用
  const domReady = await ensureDOMEnabled(tabId);
  if (!domReady.success) {
    return { success: false, error: domReady.error! };
  }

  switch (action) {
    // ============ 原有 DOM 域操作 ============
    case 'get_document': {
      const depth = params.depth ?? 2;
      const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getDocument', {
        depth,
        pierce: true,
      });
      if (!result.success) {
        return { success: false, error: `获取文档结构失败: ${result.error}` };
      }
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

    // ============ 新增 DOM 操作组（通过 Runtime.evaluate） ============

    case 'get_text': {
      // 如果有 node_id 且没有 selector，使用 node_id 路径
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `return { success: true, data: { text: (__el__.textContent || '').trim() } };`
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `return { success: true, data: { results: __els__.map(function(el, i) { return { index: i, text: (el.textContent || '').trim() }; }) } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `return { success: true, data: { text: (__el__.textContent || '').trim() } };`
      );
    }

    case 'set_text': {
      const textValue = params.value ?? '';
      const valueStr = JSON.stringify(textValue);
      const moleRootProtection = `
        var moleRoot = document.getElementById('mole-root');
        if (moleRoot && !document.body.contains(moleRoot)) {
          document.body.appendChild(moleRoot);
        }
      `;
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `__el__.textContent = ${valueStr}; ${moleRootProtection} return { success: true, data: { message: '已设置元素的文本内容' } };`
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `__els__.forEach(function(el) { el.textContent = ${valueStr}; }); ${moleRootProtection} return { success: true, data: { message: '已设置 ' + __els__.length + ' 个元素的文本内容' } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `__el__.textContent = ${valueStr}; ${moleRootProtection} return { success: true, data: { message: '已设置元素的文本内容' } };`
      );
    }

    case 'get_html': {
      const useOuter = params.outer === true;
      // 如果有 node_id 且使用 outerHTML，可以直接用 DOM.getOuterHTML
      if (typeof params.node_id === 'number' && !params.selector && useOuter) {
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
          data: { html, length: result.result?.outerHTML?.length || 0, truncated },
        };
      }
      // node_id + innerHTML 路径
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `return { success: true, data: { html: __el__.innerHTML } };`
        );
      }
      const propName = useOuter ? 'outerHTML' : 'innerHTML';
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `return { success: true, data: { results: __els__.map(function(el, i) { return { index: i, html: el.${propName} }; }) } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `return { success: true, data: { html: __el__.${propName} } };`
      );
    }

    case 'set_html': {
      const htmlValue = params.value ?? '';
      const htmlStr = JSON.stringify(htmlValue);
      const moleRootProtection = `
        var moleRoot = document.getElementById('mole-root');
        if (moleRoot && !document.body.contains(moleRoot)) {
          document.body.appendChild(moleRoot);
        }
      `;
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `__el__.innerHTML = ${htmlStr}; ${moleRootProtection} return { success: true, data: { message: '已设置元素的 HTML' } };`
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `__els__.forEach(function(el) { el.innerHTML = ${htmlStr}; }); ${moleRootProtection} return { success: true, data: { message: '已设置 ' + __els__.length + ' 个元素的 HTML' } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `__el__.innerHTML = ${htmlStr}; ${moleRootProtection} return { success: true, data: { message: '已设置元素的 HTML' } };`
      );
    }

    case 'insert_html': {
      const htmlValue = params.value ?? '';
      const position = params.position || 'beforeend';
      const posStr = JSON.stringify(position);
      const htmlStr = JSON.stringify(htmlValue);
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `__el__.insertAdjacentHTML(${posStr}, ${htmlStr}); return { success: true, data: { message: '已在元素的 ' + ${posStr} + ' 位置插入 HTML' } };`
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `__els__.forEach(function(el) { el.insertAdjacentHTML(${posStr}, ${htmlStr}); }); return { success: true, data: { message: '已在 ' + __els__.length + ' 个元素的 ' + ${posStr} + ' 位置插入 HTML' } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `__el__.insertAdjacentHTML(${posStr}, ${htmlStr}); return { success: true, data: { message: '已在元素的 ' + ${posStr} + ' 位置插入 HTML' } };`
      );
    }

    case 'set_inline_style': {
      const stylesStr = JSON.stringify(params.styles || {});
      const code = `
        var styles = ${stylesStr};
        var entries = Object.entries(styles);
        for (var i = 0; i < entries.length; i++) {
          __TARGET__.style.setProperty(entries[i][0], String(entries[i][1]));
        }
        return { success: true, data: { message: '已设置__COUNT__的内联样式' } };
      `;
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          code.replace(/__TARGET__/g, '__el__').replace(/__COUNT__/g, '元素')
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `var styles = ${stylesStr}; var entries = Object.entries(styles); __els__.forEach(function(el) { for (var i = 0; i < entries.length; i++) { el.style.setProperty(entries[i][0], String(entries[i][1])); } }); return { success: true, data: { message: '已设置 ' + __els__.length + ' 个元素的内联样式' } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `var styles = ${stylesStr}; var entries = Object.entries(styles); for (var i = 0; i < entries.length; i++) { __el__.style.setProperty(entries[i][0], String(entries[i][1])); } return { success: true, data: { message: '已设置元素的内联样式' } };`
      );
    }

    case 'get_computed_style_simple': {
      const propStr = JSON.stringify(params.property || '');
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `var v = getComputedStyle(__el__).getPropertyValue(${propStr}); return { success: true, data: { property: ${propStr}, value: v } };`
        );
      }
      return evaluateDOM(tabId, params.selector,
        `var v = getComputedStyle(__el__).getPropertyValue(${propStr}); return { success: true, data: { property: ${propStr}, value: v } };`
      );
    }

    case 'add_class': {
      const classes = (params.value || '').split(/\s+/).filter(Boolean);
      const classesStr = JSON.stringify(classes);
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `__el__.classList.add.apply(__el__.classList, ${classesStr}); return { success: true, data: { message: '已添加类名: ' + ${classesStr}.join(', ') } };`
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `var cs = ${classesStr}; __els__.forEach(function(el) { el.classList.add.apply(el.classList, cs); }); return { success: true, data: { message: '已为 ' + __els__.length + ' 个元素添加类名: ' + cs.join(', ') } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `__el__.classList.add.apply(__el__.classList, ${classesStr}); return { success: true, data: { message: '已添加类名: ' + ${classesStr}.join(', ') } };`
      );
    }

    case 'remove_class': {
      const classes = (params.value || '').split(/\s+/).filter(Boolean);
      const classesStr = JSON.stringify(classes);
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `__el__.classList.remove.apply(__el__.classList, ${classesStr}); return { success: true, data: { message: '已移除类名: ' + ${classesStr}.join(', ') } };`
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `var cs = ${classesStr}; __els__.forEach(function(el) { el.classList.remove.apply(el.classList, cs); }); return { success: true, data: { message: '已从 ' + __els__.length + ' 个元素移除类名: ' + cs.join(', ') } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `__el__.classList.remove.apply(__el__.classList, ${classesStr}); return { success: true, data: { message: '已移除类名: ' + ${classesStr}.join(', ') } };`
      );
    }

    case 'toggle_class': {
      const classes = (params.value || '').split(/\s+/).filter(Boolean);
      const classesStr = JSON.stringify(classes);
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `var cs = ${classesStr}; cs.forEach(function(c) { __el__.classList.toggle(c); }); return { success: true, data: { message: '已切换类名: ' + cs.join(', ') } };`
        );
      }
      if (params.all) {
        return evaluateDOM(tabId, params.selector,
          `var cs = ${classesStr}; __els__.forEach(function(el) { cs.forEach(function(c) { el.classList.toggle(c); }); }); return { success: true, data: { message: '已切换 ' + __els__.length + ' 个元素的类名: ' + cs.join(', ') } };`,
          { all: true, limit: params.limit }
        );
      }
      return evaluateDOM(tabId, params.selector,
        `var cs = ${classesStr}; cs.forEach(function(c) { __el__.classList.toggle(c); }); return { success: true, data: { message: '已切换类名: ' + cs.join(', ') } };`
      );
    }

    case 'clone_element': {
      const position = params.position || 'afterend';
      const posStr = JSON.stringify(position);
      const newIdCode = params.new_id ? `clone.id = ${JSON.stringify(params.new_id)};` : '';
      if (typeof params.node_id === 'number' && !params.selector) {
        return evaluateDOMByNodeId(tabId, params.node_id,
          `var clone = __el__.cloneNode(true); ${newIdCode} __el__.insertAdjacentElement(${posStr}, clone); return { success: true, data: { message: '已克隆元素' } };`
        );
      }
      return evaluateDOM(tabId, params.selector,
        `var clone = __el__.cloneNode(true); ${newIdCode} __el__.insertAdjacentElement(${posStr}, clone); return { success: true, data: { message: '已克隆元素' } };`
      );
    }

    case 'wait_for': {
      return waitForElement(tabId, params.selector!, params.timeout || 5000, context?.signal);
    }

    default:
      return { success: false, error: `未知操作: ${action}` };
  }
};

/** 等待元素出现（轮询 Runtime.evaluate） */
const waitForElement = async (
  tabId: number,
  selector: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const startTime = Date.now();
  const interval = 300;
  const selectorStr = JSON.stringify(selector);

  while (Date.now() - startTime < timeout) {
    if (signal?.aborted) {
      return { success: false, error: 'aborted by user' };
    }

    const attachResult = await CDPSessionManager.attach(tabId);
    if (!attachResult.success) {
      return { success: false, error: `连接调试器失败: ${attachResult.error}` };
    }

    const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(function() { var el = document.querySelector(${selectorStr}); if (!el) return null; var rect = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), id: el.id || undefined, visible: rect.width > 0 && rect.height > 0 }; })()`,
      returnByValue: true,
    });

    if (result.success && result.result?.result?.value) {
      return {
        success: true,
        data: {
          found: true,
          element: result.result.result.value,
          selector,
          message: `找到匹配 "${selector}" 的元素`,
        },
      };
    }

    // 元素未找到，等待后重试
    await new Promise<void>((resolve, reject) => {
      if (!signal) {
        setTimeout(resolve, interval);
        return;
      }
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, interval);
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }).catch(() => {
      // 被中断
    });

    if (signal?.aborted) {
      return { success: false, error: 'aborted by user' };
    }
  }

  return { success: false, error: `等待超时（${timeout}ms）：未找到匹配 "${selector}" 的元素` };
};

// ==================== CSS 操作组 ====================

const executeCSSAction = async (
  tabId: number,
  action: string,
  params: any,
): Promise<FunctionResult> => {
  // CSS 域需要 DOM 域先启用
  const ready = await ensureDomainsEnabled(tabId, ['DOM', 'CSS']);
  if (!ready.success) {
    return { success: false, error: ready.error! };
  }

  switch (action) {
    case 'css_get_computed_style': {
      const resolved = await resolveNodeId(tabId, params.selector, params.node_id);
      if (!resolved.success) return { success: false, error: resolved.error! };

      const result = await CDPSessionManager.sendCommand(tabId, 'CSS.getComputedStyleForNode', {
        nodeId: resolved.nodeId,
      });
      if (!result.success) {
        return { success: false, error: `获取计算样式失败: ${result.error}` };
      }
      const computedStyle: Array<{ name: string; value: string }> = result.result?.computedStyle || [];
      const styleMap: Record<string, string> = {};

      if (params.properties && params.properties.length > 0) {
        // 仅返回指定属性
        const filterSet = new Set(params.properties as string[]);
        for (const item of computedStyle) {
          if (filterSet.has(item.name)) {
            styleMap[item.name] = item.value;
          }
        }
      } else {
        // 过滤掉默认值，只返回有意义的属性
        for (const item of computedStyle) {
          if (item.value && item.value !== 'initial' && item.value !== 'none' && item.value !== 'normal' && item.value !== 'auto' && item.value !== '0px' && item.value !== 'rgb(0, 0, 0)') {
            styleMap[item.name] = item.value;
          }
        }
      }

      return {
        success: true,
        data: {
          node_id: resolved.nodeId,
          computed_style: styleMap,
          count: Object.keys(styleMap).length,
          total_properties: computedStyle.length,
          message: `获取到 ${Object.keys(styleMap).length} 个样式属性`,
        },
      };
    }

    case 'css_get_matched_rules': {
      const resolved = await resolveNodeId(tabId, params.selector, params.node_id);
      if (!resolved.success) return { success: false, error: resolved.error! };

      const result = await CDPSessionManager.sendCommand(tabId, 'CSS.getMatchedStylesForNode', {
        nodeId: resolved.nodeId,
      });
      if (!result.success) {
        return { success: false, error: `获取匹配规则失败: ${result.error}` };
      }

      const inlineStyle = result.result?.inlineStyle;
      const matchedRules = result.result?.matchedCSSRules || [];

      const rules = matchedRules.map((match: any) => {
        const rule = match.rule;
        return {
          selector: rule?.selectorList?.text || '',
          style_text: rule?.style?.cssText || '',
          stylesheet_id: rule?.style?.styleSheetId,
          origin: rule?.origin || 'regular',
        };
      }).slice(0, 50); // 限制返回数量

      return {
        success: true,
        data: {
          node_id: resolved.nodeId,
          inline_style: inlineStyle?.cssText || null,
          matched_rules: rules,
          total_rules: matchedRules.length,
          message: `获取到 ${matchedRules.length} 条匹配的 CSS 规则`,
        },
      };
    }

    case 'css_set_style': {
      const resolved = await resolveNodeId(tabId, params.selector, params.node_id);
      if (!resolved.success) return { success: false, error: resolved.error! };

      // 先获取当前内联样式以拿到 styleSheetId 和 range
      const inlineResult = await CDPSessionManager.sendCommand(tabId, 'CSS.getInlineStylesForNode', {
        nodeId: resolved.nodeId,
      });
      if (!inlineResult.success) {
        return { success: false, error: `获取内联样式失败: ${inlineResult.error}` };
      }
      const inlineStyle = inlineResult.result?.inlineStyle;
      if (!inlineStyle) {
        return { success: false, error: '无法获取元素内联样式信息' };
      }

      const result = await CDPSessionManager.sendCommand(tabId, 'CSS.setStyleTexts', {
        edits: [{
          styleSheetId: inlineStyle.styleSheetId,
          range: inlineStyle.range,
          text: params.style_text,
        }],
      });
      if (!result.success) {
        return { success: false, error: `修改样式失败: ${result.error}` };
      }
      return {
        success: true,
        data: {
          node_id: resolved.nodeId,
          style_text: params.style_text,
          message: '内联样式已修改',
        },
      };
    }

    case 'css_add_rule': {
      // 尝试获取 inspector 样式表
      const sheetsResult = await CDPSessionManager.sendCommand(tabId, 'CSS.getStyleSheetText', {
        styleSheetId: 'inspector-stylesheet',
      });

      let sheetId: string;
      if (!sheetsResult.success) {
        // 创建一个 inspector 样式表
        const createResult = await CDPSessionManager.sendCommand(tabId, 'CSS.createStyleSheet', {
          frameId: '',
        });
        if (!createResult.success) {
          return { success: false, error: `创建样式表失败: ${createResult.error}` };
        }
        sheetId = createResult.result?.styleSheetId;
      } else {
        sheetId = 'inspector-stylesheet';
      }

      const ruleText = `${params.rule_selector} { ${params.rule_text} }`;
      const result = await CDPSessionManager.sendCommand(tabId, 'CSS.addRule', {
        styleSheetId: sheetId,
        ruleText,
        location: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
      });
      if (!result.success) {
        // 降级方案：通过 Runtime.evaluate 注入 style 标签
        const injectResult = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
          expression: `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(ruleText)}; document.head.appendChild(s); return 'injected'; })()`,
          returnByValue: true,
        });
        if (!injectResult.success) {
          return { success: false, error: `添加 CSS 规则失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            rule_selector: params.rule_selector,
            rule_text: params.rule_text,
            method: 'style_injection',
            message: `CSS 规则已通过 style 标签注入: ${ruleText}`,
          },
        };
      }
      return {
        success: true,
        data: {
          rule_selector: params.rule_selector,
          rule_text: params.rule_text,
          stylesheet_id: sheetId,
          method: 'css_domain',
          message: `CSS 规则已添加: ${ruleText}`,
        },
      };
    }

    case 'css_get_stylesheets': {
      // 通过 Runtime.evaluate 获取所有样式表信息
      const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `JSON.stringify(Array.from(document.styleSheets).map((s, i) => ({ index: i, href: s.href, disabled: s.disabled, title: s.title, rulesCount: (() => { try { return s.cssRules?.length || 0 } catch { return -1 } })(), ownerNode: s.ownerNode?.tagName || null })))`,
        returnByValue: true,
      });
      if (!result.success) {
        return { success: false, error: `获取样式表列表失败: ${result.error}` };
      }
      let sheets: any[] = [];
      try {
        sheets = JSON.parse(result.result?.result?.value || '[]');
      } catch { /* 忽略解析错误 */ }
      return {
        success: true,
        data: {
          stylesheets: sheets,
          total: sheets.length,
          message: `页面有 ${sheets.length} 个样式表`,
        },
      };
    }

    case 'css_get_stylesheet': {
      const result = await CDPSessionManager.sendCommand(tabId, 'CSS.getStyleSheetText', {
        styleSheetId: params.stylesheet_id,
      });
      if (!result.success) {
        return { success: false, error: `获取样式表内容失败: ${result.error}` };
      }
      let text = result.result?.text || '';
      const truncated = text.length > 100000;
      if (truncated) text = text.substring(0, 100000);
      return {
        success: true,
        data: {
          stylesheet_id: params.stylesheet_id,
          text,
          length: result.result?.text?.length || 0,
          truncated,
          message: truncated ? '样式表内容已截断至 100000 字符' : '获取样式表内容成功',
        },
      };
    }

    case 'css_set_stylesheet': {
      const result = await CDPSessionManager.sendCommand(tabId, 'CSS.setStyleSheetText', {
        styleSheetId: params.stylesheet_id,
        text: params.stylesheet_text,
      });
      if (!result.success) {
        return { success: false, error: `修改样式表失败: ${result.error}` };
      }
      return {
        success: true,
        data: {
          stylesheet_id: params.stylesheet_id,
          message: '样式表内容已修改',
        },
      };
    }

    default:
      return { success: false, error: `未知 CSS 操作: ${action}` };
  }
};

// ==================== Storage 操作组 ====================

/** 通过 Runtime.evaluate 回退读取 storage（CDP DOMStorage 域不可用时的 fallback） */
const storageGetItemsFallback = async (
  tabId: number,
  isLocalStorage: boolean,
): Promise<FunctionResult> => {
  const storageObj = isLocalStorage ? 'localStorage' : 'sessionStorage';
  const storageLabel = isLocalStorage ? 'localStorage' : 'sessionStorage';
  const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression: `(() => { try { const s = ${storageObj}; const items = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); items[k] = s.getItem(k); } return JSON.stringify({ ok: true, items, count: s.length }); } catch(e) { return JSON.stringify({ ok: false, error: e.message }); } })()`,
    returnByValue: true,
  });
  if (!result.success) {
    return { success: false, error: `Runtime fallback 失败: ${result.error}` };
  }
  try {
    const parsed = JSON.parse(result.result?.result?.value || '{}');
    if (!parsed.ok) return { success: false, error: parsed.error || `读取 ${storageLabel} 失败` };
    return {
      success: true,
      data: {
        storage_type: storageLabel,
        items: parsed.items,
        count: parsed.count,
        message: `获取到 ${parsed.count} 个 ${storageLabel} 条目（fallback）`,
      },
    };
  } catch {
    return { success: false, error: `解析 ${storageLabel} 结果失败` };
  }
};

const storageGetItemFallback = async (
  tabId: number,
  isLocalStorage: boolean,
  key: string,
): Promise<FunctionResult> => {
  const storageObj = isLocalStorage ? 'localStorage' : 'sessionStorage';
  const storageLabel = isLocalStorage ? 'localStorage' : 'sessionStorage';
  const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression: `(() => { try { const v = ${storageObj}.getItem(${JSON.stringify(key)}); return JSON.stringify({ ok: true, value: v, exists: v !== null }); } catch(e) { return JSON.stringify({ ok: false, error: e.message }); } })()`,
    returnByValue: true,
  });
  if (!result.success) {
    return { success: false, error: `Runtime fallback 失败: ${result.error}` };
  }
  try {
    const parsed = JSON.parse(result.result?.result?.value || '{}');
    if (!parsed.ok) return { success: false, error: parsed.error || `读取 ${storageLabel} 失败` };
    return {
      success: true,
      data: {
        key,
        value: parsed.value,
        exists: parsed.exists,
        message: parsed.exists
          ? `获取 ${storageLabel}["${key}"] 成功（fallback）`
          : `${storageLabel} 中不存在 key "${key}"`,
      },
    };
  } catch {
    return { success: false, error: `解析 ${storageLabel} 结果失败` };
  }
};

const executeStorageAction = async (
  tabId: number,
  action: string,
  params: any,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const isLocalStorage = params.storage_type !== 'session';

  // 确保 debugger 已 attach
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) {
    return { success: false, error: `无法连接调试器: ${attachResult.error}` };
  }

  // 尝试启用 DOMStorage 域（某些页面可能不支持）
  const enableResult = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.enable', {});
  const domStorageAvailable = enableResult.success;

  // 获取 securityOrigin（DOMStorage 域操作需要）
  let origin: string | null = null;
  if (domStorageAvailable) {
    origin = params.security_origin || await getSecurityOrigin(tabId);
  }

  const storageLabel = isLocalStorage ? 'localStorage' : 'sessionStorage';

  // 构建 storageId（仅 DOMStorage 域可用且 origin 存在时有效）
  const storageId = origin ? buildStorageId(origin, isLocalStorage) : null;

  switch (action) {
    case 'storage_get_items': {
      // 优先 CDP DOMStorage 域，失败则 fallback 到 Runtime.evaluate
      if (storageId) {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.getDOMStorageItems', { storageId });
        if (result.success) {
          const entries: Array<[string, string]> = result.result?.entries || [];
          const items: Record<string, string> = {};
          for (const [key, value] of entries) { items[key] = value; }
          return {
            success: true,
            data: {
              storage_type: storageLabel,
              origin,
              items,
              count: Object.keys(items).length,
              message: `获取到 ${Object.keys(items).length} 个 ${storageLabel} 条目`,
            },
          };
        }
      }
      // fallback
      return storageGetItemsFallback(tabId, isLocalStorage);
    }

    case 'storage_get_item': {
      if (storageId) {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.getDOMStorageItems', { storageId });
        if (result.success) {
          const entries: Array<[string, string]> = result.result?.entries || [];
          const found = entries.find(([k]) => k === params.key);
          if (!found) {
            return {
              success: true,
              data: { key: params.key, value: null, exists: false, message: `${storageLabel} 中不存在 key "${params.key}"` },
            };
          }
          return {
            success: true,
            data: { key: params.key, value: found[1], exists: true, message: `获取 ${storageLabel}["${params.key}"] 成功` },
          };
        }
      }
      // fallback
      return storageGetItemFallback(tabId, isLocalStorage, params.key);
    }

    case 'storage_set_item': {
      if (storageId) {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.setDOMStorageItem', {
          storageId, key: params.key, value: params.value,
        });
        if (result.success) {
          return { success: true, data: { key: params.key, value: params.value, message: `${storageLabel}["${params.key}"] 已设置` } };
        }
      }
      // fallback
      const storageObj = isLocalStorage ? 'localStorage' : 'sessionStorage';
      const fbResult = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `(() => { try { ${storageObj}.setItem(${JSON.stringify(params.key)}, ${JSON.stringify(String(params.value ?? ''))}); return JSON.stringify({ ok: true }); } catch(e) { return JSON.stringify({ ok: false, error: e.message }); } })()`,
        returnByValue: true,
      });
      const fbParsed = (() => { try { return JSON.parse(fbResult.result?.result?.value || '{}'); } catch { return { ok: false, error: '解析失败' }; } })();
      if (!fbResult.success || !fbParsed.ok) {
        return { success: false, error: `设置 ${storageLabel} 失败: ${fbParsed.error || fbResult.error}` };
      }
      return { success: true, data: { key: params.key, value: params.value, message: `${storageLabel}["${params.key}"] 已设置（fallback）` } };
    }

    case 'storage_remove_item': {
      if (storageId) {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.removeDOMStorageItem', {
          storageId, key: params.key,
        });
        if (result.success) {
          return { success: true, data: { key: params.key, message: `${storageLabel}["${params.key}"] 已删除` } };
        }
      }
      // fallback
      const storageObj2 = isLocalStorage ? 'localStorage' : 'sessionStorage';
      const fbResult2 = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `(() => { try { ${storageObj2}.removeItem(${JSON.stringify(params.key)}); return JSON.stringify({ ok: true }); } catch(e) { return JSON.stringify({ ok: false, error: e.message }); } })()`,
        returnByValue: true,
      });
      const fbParsed2 = (() => { try { return JSON.parse(fbResult2.result?.result?.value || '{}'); } catch { return { ok: false, error: '解析失败' }; } })();
      if (!fbResult2.success || !fbParsed2.ok) {
        return { success: false, error: `删除 ${storageLabel} 条目失败: ${fbParsed2.error || fbResult2.error}` };
      }
      return { success: true, data: { key: params.key, message: `${storageLabel}["${params.key}"] 已删除（fallback）` } };
    }

    case 'storage_clear': {
      if (storageId) {
        const result = await CDPSessionManager.sendCommand(tabId, 'DOMStorage.clear', { storageId });
        if (result.success) {
          return { success: true, data: { storage_type: storageLabel, origin, message: `${storageLabel} 已清空` } };
        }
      }
      // fallback
      const storageObj3 = isLocalStorage ? 'localStorage' : 'sessionStorage';
      const fbResult3 = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `(() => { try { ${storageObj3}.clear(); return JSON.stringify({ ok: true }); } catch(e) { return JSON.stringify({ ok: false, error: e.message }); } })()`,
        returnByValue: true,
      });
      const fbParsed3 = (() => { try { return JSON.parse(fbResult3.result?.result?.value || '{}'); } catch { return { ok: false, error: '解析失败' }; } })();
      if (!fbResult3.success || !fbParsed3.ok) {
        return { success: false, error: `清空 ${storageLabel} 失败: ${fbParsed3.error || fbResult3.error}` };
      }
      return { success: true, data: { storage_type: storageLabel, message: `${storageLabel} 已清空（fallback）` } };
    }

    default:
      return { success: false, error: `未知存储操作: ${action}` };
  }
};
