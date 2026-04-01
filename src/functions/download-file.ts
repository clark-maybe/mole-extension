/**
 * 文件下载工具
 * 使用 chrome.downloads API 下载文件或将文本内容保存为文件
 */

import type { FunctionDefinition } from './types';

/** 根据文件名后缀推断 MIME 类型 */
const inferMimeType = (filename?: string): string => {
  if (!filename) return 'text/plain';
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    json: 'application/json',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    xml: 'application/xml',
    md: 'text/markdown',
    txt: 'text/plain',
    js: 'application/javascript',
    css: 'text/css',
  };
  return mimeMap[ext || ''] || 'text/plain';
};

export const downloadFileFunction: FunctionDefinition = {
  name: 'download_file',
  description: '下载文件到用户电脑。可以下载指定URL的文件，或将文本内容保存为文件。适用于：下载网页资源、保存AI整理的内容为文件、导出数据。',
  supportsParallel: true,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要下载的文件 URL。与 content 二选一',
      },
      content: {
        type: 'string',
        description: '要保存为文件的文本内容。与 url 二选一',
      },
      filename: {
        type: 'string',
        description: '保存的文件名（如 "report.txt"、"data.json"）。不传则自动推断',
      },
    },
    required: [],
  },
  validate: (params: { url?: string; content?: string }) => {
    if (!params.url && !params.content) {
      return '需要提供 url 或 content';
    }
    if (params.url && params.content) {
      return 'url 与 content 只能二选一';
    }
    if (params.url && !/^https?:\/\//i.test(params.url)) {
      return 'url 必须是 http/https 链接';
    }
    return null;
  },
  execute: async (params: { url?: string; content?: string; filename?: string }) => {
    const { url, content, filename } = params;

    if (!url && !content) {
      return { success: false, error: '需要提供 url 或 content' };
    }

    try {
      let downloadUrl = url;

      // 如果是文本内容，转为 data URL
      if (content && !url) {
        // 根据文件名后缀推断 MIME 类型
        const mime = inferMimeType(filename);
        const base64 = btoa(unescape(encodeURIComponent(content)));
        downloadUrl = `data:${mime};charset=utf-8;base64,${base64}`;
      }

      if (!downloadUrl) {
        return { success: false, error: '无法生成下载链接' };
      }

      const downloadOptions: chrome.downloads.DownloadOptions = {
        url: downloadUrl,
      };
      if (filename) {
        downloadOptions.filename = filename;
      }

      const downloadId = await chrome.downloads.download(downloadOptions);

      return {
        success: true,
        data: {
          message: filename ? `已开始下载：${filename}` : '已开始下载',
          download_id: downloadId,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || '下载失败' };
    }
  },
};
