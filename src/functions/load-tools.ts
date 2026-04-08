/**
 * load_tools — 按需加载额外工具的元工具
 *
 * execute 仅返回信息，实际工具注入由 orchestrator 的 loop 处理
 */

import type { FunctionDefinition } from './types';
import { ON_DEMAND_CATEGORIES, getToolsByCategory } from './tool-tiers';

export const loadToolsFunction: FunctionDefinition = {
  name: 'load_tools',
  description: 'Load additional tools on demand. When you need to use tools listed in the on-demand tool catalog, call this tool first to load the corresponding category. The new tool schemas will be available in the next round.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: Object.keys(ON_DEMAND_CATEGORIES),
        description: 'cdp_advanced: DOM manipulation/JS execution/network monitoring/device emulation/dialog/debugging; browser_utils: clipboard/notifications/bookmarks/history/downloads; data_storage: KV storage/downloads; scheduling: timers/persistent tasks',
      },
    },
    required: ['category'],
  },
  supportsParallel: true,
  permissionLevel: 'read',
  execute: async (params: { category: string }) => {
    const { category } = params;
    const tools = getToolsByCategory(category);
    if (tools.length === 0) {
      return {
        success: false,
        error: `未知的工具分类：${category}`,
      };
    }
    const catInfo = ON_DEMAND_CATEGORIES[category];
    return {
      success: true,
      data: {
        loaded: tools,
        category,
        label: catInfo?.label || category,
        message: `已加载 ${tools.length} 个工具：${tools.join(', ')}`,
      },
    };
  },
};
