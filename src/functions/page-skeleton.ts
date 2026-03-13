/**
 * 页面骨架树工具
 * 返回层级化的页面结构概览，让 AI 快速理解页面布局
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { sendToTabWithRetry } from './tab-message';

const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].id) {
        resolve(tabs[0].id);
      } else {
        resolve(null);
      }
    });
  });
};

export const pageSkeletonFunction: FunctionDefinition = {
  name: 'page_skeleton',
  description: [
    '获取当前页面的层级化骨架结构，返回类 Accessibility Tree 的简化文本表示。',
    '用极少的 token 即可理解页面整体布局、区域划分和交互元素分布。',
    '适合在操作前先获取全局结构，再用 page_snapshot 精确定位具体元素。',
    '交互元素会自动分配 element_id，可直接用于 page_action。',
    '支持 expand_selector 渐进展开特定区域。',
  ].join(' '),
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      scope_selector: {
        type: 'string',
        description: '可选：限定骨架树范围的 CSS selector，例如 "main"、"#content"。默认整个 body。',
      },
      expand_selector: {
        type: 'string',
        description: '可选：需要展开详细结构的区域 CSS selector，如 ".product-list"。该区域会获得更深的层级展开。',
      },
      max_depth: {
        type: 'number',
        description: '最大遍历深度，范围 3-12，默认 6。展开区域会额外增加 4 层。',
      },
      max_nodes: {
        type: 'number',
        description: '骨架树最大节点数，范围 50-300，默认 150。',
      },
      include_hidden: {
        type: 'boolean',
        description: '是否包含隐藏元素。默认 false。',
      },
    },
    required: [],
  },
  execute: async (
    params: {
      scope_selector?: string;
      expand_selector?: string;
      max_depth?: number;
      max_nodes?: number;
      include_hidden?: boolean;
    },
    context?: ToolExecutionContext,
  ) => {
    let tabId = context?.tabId;
    if (!tabId) {
      tabId = (await getActiveTabId()) ?? undefined;
    }

    if (!tabId) {
      return { success: false, error: '无法获取当前标签页' };
    }

    try {
      const response = await sendToTabWithRetry<{ success: boolean; data?: any; error?: string }>(
        tabId,
        '__page_skeleton_build',
        params,
        {
          signal: context?.signal,
          deadlineMs: 12000,
          timeoutMessage: '等待页面骨架树超时',
        },
      );
      if (!response?.success) {
        return { success: false, error: response?.error || '页面骨架树构建失败' };
      }
      return { success: true, data: response.data };
    } catch (err: any) {
      return { success: false, error: err.message || '页面骨架树构建失败' };
    }
  },
};
