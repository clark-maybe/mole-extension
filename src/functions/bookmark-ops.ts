/**
 * 浏览器收藏夹管理工具
 * 使用 chrome.bookmarks API 实现收藏夹的增删改查、树导出与统计。
 */

import type { FunctionDefinition } from './types';

type BookmarkSortBy = 'date_added' | 'title' | 'url' | 'path';
type SortOrder = 'asc' | 'desc';

interface FlatBookmarkItem {
  bookmark_id: string;
  type: 'bookmark' | 'folder';
  title: string;
  url?: string;
  folder: string;
  parent_id?: string;
  parent_title?: string;
  index?: number;
  date_added_ms?: number;
  date_added?: string;
  date_group_modified?: string;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

const toLocaleTime = (ts?: number): string | undefined => (ts ? new Date(ts).toLocaleString('zh-CN') : undefined);

const clampLimit = (input?: number): number => {
  const value = Math.floor(Number(input) || DEFAULT_LIMIT);
  return Math.min(Math.max(1, value), MAX_LIMIT);
};

const clampOffset = (input?: number): number => {
  const value = Math.floor(Number(input) || 0);
  return Math.max(0, value);
};

const isFolderNode = (node: chrome.bookmarks.BookmarkTreeNode): boolean => !node.url;

const buildFlatList = (
  roots: chrome.bookmarks.BookmarkTreeNode[],
  options?: { includeFolders?: boolean },
): FlatBookmarkItem[] => {
  const includeFolders = !!options?.includeFolders;
  const items: FlatBookmarkItem[] = [];

  const walk = (
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    folderPath: string,
    parentId?: string,
    parentTitle?: string,
  ) => {
    for (const node of nodes) {
      if (isFolderNode(node)) {
        const isVirtualRoot = node.id === '0';
        const currentPath = isVirtualRoot
          ? folderPath
          : (folderPath ? `${folderPath}/${node.title}` : (node.title || '未命名文件夹'));

        if (!isVirtualRoot && includeFolders) {
          items.push({
            bookmark_id: node.id,
            type: 'folder',
            title: node.title || '未命名文件夹',
            folder: currentPath,
            parent_id: parentId,
            parent_title: parentTitle,
            index: node.index,
            date_added_ms: node.dateAdded,
            date_added: toLocaleTime(node.dateAdded),
            date_group_modified: toLocaleTime(node.dateGroupModified),
          });
        }

        if (node.children?.length) {
          walk(node.children, currentPath, node.id, node.title || undefined);
        }
      } else {
        items.push({
          bookmark_id: node.id,
          type: 'bookmark',
          title: node.title || node.url || '未命名收藏',
          url: node.url,
          folder: folderPath || '根目录',
          parent_id: parentId,
          parent_title: parentTitle,
          index: node.index,
          date_added_ms: node.dateAdded,
          date_added: toLocaleTime(node.dateAdded),
          date_group_modified: toLocaleTime(node.dateGroupModified),
        });
      }
    }
  };

  walk(roots, '');
  return items;
};

const sortItems = (items: FlatBookmarkItem[], sortBy: BookmarkSortBy, order: SortOrder): FlatBookmarkItem[] => {
  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'date_added') {
      const ta = a.date_added_ms || 0;
      const tb = b.date_added_ms || 0;
      return ta - tb;
    }
    if (sortBy === 'url') {
      return (a.url || '').localeCompare(b.url || '', 'zh-CN');
    }
    if (sortBy === 'path') {
      return `${a.folder}/${a.title}`.localeCompare(`${b.folder}/${b.title}`, 'zh-CN');
    }
    return a.title.localeCompare(b.title, 'zh-CN');
  });
  return order === 'desc' ? sorted.reverse() : sorted;
};

const paginateItems = <T>(items: T[], limit: number, offset: number) => {
  const total = items.length;
  const sliced = items.slice(offset, offset + limit);
  const nextOffset = offset + sliced.length;
  return {
    total,
    offset,
    limit,
    has_more: nextOffset < total,
    next_offset: nextOffset < total ? nextOffset : null,
    items: sliced,
  };
};

const getTabFallback = async (context?: { tabId?: number }) => {
  if (context?.tabId) {
    try {
      return await chrome.tabs.get(context.tabId);
    } catch {
      // ignore
    }
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab;
};

export const bookmarkOpsFunction: FunctionDefinition = {
  name: 'bookmark_ops',
  description: [
    '管理浏览器收藏夹。支持：',
    '- add：收藏当前页或指定 URL（可指定目标文件夹）',
    '- search：关键词搜索收藏（支持分页）',
    '- recent：最近收藏列表',
    '- list：按文件夹列出收藏（可递归）',
    '- getAll/get_all：导出全部收藏（支持分页，避免结果截断）',
    '- get：根据 ID 获取单条收藏',
    '- update：更新收藏标题/URL',
    '- move：移动收藏到目标文件夹',
    '- create_folder：创建收藏文件夹',
    '- delete：删除收藏（文件夹会递归删除）',
    '- stats：收藏统计信息',
  ].join('\n'),
  supportsParallel: false,
  permissionLevel: 'read',
  actionPermissions: { delete: 'sensitive' },
  approvalMessageTemplate: { delete: 'AI 正在请求删除收藏 "{title}"' },
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'search', 'recent', 'list', 'getAll', 'get_all', 'get', 'update', 'move', 'create_folder', 'delete', 'stats'],
        description: '操作类型',
      },
      url: { type: 'string', description: '收藏 URL（add/update 时使用）' },
      title: { type: 'string', description: '收藏标题（add/update/create_folder 时可用）' },
      query: { type: 'string', description: '搜索关键词（search 时使用）' },
      bookmark_id: { type: 'string', description: '收藏 ID（get/update/move/delete 时使用）' },
      folder_id: { type: 'string', description: '文件夹 ID（add/list/create_folder 时可用）' },
      parent_id: { type: 'string', description: 'create_folder 的父级文件夹 ID（兼容参数）' },
      destination_folder_id: { type: 'string', description: 'move 的目标文件夹 ID' },
      index: { type: 'number', description: '插入/移动后的顺序（0 开始）' },
      include_folders: { type: 'boolean', description: '是否包含文件夹节点，默认 false' },
      recursive: { type: 'boolean', description: 'list 时是否递归列出子文件夹内容，默认 true' },
      sort_by: {
        type: 'string',
        enum: ['date_added', 'title', 'url', 'path'],
        description: '排序字段，默认 date_added',
      },
      sort_order: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: '排序方向，默认 desc',
      },
      limit: { type: 'number', description: `分页大小，默认 ${DEFAULT_LIMIT}，最大 ${MAX_LIMIT}` },
      offset: { type: 'number', description: '分页偏移，默认 0' },
    },
    required: ['action'],
  },
  execute: async (params: {
    action: string;
    url?: string;
    title?: string;
    query?: string;
    bookmark_id?: string;
    folder_id?: string;
    parent_id?: string;
    destination_folder_id?: string;
    index?: number;
    include_folders?: boolean;
    recursive?: boolean;
    sort_by?: BookmarkSortBy;
    sort_order?: SortOrder;
    limit?: number;
    offset?: number;
  }, context?: { tabId?: number }) => {
    const {
      action,
      url,
      title,
      query,
      bookmark_id,
      folder_id,
      parent_id,
      destination_folder_id,
      index,
      include_folders = false,
      recursive = true,
      sort_by = 'date_added',
      sort_order = 'desc',
    } = params;
    const limit = clampLimit(params.limit);
    const offset = clampOffset(params.offset);

    switch (action) {
      case 'add': {
        let bookmarkUrl = url;
        let bookmarkTitle = title;
        if (!bookmarkUrl) {
          const tab = await getTabFallback(context);
          bookmarkUrl = tab?.url;
          bookmarkTitle = bookmarkTitle || tab?.title;
        }
        if (!bookmarkUrl) {
          return { success: false, error: 'add 需要提供 url，或在有活动标签页上下文下调用' };
        }

        try {
          const bookmark = await chrome.bookmarks.create({
            parentId: folder_id,
            index: typeof index === 'number' ? Math.max(0, Math.floor(index)) : undefined,
            url: bookmarkUrl,
            title: bookmarkTitle || bookmarkUrl,
          });
          return {
            success: true,
            data: {
              message: `已添加收藏：${bookmark.title}`,
              bookmark_id: bookmark.id,
              parent_id: bookmark.parentId,
              index: bookmark.index,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '添加收藏失败' };
        }
      }

      case 'create_folder': {
        const targetParentId = folder_id || parent_id;
        try {
          const folder = await chrome.bookmarks.create({
            parentId: targetParentId,
            title: title || '新建文件夹',
            index: typeof index === 'number' ? Math.max(0, Math.floor(index)) : undefined,
          });
          return {
            success: true,
            data: {
              message: `已创建文件夹：${folder.title}`,
              folder_id: folder.id,
              parent_id: folder.parentId,
              index: folder.index,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '创建文件夹失败' };
        }
      }

      case 'get': {
        if (!bookmark_id) return { success: false, error: 'get 需要提供 bookmark_id' };
        try {
          const items = await chrome.bookmarks.get(bookmark_id);
          const item = items[0];
          if (!item) return { success: false, error: `未找到收藏: ${bookmark_id}` };
          return {
            success: true,
            data: {
              bookmark: {
                bookmark_id: item.id,
                type: item.url ? 'bookmark' : 'folder',
                title: item.title,
                url: item.url,
                parent_id: item.parentId,
                index: item.index,
                date_added_ms: item.dateAdded,
                date_added: toLocaleTime(item.dateAdded),
              },
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '获取收藏详情失败' };
        }
      }

      case 'update': {
        if (!bookmark_id) return { success: false, error: 'update 需要提供 bookmark_id' };
        if (!title && !url) return { success: false, error: 'update 至少需要 title 或 url 之一' };
        try {
          const updated = await chrome.bookmarks.update(bookmark_id, {
            title: title || undefined,
            url: url || undefined,
          });
          return {
            success: true,
            data: {
              message: `已更新收藏：${updated.title}`,
              bookmark_id: updated.id,
              title: updated.title,
              url: updated.url,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '更新收藏失败' };
        }
      }

      case 'move': {
        if (!bookmark_id) return { success: false, error: 'move 需要提供 bookmark_id' };
        if (!destination_folder_id) return { success: false, error: 'move 需要提供 destination_folder_id' };
        try {
          const moved = await chrome.bookmarks.move(bookmark_id, {
            parentId: destination_folder_id,
            index: typeof index === 'number' ? Math.max(0, Math.floor(index)) : undefined,
          });
          return {
            success: true,
            data: {
              message: `已移动收藏：${moved.title}`,
              bookmark_id: moved.id,
              parent_id: moved.parentId,
              index: moved.index,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '移动收藏失败' };
        }
      }

      case 'search': {
        if (!query) return { success: false, error: 'search 需要提供 query' };
        try {
          const results = await chrome.bookmarks.search(query);
          const normalized = results
            .filter((item) => include_folders || !!item.url)
            .map((item): FlatBookmarkItem => ({
              bookmark_id: item.id,
              type: item.url ? 'bookmark' : 'folder',
              title: item.title,
              url: item.url,
              folder: '',
              parent_id: item.parentId,
              index: item.index,
              date_added_ms: item.dateAdded,
              date_added: toLocaleTime(item.dateAdded),
              date_group_modified: toLocaleTime(item.dateGroupModified),
            }));
          const sorted = sortItems(normalized, sort_by, sort_order);
          const page = paginateItems(sorted, limit, offset);
          return {
            success: true,
            data: {
              query,
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              has_more: page.has_more,
              next_offset: page.next_offset,
              bookmarks: page.items,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '搜索收藏失败' };
        }
      }

      case 'recent': {
        try {
          const results = await chrome.bookmarks.getRecent(Math.max(limit + offset, limit));
          const normalized = results
            .filter((item) => include_folders || !!item.url)
            .map((item): FlatBookmarkItem => ({
              bookmark_id: item.id,
              type: item.url ? 'bookmark' : 'folder',
              title: item.title,
              url: item.url,
              folder: '',
              parent_id: item.parentId,
              index: item.index,
              date_added_ms: item.dateAdded,
              date_added: toLocaleTime(item.dateAdded),
              date_group_modified: toLocaleTime(item.dateGroupModified),
            }));
          const sorted = sortItems(normalized, 'date_added', 'desc');
          const page = paginateItems(sorted, limit, offset);
          return {
            success: true,
            data: {
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              has_more: page.has_more,
              next_offset: page.next_offset,
              bookmarks: page.items,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '获取最近收藏失败' };
        }
      }

      case 'list': {
        try {
          let roots: chrome.bookmarks.BookmarkTreeNode[];
          if (folder_id) {
            const subTree = await chrome.bookmarks.getSubTree(folder_id);
            if (subTree.length === 0) return { success: false, error: `未找到文件夹: ${folder_id}` };
            roots = recursive ? subTree : (subTree[0].children || []);
          } else {
            const tree = await chrome.bookmarks.getTree();
            roots = tree;
          }

          const flat = buildFlatList(roots, { includeFolders: include_folders });
          const sorted = sortItems(flat, sort_by, sort_order);
          const page = paginateItems(sorted, limit, offset);
          return {
            success: true,
            data: {
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              has_more: page.has_more,
              next_offset: page.next_offset,
              bookmarks: page.items,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '列出收藏失败' };
        }
      }

      case 'getAll':
      case 'get_all': {
        try {
          const tree = await chrome.bookmarks.getTree();
          const flat = buildFlatList(tree, { includeFolders: include_folders });
          const sorted = sortItems(flat, sort_by, sort_order);
          const page = paginateItems(sorted, limit, offset);
          return {
            success: true,
            data: {
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              has_more: page.has_more,
              next_offset: page.next_offset,
              message: page.has_more
                ? `已返回 ${page.items.length} 条，剩余请使用 offset=${page.next_offset} 继续获取`
                : `已返回全部 ${page.total} 条收藏`,
              bookmarks: page.items,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '获取全部收藏失败' };
        }
      }

      case 'stats': {
        try {
          const tree = await chrome.bookmarks.getTree();
          const flat = buildFlatList(tree, { includeFolders: true });
          const totalFolders = flat.filter((item) => item.type === 'folder').length;
          const totalBookmarks = flat.filter((item) => item.type === 'bookmark').length;
          const byFolder: Record<string, number> = {};
          for (const item of flat) {
            if (item.type !== 'bookmark') continue;
            byFolder[item.folder] = (byFolder[item.folder] || 0) + 1;
          }
          const topFolders = Object.entries(byFolder)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([folder, count]) => ({ folder, count }));

          return {
            success: true,
            data: {
              total_bookmarks: totalBookmarks,
              total_folders: totalFolders,
              top_folders: topFolders,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message || '统计收藏失败' };
        }
      }

      case 'delete': {
        if (!bookmark_id) return { success: false, error: 'delete 需要提供 bookmark_id' };
        try {
          const target = await chrome.bookmarks.get(bookmark_id);
          const node = target[0];
          if (!node) return { success: false, error: `未找到收藏: ${bookmark_id}` };
          if (node.url) {
            await chrome.bookmarks.remove(bookmark_id);
            return { success: true, data: { message: `已删除收藏 ${bookmark_id}` } };
          }
          await chrome.bookmarks.removeTree(bookmark_id);
          return { success: true, data: { message: `已删除文件夹（含子项）${bookmark_id}` } };
        } catch (err: any) {
          return { success: false, error: err.message || '删除收藏失败' };
        }
      }

      default:
        return { success: false, error: `不支持的操作: ${action}` };
    }
  },
};
