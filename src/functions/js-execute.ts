/**
 * JavaScript 执行工具
 * 使用 chrome.scripting.executeScript() 在页面上下文中执行 JS 代码
 */

import type { FunctionDefinition } from './types';

export const jsExecuteFunction: FunctionDefinition = {
  name: 'js_execute',
  description: '在用户当前浏览的页面中执行 JavaScript 代码并返回结果。这是一个强大的万能工具，可以用于：提取结构化数据（表格、列表）、计算页面统计信息、查询 DOM 元素状态、获取 localStorage/sessionStorage 数据、执行任何自定义页面操作。代码在页面上下文中运行，可以访问页面的 DOM 和全局变量。注意：代码必须通过 return 语句返回结果。',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: '要执行的 JavaScript 代码。必须是一个表达式或包含 return 语句的函数体。例如："return document.querySelectorAll(\'table tr\').length" 或 "return JSON.parse(localStorage.getItem(\'key\'))"',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。不传则在当前活动标签页执行',
      },
    },
    required: ['code'],
  },
  execute: async (params: { code: string; tab_id?: number }, context?: { tabId?: number }) => {
    const { code, tab_id } = params;

    // 确定目标标签页
    let targetTabId = tab_id || context?.tabId;
    if (!targetTabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTabId = activeTab?.id;
    }
    if (!targetTabId) {
      return { success: false, error: '无法获取目标标签页' };
    }

    try {
      // 用 chrome.scripting.executeScript 在页面上下文执行
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (userCode: string) => {
          try {
            // 包装为函数执行，支持 return 语句
            const fn = new Function(userCode);
            return { success: true, data: fn() };
          } catch (err: any) {
            return { success: false, error: err.message || '代码执行出错' };
          }
        },
        args: [code],
        world: 'MAIN', // 在页面主世界执行，可访问页面全局变量
      });

      const result = results?.[0]?.result;
      if (!result) {
        return { success: false, error: '未获取到执行结果' };
      }

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // 将结果转为字符串（工具结果最终序列化为 JSON 文本传给 LLM）
      return {
        success: true,
        data: {
          result: result.data,
          type: typeof result.data,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'JavaScript 执行失败' };
    }
  },
};
