/**
 * AI 持久化键值存储工具
 * 使用 chrome.storage.local 实现，加命名空间前缀防止冲突
 */

import type { FunctionDefinition } from './types';

const STORAGE_PREFIX = 'mole_kv_';
const MAX_KEYS = 100;
const MAX_VALUE_SIZE = 10240; // 10KB per value

export const storageKvFunction: FunctionDefinition = {
  name: 'storage_kv',
  description: 'Persistent key-value storage for saving and reading data. AI can use this tool to remember user preferences, save temporary data, and pass information across conversations. Supports: get (read), set (save), delete (remove), list (list all keys). Data is persisted in the browser and available across sessions.',
  supportsParallel: false,
  permissionLevel: 'interact',
  actionPermissions: { delete: 'sensitive' },
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set', 'delete', 'list'],
        description: 'Action type: get (read), set (save), delete (remove), list (list all keys)',
      },
      key: {
        type: 'string',
        description: 'Key name (used for action=get/set/delete)',
      },
      value: {
        type: 'string',
        description: 'Value to save (required when action=set). JSON strings recommended for structured data',
      },
    },
    required: ['action'],
  },
  execute: async (params: { action: string; key?: string; value?: string }) => {
    const { action, key, value } = params;

    switch (action) {
      case 'get': {
        if (!key) return { success: false, error: '读取操作需要提供 key' };
        const storageKey = STORAGE_PREFIX + key;
        const result = await chrome.storage.local.get(storageKey);
        const storedValue = result[storageKey];
        if (storedValue === undefined) {
          return { success: true, data: { key, value: null, message: `键 "${key}" 不存在` } };
        }
        return { success: true, data: { key, value: storedValue } };
      }

      case 'set': {
        if (!key) return { success: false, error: '保存操作需要提供 key' };
        if (value === undefined) return { success: false, error: '保存操作需要提供 value' };
        if (value.length > MAX_VALUE_SIZE) {
          return { success: false, error: `值太大（${value.length} 字符），最大 ${MAX_VALUE_SIZE} 字符` };
        }

        // 检查键数量限制
        const allData = await chrome.storage.local.get(null);
        const kvKeys = Object.keys(allData).filter(k => k.startsWith(STORAGE_PREFIX));
        const storageKey = STORAGE_PREFIX + key;
        if (kvKeys.length >= MAX_KEYS && !kvKeys.includes(storageKey)) {
          return { success: false, error: `已达到最大存储键数（${MAX_KEYS}），请先删除一些键` };
        }

        await chrome.storage.local.set({ [storageKey]: value });
        return { success: true, data: { key, message: `已保存键 "${key}"` } };
      }

      case 'delete': {
        if (!key) return { success: false, error: '删除操作需要提供 key' };
        const delKey = STORAGE_PREFIX + key;
        await chrome.storage.local.remove(delKey);
        return { success: true, data: { key, message: `已删除键 "${key}"` } };
      }

      case 'list': {
        const allData = await chrome.storage.local.get(null);
        const kvEntries = Object.entries(allData)
          .filter(([k]) => k.startsWith(STORAGE_PREFIX))
          .map(([k, v]) => ({
            key: k.replace(STORAGE_PREFIX, ''),
            value_preview: String(v).slice(0, 100),
            size: String(v).length,
          }));
        return {
          success: true,
          data: { total: kvEntries.length, max_keys: MAX_KEYS, entries: kvEntries },
        };
      }

      default:
        return { success: false, error: `不支持的操作: ${action}` };
    }
  },
};
