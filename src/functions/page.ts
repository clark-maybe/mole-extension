/**
 * 统一页面工具
 * 将 page_viewer、page_snapshot、page_skeleton、page_assert、page_repair 合并为单一入口
 * 通过 action 参数分发到各子实现
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { pageViewerFunction } from './page-viewer';
import { pageSnapshotFunction } from './page-snapshot';
import { pageSkeletonFunction } from './page-skeleton';
import { pageAssertFunction } from './page-assert';
import { pageRepairFunction } from './page-repair';

export const pageFunction: FunctionDefinition = {
  name: 'page',
  description: [
    'Unified page information retrieval and verification tool. Select function via action parameter:',
    '',
    '- view: Get page URL, title, meta, body content, link list, heading hierarchy. Use when you need to read/summarize page content.',
    '- snapshot: Get semantic snapshot with interactive/readable element candidates (with element_id). Use to locate elements on unfamiliar pages before operating with cdp_input.',
    '- skeleton: Get hierarchical page skeleton (simplified Accessibility Tree text). Understand overall page layout with minimal tokens.',
    '- assert: Verify page conditions (URL/title/text/selector). Use after actions to validate results.',
    '- repair: Execute recovery strategies when actions fail or assertions don\'t pass (multi-query snapshot, scrolling, full-page expansion, candidate re-ranking).',
    '',
    '⚠️ Do NOT use this tool for:',
    '- Page interactions (click/type/scroll) → use cdp_input',
    '- Executing JavaScript → use cdp_frame',
    '- Reading/writing DOM/CSS/Storage → use cdp_dom',
    '- Extracting structured data (tables/lists/repeated patterns) → use extract_data',
  ].join('\n'),
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['view', 'snapshot', 'skeleton', 'assert', 'repair'],
        description: 'Action type: view=page content, snapshot=semantic snapshot, skeleton=skeleton tree, assert=assertion verification, repair=recovery',
      },
      // === view 参数 ===
      sections: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['meta', 'content', 'links', 'headings'],
        },
        description: '[view] Sections to retrieve: meta (page metadata), content (body text), links (link list), headings (heading hierarchy). Omit to return all.',
      },
      max_content_length: {
        type: 'number',
        description: '[view] Max characters for body content. Default 3000, range 500-10000.',
      },
      // === snapshot 参数 ===
      query: {
        type: 'string',
        description: '[snapshot] Natural language locator, e.g. "search box", "login button". Results are ranked by relevance when provided.',
      },
      include_non_interactive: {
        type: 'boolean',
        description: '[snapshot] Include non-interactive elements. Default false. Set true when looking for text content.',
      },
      only_viewport: {
        type: 'boolean',
        description: '[snapshot] Only return elements within current viewport. Default false.',
      },
      limit: {
        type: 'number',
        description: '[snapshot] Max number of candidate elements to return. Range 1-60, default 20.',
      },
      // === skeleton 参数 ===
      expand_selector: {
        type: 'string',
        description: '[skeleton] CSS selector for a region to expand in detail, e.g. ".product-list". That region gets deeper level expansion.',
      },
      max_depth: {
        type: 'number',
        description: '[skeleton] Max traversal depth. Range 3-12, default 6. Expanded regions get +4 extra levels.',
      },
      max_nodes: {
        type: 'number',
        description: '[skeleton] Max nodes in skeleton tree. Range 50-300, default 150.',
      },
      // === snapshot / skeleton 共享参数 ===
      scope_selector: {
        type: 'string',
        description: '[snapshot/skeleton/assert/repair] CSS selector to limit scope, e.g. "main", "#content".',
      },
      include_hidden: {
        type: 'boolean',
        description: '[snapshot/skeleton] Include hidden elements. Default false.',
      },
      // === assert 参数 ===
      mode: {
        type: 'string',
        enum: ['all', 'any'],
        description: '[assert] Assertion mode. all=all must pass; any=any one passing is sufficient. Default all.',
      },
      assertions: {
        type: 'array',
        description: '[assert] List of assertions.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['url_includes', 'title_includes', 'text_includes', 'selector_exists', 'selector_visible', 'selector_text_includes'],
              description: 'Assertion type.',
            },
            value: {
              type: 'string',
              description: 'Match value for url_includes/title_includes/text_includes.',
            },
            selector: {
              type: 'string',
              description: 'CSS selector for selector_exists/selector_visible/selector_text_includes.',
            },
          },
          required: ['type'],
        },
      },
      // === repair 参数 ===
      target_hint: {
        type: 'string',
        description: '[repair] Target hint, e.g. "search box", "submit button", "login". Used to re-locate candidate elements with automatic synonym expansion.',
      },
      attempts: {
        type: 'number',
        description: '[repair] Max number of recovery strategy layers to execute. Range 1-5, default 5.',
      },
      scroll_amount: {
        type: 'number',
        description: '[repair] Scroll pixel amount. Default 720.',
      },
      // === 通用参数 ===
      tab_id: {
        type: 'number',
        description: 'Target tab ID. Omit to operate on the current active tab.',
      },
    },
    required: ['action'],
  },
  validate: (params: { action?: string; assertions?: any[] }) => {
    const action = params?.action;
    if (!action) return 'action parameter is required';

    // assert 动作需要 assertions 参数
    if (action === 'assert') {
      if (pageAssertFunction.validate) {
        return pageAssertFunction.validate(params);
      }
    }
    return null;
  },
  execute: async (params: Record<string, any>, context?: ToolExecutionContext) => {
    const action = params.action;

    switch (action) {
      case 'view':
        return pageViewerFunction.execute({
          sections: params.sections,
          max_content_length: params.max_content_length,
          tab_id: params.tab_id,
        }, context);

      case 'snapshot':
        return pageSnapshotFunction.execute({
          query: params.query,
          scope_selector: params.scope_selector,
          include_non_interactive: params.include_non_interactive,
          include_hidden: params.include_hidden,
          only_viewport: params.only_viewport,
          limit: params.limit,
          tab_id: params.tab_id,
        }, context);

      case 'skeleton':
        return pageSkeletonFunction.execute({
          scope_selector: params.scope_selector,
          expand_selector: params.expand_selector,
          max_depth: params.max_depth,
          max_nodes: params.max_nodes,
          include_hidden: params.include_hidden,
          tab_id: params.tab_id,
        }, context);

      case 'assert':
        return pageAssertFunction.execute({
          mode: params.mode,
          scope_selector: params.scope_selector,
          assertions: params.assertions,
        }, context);

      case 'repair':
        return pageRepairFunction.execute({
          target_hint: params.target_hint,
          scope_selector: params.scope_selector,
          attempts: params.attempts,
          scroll_amount: params.scroll_amount,
        }, context);

      default:
        return { success: false, error: `Unknown action: ${action}. Supported: view/snapshot/skeleton/assert/repair` };
    }
  },
};
