/**
 * CDP CSS 样式操作工具
 * 通过 chrome.debugger 的 CSS 域检查和修改页面样式
 * 支持获取计算样式、匹配的 CSS 规则、修改内联样式、动态添加规则
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

/** 确保 DOM + CSS 域都已启用 */
const ensureDomainsEnabled = async (tabId: number): Promise<{ success: boolean; error?: string }> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) {
    return { success: false, error: `无法连接调试器: ${attachResult.error}` };
  }
  // CSS 域需要 DOM 域先启用
  await CDPSessionManager.sendCommand(tabId, 'DOM.enable', {});
  const cssResult = await CDPSessionManager.sendCommand(tabId, 'CSS.enable', {});
  if (!cssResult.success) {
    return { success: false, error: `启用 CSS 域失败: ${cssResult.error}` };
  }
  return { success: true };
};

/** 获取文档根节点 nodeId */
const getDocumentNodeId = async (tabId: number): Promise<number | null> => {
  const result = await CDPSessionManager.sendCommand(tabId, 'DOM.getDocument', { depth: 0 });
  return result.result?.root?.nodeId || null;
};

/** 通过选择器查找 nodeId */
const resolveNodeId = async (tabId: number, selector?: string, nodeId?: number): Promise<{ success: boolean; nodeId?: number; error?: string }> => {
  if (typeof nodeId === 'number' && nodeId > 0) {
    return { success: true, nodeId };
  }
  if (selector) {
    const docNodeId = await getDocumentNodeId(tabId);
    if (!docNodeId) return { success: false, error: '无法获取文档根节点' };
    const result = await CDPSessionManager.sendCommand(tabId, 'DOM.querySelector', {
      nodeId: docNodeId,
      selector,
    });
    if (!result.success) return { success: false, error: `查询选择器失败: ${result.error}` };
    const nid = result.result?.nodeId;
    if (!nid || nid === 0) return { success: false, error: `未找到匹配 "${selector}" 的元素` };
    return { success: true, nodeId: nid };
  }
  return { success: false, error: '需要 node_id 或 selector 参数来定位元素' };
};

export const cdpCssFunction: FunctionDefinition = {
  name: 'cdp_css',
  description: 'CSS 样式检查与修改工具（CDP CSS 域）。获取元素的计算样式、匹配的 CSS 规则、修改内联样式、动态添加 CSS 规则、读写完整样式表。适用于样式诊断（"为什么按钮不可见"）、动态注入 CSS、提取设计 token 等场景。支持通过 node_id 或 CSS selector 定位元素。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get_computed_style', 'get_matched_rules', 'set_style', 'add_rule', 'get_stylesheet', 'set_stylesheet', 'get_stylesheets'],
        description: '操作类型：get_computed_style=获取计算样式, get_matched_rules=获取匹配CSS规则, set_style=修改内联样式, add_rule=添加CSS规则, get_stylesheet=获取样式表内容, set_stylesheet=修改样式表, get_stylesheets=列出所有样式表',
      },
      node_id: {
        type: 'number',
        description: '目标节点 ID（通过 cdp_dom 的 query_selector 获取）',
      },
      selector: {
        type: 'string',
        description: 'CSS 选择器（替代 node_id，自动查询元素）',
      },
      // get_computed_style 参数
      properties: {
        type: 'array',
        items: { type: 'string' },
        description: 'get_computed_style 时仅返回指定属性（如 ["color", "font-size"]），不传则返回全部',
      },
      // set_style 参数
      style_text: {
        type: 'string',
        description: 'set_style 的 CSS 文本（如 "color: red; font-size: 16px;"）',
      },
      // add_rule 参数
      rule_selector: {
        type: 'string',
        description: 'add_rule 的 CSS 选择器（如 ".my-class"、"#my-id"）',
      },
      rule_text: {
        type: 'string',
        description: 'add_rule 的 CSS 规则文本（如 "color: red; display: none;"）',
      },
      // get_stylesheet / set_stylesheet 参数
      stylesheet_id: {
        type: 'string',
        description: '样式表 ID（从 get_matched_rules 或 get_stylesheets 获取）',
      },
      stylesheet_text: {
        type: 'string',
        description: 'set_stylesheet 的新样式表内容',
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
    const validActions = ['get_computed_style', 'get_matched_rules', 'set_style', 'add_rule', 'get_stylesheet', 'set_stylesheet', 'get_stylesheets'];
    if (!validActions.includes(action)) {
      return `不支持的 action: ${action}`;
    }
    if (['get_computed_style', 'get_matched_rules', 'set_style'].includes(action)) {
      if (typeof params.node_id !== 'number' && !params.selector) {
        return `${action} 需要 node_id 或 selector 参数`;
      }
    }
    if (action === 'set_style' && !params.style_text) {
      return 'set_style 需要 style_text 参数';
    }
    if (action === 'add_rule') {
      if (!params.rule_selector) return 'add_rule 需要 rule_selector 参数';
      if (!params.rule_text) return 'add_rule 需要 rule_text 参数';
    }
    if (action === 'get_stylesheet' && !params.stylesheet_id) {
      return 'get_stylesheet 需要 stylesheet_id 参数';
    }
    if (action === 'set_stylesheet') {
      if (!params.stylesheet_id) return 'set_stylesheet 需要 stylesheet_id 参数';
      if (!params.stylesheet_text) return 'set_stylesheet 需要 stylesheet_text 参数';
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      node_id?: number;
      selector?: string;
      properties?: string[];
      style_text?: string;
      rule_selector?: string;
      rule_text?: string;
      stylesheet_id?: string;
      stylesheet_text?: string;
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

    // 确保 DOM + CSS 域已启用
    const ready = await ensureDomainsEnabled(tabId);
    if (!ready.success) {
      return { success: false, error: ready.error! };
    }

    switch (action) {
      case 'get_computed_style': {
        const resolved = await resolveNodeId(tabId, params.selector, params.node_id);
        if (!resolved.success) return { success: false, error: resolved.error! };

        const result = await CDPSessionManager.sendCommand(tabId, 'CSS.getComputedStyleForNode', {
          nodeId: resolved.nodeId,
        });
        if (!result.success) {
          return { success: false, error: `获取计算样式失败: ${result.error}` };
        }
        const computedStyle: Array<{ name: string; value: string }> = result.result?.computedStyle || [];
        let styleMap: Record<string, string> = {};

        if (params.properties && params.properties.length > 0) {
          // 仅返回指定属性
          const filterSet = new Set(params.properties);
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

      case 'get_matched_rules': {
        const resolved = await resolveNodeId(tabId, params.selector, params.node_id);
        if (!resolved.success) return { success: false, error: resolved.error! };

        const result = await CDPSessionManager.sendCommand(tabId, 'CSS.getMatchedStylesForNode', {
          nodeId: resolved.nodeId,
        });
        if (!result.success) {
          return { success: false, error: `获取匹配规则失败: ${result.error}` };
        }

        // 简化输出
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

      case 'set_style': {
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

      case 'add_rule': {
        // 需要一个样式表来添加规则，先获取或创建
        // 尝试获取第一个可编辑的样式表
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

        // 添加规则
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

      case 'get_stylesheets': {
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
        } catch { /* 忽略 */ }
        return {
          success: true,
          data: {
            stylesheets: sheets,
            total: sheets.length,
            message: `页面有 ${sheets.length} 个样式表`,
          },
        };
      }

      case 'get_stylesheet': {
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

      case 'set_stylesheet': {
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
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
