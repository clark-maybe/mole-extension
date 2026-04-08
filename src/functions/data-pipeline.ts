/**
 * 数据管道工具
 * 数据缓冲、转换与导出
 * 运行在 background 侧，纯内存操作
 */

import type { FunctionDefinition, FunctionResult } from './types';

/** 数据缓冲区结构 */
export interface DataBuffer {
  id: string;
  name: string;
  items: Record<string, any>[];
  createdAt: number;
}

/** 缓冲区存储（background 内存） */
const bufferStore = new Map<string, DataBuffer>();

/** 单个缓冲区最大条数 */
const MAX_BUFFER_ITEMS = 5000;
/** 最多同时存在的缓冲区数 */
const MAX_BUFFER_COUNT = 10;

/** 生成随机 buffer_id */
const generateBufferId = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'buf_';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/** 获取或创建缓冲区（供 extract-data.ts 调用） */
export function getOrCreateBuffer(id: string, name?: string): DataBuffer {
  let buffer = bufferStore.get(id);
  if (!buffer) {
    // 检查缓冲区数量上限
    if (bufferStore.size >= MAX_BUFFER_COUNT) {
      throw new Error(`缓冲区数量已达上限（${MAX_BUFFER_COUNT}个），请先清理不需要的缓冲区`);
    }
    buffer = {
      id,
      name: name || id,
      items: [],
      createdAt: Date.now(),
    };
    bufferStore.set(id, buffer);
  }
  return buffer;
}

/** 追加数据到缓冲区（供 extract-data.ts 调用） */
export function appendToBuffer(id: string, items: Record<string, any>[]): { appended: number; total: number } {
  const buffer = getOrCreateBuffer(id);
  const remaining = MAX_BUFFER_ITEMS - buffer.items.length;
  const toAppend = items.slice(0, remaining);
  buffer.items.push(...toAppend);
  return { appended: toAppend.length, total: buffer.items.length };
}

/** CSV 值转义 */
const escapeCsvValue = (value: any): string => {
  const str = value === null || value === undefined ? '' : String(value);
  // 如果包含逗号、引号、换行，需要用引号包裹并转义引号
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

/** 获取缓冲区所有字段名 */
const getFields = (items: Record<string, any>[]): string[] => {
  const fieldSet = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      fieldSet.add(key);
    }
  }
  return Array.from(fieldSet);
};

/** 执行过滤操作 */
const applyFilter = (
  items: Record<string, any>[],
  field: string,
  op: string,
  value: any,
): Record<string, any>[] => {
  return items.filter(item => {
    const fieldValue = item[field];
    switch (op) {
      case 'eq': return fieldValue == value;
      case 'neq': return fieldValue != value;
      case 'gt': return Number(fieldValue) > Number(value);
      case 'gte': return Number(fieldValue) >= Number(value);
      case 'lt': return Number(fieldValue) < Number(value);
      case 'lte': return Number(fieldValue) <= Number(value);
      case 'contains': return String(fieldValue || '').includes(String(value));
      case 'not_contains': return !String(fieldValue || '').includes(String(value));
      case 'regex': {
        try {
          const regex = new RegExp(String(value));
          return regex.test(String(fieldValue || ''));
        } catch {
          return false;
        }
      }
      default: return true;
    }
  });
};

/** 格式化数据为指定格式 */
const formatData = (items: Record<string, any>[], format: string): { content: string; mimeType: string; ext: string } => {
  const fields = getFields(items);

  switch (format) {
    case 'json':
      return {
        content: JSON.stringify(items, null, 2),
        mimeType: 'application/json',
        ext: 'json',
      };

    case 'csv': {
      const header = fields.map(f => escapeCsvValue(f)).join(',');
      const rows = items.map(item =>
        fields.map(f => escapeCsvValue(item[f])).join(','),
      );
      return {
        content: [header, ...rows].join('\n'),
        mimeType: 'text/csv',
        ext: 'csv',
      };
    }

    case 'tsv': {
      const header = fields.join('\t');
      const rows = items.map(item =>
        fields.map(f => {
          const val = item[f];
          return val === null || val === undefined ? '' : String(val).replace(/\t/g, ' ');
        }).join('\t'),
      );
      return {
        content: [header, ...rows].join('\n'),
        mimeType: 'text/tab-separated-values',
        ext: 'tsv',
      };
    }

    case 'markdown': {
      if (fields.length === 0 || items.length === 0) {
        return { content: '（空数据）', mimeType: 'text/markdown', ext: 'md' };
      }
      const headerRow = '| ' + fields.join(' | ') + ' |';
      const separatorRow = '| ' + fields.map(() => '---').join(' | ') + ' |';
      const dataRows = items.map(item =>
        '| ' + fields.map(f => {
          const val = item[f];
          const str = val === null || val === undefined ? '' : String(val);
          // 转义 Markdown 表格中的管道符
          return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        }).join(' | ') + ' |',
      );
      return {
        content: [headerRow, separatorRow, ...dataRows].join('\n'),
        mimeType: 'text/markdown',
        ext: 'md',
      };
    }

    default:
      return {
        content: JSON.stringify(items, null, 2),
        mimeType: 'application/json',
        ext: 'json',
      };
  }
};

export const dataPipelineFunction: FunctionDefinition = {
  name: 'data_pipeline',
  description: 'Data pipeline tool: buffering, transformation (filter/sort/deduplicate/field selection) and export (JSON/CSV/Markdown/TSV)',
  supportsParallel: false,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'append', 'preview', 'transform', 'export', 'stats', 'clear'],
        description: 'Action type',
      },
      buffer_id: {
        type: 'string',
        description: 'Buffer ID (auto-generated for action=create, required for other actions)',
      },
      name: {
        type: 'string',
        description: 'Buffer name (optional for action=create)',
      },
      data: {
        type: 'array',
        items: { type: 'object' },
        description: 'Data to append (used when action=append)',
      },
      limit: {
        type: 'number',
        description: 'Number of items to preview, default 5 (used when action=preview)',
      },
      offset: {
        type: 'number',
        description: 'Preview offset (used when action=preview)',
      },
      operations: {
        type: 'array',
        description: 'List of transformation operations (action=transform, executed in order). Supports: filter/sort/deduplicate/pick/omit/rename/limit',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['filter', 'sort', 'deduplicate', 'pick', 'omit', 'rename', 'limit'],
            },
            field: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            op: {
              type: 'string',
              enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'regex'],
            },
            value: {},
            order: { type: 'string', enum: ['asc', 'desc'] },
            from: { type: 'string' },
            to: { type: 'string' },
            count: { type: 'number' },
          },
        },
      },
      format: {
        type: 'string',
        enum: ['json', 'csv', 'markdown', 'tsv'],
        description: 'Export format (used when action=export)',
      },
      filename: {
        type: 'string',
        description: 'Export filename (optional for action=export)',
      },
    },
    required: ['action'],
  },

  execute: async (params: {
    action: string;
    buffer_id?: string;
    name?: string;
    data?: Record<string, any>[];
    limit?: number;
    offset?: number;
    operations?: any[];
    format?: string;
    filename?: string;
  }): Promise<FunctionResult> => {
    const { action } = params;

    try {
      switch (action) {
        // ============ 创建缓冲区 ============
        case 'create': {
          if (bufferStore.size >= MAX_BUFFER_COUNT) {
            return { success: false, error: `缓冲区数量已达上限（${MAX_BUFFER_COUNT}个），请先清理不需要的缓冲区` };
          }
          const id = generateBufferId();
          const name = params.name || `数据集_${new Date().toLocaleString('zh-CN')}`;
          const buffer: DataBuffer = {
            id,
            name,
            items: [],
            createdAt: Date.now(),
          };
          bufferStore.set(id, buffer);
          return {
            success: true,
            data: { buffer_id: id, name },
          };
        }

        // ============ 追加数据 ============
        case 'append': {
          if (!params.buffer_id) {
            return { success: false, error: '需要提供 buffer_id' };
          }
          if (!params.data || !Array.isArray(params.data) || params.data.length === 0) {
            return { success: false, error: '需要提供非空的 data 数组' };
          }
          const result = appendToBuffer(params.buffer_id, params.data);
          return {
            success: true,
            data: {
              appended_count: result.appended,
              total_count: result.total,
            },
          };
        }

        // ============ 预览数据 ============
        case 'preview': {
          if (!params.buffer_id) {
            return { success: false, error: '需要提供 buffer_id' };
          }
          const buffer = bufferStore.get(params.buffer_id);
          if (!buffer) {
            return { success: false, error: `缓冲区 ${params.buffer_id} 不存在` };
          }
          const limit = params.limit || 5;
          const offset = params.offset || 0;
          const items = buffer.items.slice(offset, offset + limit);
          return {
            success: true,
            data: {
              items,
              total_count: buffer.items.length,
              fields: getFields(buffer.items),
              showing: { offset, limit, count: items.length },
            },
          };
        }

        // ============ 转换数据 ============
        case 'transform': {
          if (!params.buffer_id) {
            return { success: false, error: '需要提供 buffer_id' };
          }
          const buffer = bufferStore.get(params.buffer_id);
          if (!buffer) {
            return { success: false, error: `缓冲区 ${params.buffer_id} 不存在` };
          }
          if (!params.operations || !Array.isArray(params.operations) || params.operations.length === 0) {
            return { success: false, error: '需要提供 operations 数组' };
          }

          const beforeCount = buffer.items.length;
          let items = [...buffer.items];
          const appliedOps: string[] = [];

          for (const op of params.operations) {
            switch (op.type) {
              case 'filter': {
                if (!op.field || !op.op) {
                  appliedOps.push('filter（跳过：缺少 field 或 op）');
                  break;
                }
                items = applyFilter(items, op.field, op.op, op.value);
                appliedOps.push(`filter: ${op.field} ${op.op} ${JSON.stringify(op.value)}`);
                break;
              }

              case 'sort': {
                if (!op.field) {
                  appliedOps.push('sort（跳过：缺少 field）');
                  break;
                }
                const order = op.order || 'asc';
                items.sort((a, b) => {
                  const va = a[op.field];
                  const vb = b[op.field];
                  // 尝试数值比较
                  const na = Number(va);
                  const nb = Number(vb);
                  if (!isNaN(na) && !isNaN(nb)) {
                    return order === 'asc' ? na - nb : nb - na;
                  }
                  // 字符串比较
                  const sa = String(va || '');
                  const sb = String(vb || '');
                  return order === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
                });
                appliedOps.push(`sort: ${op.field} ${order}`);
                break;
              }

              case 'deduplicate': {
                if (!op.fields || !Array.isArray(op.fields) || op.fields.length === 0) {
                  appliedOps.push('deduplicate（跳过：缺少 fields）');
                  break;
                }
                const seen = new Set<string>();
                items = items.filter(item => {
                  const key = op.fields.map((f: string) => JSON.stringify(item[f] ?? null)).join('|');
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                appliedOps.push(`deduplicate: ${op.fields.join(', ')}`);
                break;
              }

              case 'pick': {
                if (!op.fields || !Array.isArray(op.fields) || op.fields.length === 0) {
                  appliedOps.push('pick（跳过：缺少 fields）');
                  break;
                }
                items = items.map(item => {
                  const newItem: Record<string, any> = {};
                  for (const f of op.fields) {
                    if (f in item) {
                      newItem[f] = item[f];
                    }
                  }
                  return newItem;
                });
                appliedOps.push(`pick: ${op.fields.join(', ')}`);
                break;
              }

              case 'omit': {
                if (!op.fields || !Array.isArray(op.fields) || op.fields.length === 0) {
                  appliedOps.push('omit（跳过：缺少 fields）');
                  break;
                }
                items = items.map(item => {
                  const newItem = { ...item };
                  for (const f of op.fields) {
                    delete newItem[f];
                  }
                  return newItem;
                });
                appliedOps.push(`omit: ${op.fields.join(', ')}`);
                break;
              }

              case 'rename': {
                if (!op.from || !op.to) {
                  appliedOps.push('rename（跳过：缺少 from 或 to）');
                  break;
                }
                items = items.map(item => {
                  if (!(op.from in item)) return item;
                  const newItem = { ...item };
                  newItem[op.to] = newItem[op.from];
                  delete newItem[op.from];
                  return newItem;
                });
                appliedOps.push(`rename: ${op.from} → ${op.to}`);
                break;
              }

              case 'limit': {
                if (!op.count || op.count <= 0) {
                  appliedOps.push('limit（跳过：缺少有效的 count）');
                  break;
                }
                items = items.slice(0, op.count);
                appliedOps.push(`limit: ${op.count}`);
                break;
              }

              default:
                appliedOps.push(`未知操作: ${op.type}`);
            }
          }

          // 原地修改缓冲区数据
          buffer.items = items;
          return {
            success: true,
            data: {
              before_count: beforeCount,
              after_count: items.length,
              operations_applied: appliedOps,
            },
          };
        }

        // ============ 导出数据 ============
        case 'export': {
          if (!params.buffer_id) {
            return { success: false, error: '需要提供 buffer_id' };
          }
          const buffer = bufferStore.get(params.buffer_id);
          if (!buffer) {
            return { success: false, error: `缓冲区 ${params.buffer_id} 不存在` };
          }
          if (buffer.items.length === 0) {
            return { success: false, error: '缓冲区为空，无数据可导出' };
          }

          const format = params.format || 'json';
          const formatted = formatData(buffer.items, format);
          const defaultFilename = `${buffer.name.replace(/[^\w\u4e00-\u9fff-]/g, '_')}.${formatted.ext}`;
          const filename = params.filename || defaultFilename;

          // 使用 base64 data URL 方式下载（参考 download-file.ts）
          const base64 = btoa(unescape(encodeURIComponent(formatted.content)));
          const downloadUrl = `data:${formatted.mimeType};charset=utf-8;base64,${base64}`;

          const downloadId = await chrome.downloads.download({
            url: downloadUrl,
            filename,
          });

          return {
            success: true,
            data: {
              filename,
              format,
              size_bytes: new Blob([formatted.content]).size,
              row_count: buffer.items.length,
              download_id: downloadId,
            },
          };
        }

        // ============ 统计信息 ============
        case 'stats': {
          if (!params.buffer_id) {
            return { success: false, error: '需要提供 buffer_id' };
          }
          const buffer = bufferStore.get(params.buffer_id);
          if (!buffer) {
            return { success: false, error: `缓冲区 ${params.buffer_id} 不存在` };
          }

          const fields = getFields(buffer.items);
          const fieldStats: Record<string, { non_null_count: number }> = {};
          for (const field of fields) {
            let nonNullCount = 0;
            for (const item of buffer.items) {
              if (item[field] !== null && item[field] !== undefined && item[field] !== '') {
                nonNullCount++;
              }
            }
            fieldStats[field] = { non_null_count: nonNullCount };
          }

          // 粗略估算内存占用
          const memoryBytes = new Blob([JSON.stringify(buffer.items)]).size;

          return {
            success: true,
            data: {
              buffer_id: buffer.id,
              name: buffer.name,
              count: buffer.items.length,
              fields,
              field_stats: fieldStats,
              memory_bytes: memoryBytes,
              created_at: buffer.createdAt,
            },
          };
        }

        // ============ 清空/删除缓冲区 ============
        case 'clear': {
          if (!params.buffer_id) {
            return { success: false, error: '需要提供 buffer_id' };
          }
          const existed = bufferStore.delete(params.buffer_id);
          if (!existed) {
            return { success: false, error: `缓冲区 ${params.buffer_id} 不存在` };
          }
          return {
            success: true,
            data: { cleared: true },
          };
        }

        default:
          return { success: false, error: `不支持的操作: ${action}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message || '数据管道操作失败' };
    }
  },
};
