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
  description: 'Download a file to the user\'s computer. Can download a file from a given URL, or save text content as a file. Use cases: download web resources, save AI-organized content as a file, export data.',
  supportsParallel: true,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'File URL to download. Mutually exclusive with content/artifact_id',
      },
      content: {
        type: 'string',
        description: 'Text content to save as a file. Mutually exclusive with url/artifact_id',
      },
      artifact_id: {
        type: 'string',
        description: 'Screenshot artifact ID (returned by the screenshot tool). Automatically retrieves the image from local storage and downloads it',
      },
      filename: {
        type: 'string',
        description: 'Filename to save as (e.g. "report.txt", "data.json", "screenshot.png"). Auto-inferred if omitted',
      },
    },
    required: [],
  },
  validate: (params: { url?: string; content?: string; artifact_id?: string }) => {
    const sources = [params.url, params.content, params.artifact_id].filter(Boolean).length;
    if (sources === 0) {
      return 'One of url, content, or artifact_id is required';
    }
    if (sources > 1) {
      return 'Only one of url, content, or artifact_id can be provided';
    }
    if (params.url && !/^https?:\/\//i.test(params.url)) {
      return 'url must be an http/https link';
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
