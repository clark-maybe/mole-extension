/**
 * Todo 工具 — 任务规划与进度追踪
 *
 * 工厂函数模式：接收 TodoManager 实例引用（由 orchestrator 注入）。
 * 不通过 MCP Server 全局注册，在 agenticLoop 中本地拦截执行。
 *
 * action:
 *   create — 批量创建初始计划
 *   update — 推进某项状态（单焦点约束）
 *   add    — 追加新步骤
 *   remove — 删除待办项（仅 pending 可删）
 *   list   — 查看当前进度
 */

import type { FunctionDefinition, FunctionResult } from './types';
import type { TodoManager } from '../ai/todo-manager';

/** 创建 todo 工具的工厂函数 */
export const createTodoFunction = (getTodoManager: () => TodoManager): FunctionDefinition => ({
  name: 'todo',
  description: 'Task planning and progress tracking. For multi-step tasks, use create to define a plan first, mark each step as in_progress with update before executing, then mark as completed when done. Only one task can be in_progress at a time. Maximum 20 items.',
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'update', 'add', 'remove', 'list'],
        description: 'create: batch create initial plan (pass items); update: update status (pass id + status); add: append new item (pass title); remove: delete pending item (pass id); list: view progress',
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Used with action=create: list of task titles in execution order.',
      },
      id: {
        type: 'number',
        description: 'Used with action=update/remove: target task ID.',
      },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed'],
        description: 'Used with action=update: new status.',
      },
      title: {
        type: 'string',
        description: 'Used with action=add: title of the new task.',
      },
      result: {
        type: 'string',
        description: 'Optional when action=update and status=completed: briefly record the output of this step.',
      },
    },
    required: ['action'],
  },

  validate: (params: any) => {
    const action = String(params.action || '');
    if (action === 'create' && (!Array.isArray(params.items) || params.items.length === 0)) {
      return 'create action requires a non-empty items array';
    }
    if (action === 'update' && (params.id == null || !params.status)) {
      return 'update action requires id and status';
    }
    if (action === 'add' && !params.title) {
      return 'add action requires title';
    }
    if (action === 'remove' && params.id == null) {
      return 'remove action requires id';
    }
    return null;
  },

  execute: async (params: {
    action: string;
    items?: string[];
    id?: number;
    status?: string;
    title?: string;
    result?: string;
  }): Promise<FunctionResult> => {
    const mgr = getTodoManager();
    const { action } = params;

    switch (action) {
      case 'create': {
        const titles = params.items || [];
        if (mgr.active) {
          return { success: false, error: 'A task plan already exists. Use add to append new items, or complete/remove existing ones first.' };
        }
        const created = mgr.addBatch(titles);
        if (created.length < titles.length) {
          return {
            success: true,
            data: {
              message: `已创建 ${created.length} 项（达到上限 20，丢弃 ${titles.length - created.length} 项）`,
              items: mgr.all,
              stats: mgr.stats,
            },
          };
        }
        return {
          success: true,
          data: {
            message: `已创建 ${created.length} 项任务计划`,
            items: mgr.all,
            stats: mgr.stats,
          },
        };
      }

      case 'update': {
        const id = Number(params.id);
        const status = params.status as 'in_progress' | 'completed';
        const updated = mgr.update(id, status, params.result);
        if (!updated) {
          const item = mgr.all.find(i => i.id === id);
          if (!item) return { success: false, error: `ID #${id} does not exist` };
          if (item.status === 'completed') return { success: false, error: `#${id} is already completed and cannot be modified` };
          if (status === 'in_progress' && mgr.current) {
            return { success: false, error: `Cannot have multiple tasks in progress. Currently in progress: #${mgr.current.id} ${mgr.current.title}. Please complete it first.` };
          }
          return { success: false, error: 'Invalid status transition' };
        }
        return {
          success: true,
          data: {
            message: `#${id} 已更新为 ${status}`,
            current: mgr.current,
            stats: mgr.stats,
          },
        };
      }

      case 'add': {
        const item = mgr.add(params.title!);
        if (!item) {
          return { success: false, error: 'Maximum limit of 20 items reached' };
        }
        return {
          success: true,
          data: {
            message: `已追加 #${item.id}: ${item.title}`,
            item,
            stats: mgr.stats,
          },
        };
      }

      case 'remove': {
        const removed = mgr.remove(Number(params.id));
        if (!removed) {
          return { success: false, error: `Cannot delete #${params.id} (does not exist or is not in pending status)` };
        }
        return {
          success: true,
          data: {
            message: `已删除 #${params.id}`,
            stats: mgr.stats,
          },
        };
      }

      case 'list': {
        if (!mgr.active) {
          return { success: true, data: { message: '当前没有任务计划', items: [], stats: mgr.stats } };
        }
        return {
          success: true,
          data: {
            items: mgr.all,
            stats: mgr.stats,
            statusText: mgr.toStatusText(),
          },
        };
      }

      default:
        return { success: false, error: `Unsupported action: ${action}` };
    }
  },
});
