/**
 * 文件下载工具
 * 使用 chrome.downloads API 下载文件或将文本内容保存为文件
 */

import type { FunctionDefinition } from './types';
import { ArtifactStore } from '../lib/artifact-store';

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
        description: '要下载的文件 URL。与 content/artifact_id 三选一',
      },
      content: {
        type: 'string',
        description: '要保存为文件的文本内容。与 url/artifact_id 三选一',
      },
      artifact_id: {
        type: 'string',
        description: '截图 artifact ID（由 screenshot 工具返回）。传入后自动从本地存储取出图片并下载',
      },
      filename: {
        type: 'string',
        description: '保存的文件名（如 "report.txt"、"data.json"、"screenshot.png"）。不传则自动推断',
      },
    },
    required: [],
  },
  validate: (params: { url?: string; content?: string; artifact_id?: string }) => {
    const sources = [params.url, params.content, params.artifact_id].filter(Boolean).length;
    if (sources === 0) {
      return '需要提供 url、content 或 artifact_id 其中之一';
    }
    if (sources > 1) {
      return 'url、content、artifact_id 只能三选一';
    }
    if (params.url && !/^https?:\/\//i.test(params.url)) {
      return 'url 必须是 http/https 链接';
    }
    return null;
  },
  execute: async (params: { url?: string; content?: string; artifact_id?: string; filename?: string }) => {
    const { url, content, artifact_id, filename } = params;

    const sources = [url, content, artifact_id].filter(Boolean).length;
    if (sources === 0) {
      return { success: false, error: '需要提供 url、content 或 artifact_id' };
    }

    try {
      let downloadUrl = url;

      // 如果传入了 artifact_id，从 ArtifactStore 取出 dataUrl
      if (artifact_id) {
        const artifact = await ArtifactStore.getScreenshot(artifact_id);
        if (!artifact) {
          return { success: false, error: `截图不存在或已过期：${artifact_id}` };
        }
        downloadUrl = artifact.dataUrl;
      }

      // 如果是文本内容，转为 data URL
      if (content && !url && !artifact_id) {
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
