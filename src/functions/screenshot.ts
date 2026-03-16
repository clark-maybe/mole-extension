/**
 * 页面截图工具
 * 默认使用 chrome.tabs.captureVisibleTab() 截取可见区域
 * 当指定 clip / full_page / element_id 时，走 CDP Page.captureScreenshot 路径
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { ArtifactStore } from '../lib/artifact-store';
import { CDPSessionManager } from '../lib/cdp-session';
import { sendToTabWithRetry } from './tab-message';
import { sleep, waitForTabComplete } from './tab-utils';

const waitUntilTabReady = async (tabId: number, timeoutMs: number, signal?: AbortSignal): Promise<void> => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
  } catch {
    // ignore
  }
  await waitForTabComplete(tabId, timeoutMs, `页面加载超时（${timeoutMs}ms）`, signal);
};

/** 通过 element_id 查询元素在视口中的矩形区域 */
const resolveElementRect = async (
  tabId: number,
  elementId: string,
  signal?: AbortSignal,
): Promise<{ x: number; y: number; width: number; height: number } | null> => {
  try {
    const resp = await sendToTabWithRetry(tabId, '__get_element_rect', { element_id: elementId }, signal);
    if (resp?.success && resp.rect) {
      return resp.rect;
    }
    return null;
  } catch {
    return null;
  }
};

export const screenshotFunction: FunctionDefinition = {
  name: 'screenshot',
  description: '截取标签页截图。默认截取可见区域；支持区域截图（clip）、全页截图（full_page）、元素截图（element_id）。也支持先打开指定 URL 后截图。',
  supportsParallel: true,
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: '图片格式，默认 png',
      },
      quality: {
        type: 'number',
        description: '图片质量（仅 jpeg 有效），0-100，默认 80',
      },
      url: {
        type: 'string',
        description: '可选：先打开该 URL 再截图。适合需要去新页面取证的任务。',
      },
      tab_id: {
        type: 'number',
        description: '可选：对指定 tab_id 截图（会临时切换到该标签页）。',
      },
      wait_ms: {
        type: 'number',
        description: '等待页面加载超时时间（毫秒），默认 15000。',
      },
      close_after_capture: {
        type: 'boolean',
        description: '当通过 url 新开标签页截图时，截图后是否关闭该标签页。默认 true。',
      },
      preserve_focus: {
        type: 'boolean',
        description: '截图后是否恢复到原先标签页焦点。默认 true。',
      },
      clip: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '左上角 x 坐标（视口坐标）' },
          y: { type: 'number', description: '左上角 y 坐标（视口坐标）' },
          width: { type: 'number', description: '截取宽度（像素）' },
          height: { type: 'number', description: '截取高度（像素）' },
        },
        required: ['x', 'y', 'width', 'height'],
        description: '截取指定区域（视口坐标）。使用 CDP 实现。',
      },
      full_page: {
        type: 'boolean',
        description: '是否截取完整页面（包括滚动区域）。使用 CDP 实现。默认 false。',
      },
      element_id: {
        type: 'string',
        description: 'page_snapshot 返回的元素句柄，自动截取该元素区域。使用 CDP 实现。',
      },
    },
    required: [],
  },
  execute: async (
    params: {
      format?: string;
      quality?: number;
      url?: string;
      tab_id?: number;
      wait_ms?: number;
      close_after_capture?: boolean;
      preserve_focus?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      full_page?: boolean;
      element_id?: string;
    },
    context?: ToolExecutionContext,
  ) => {
    const {
      format = 'png',
      quality = 80,
      url,
      tab_id,
      wait_ms = 15_000,
      close_after_capture = true,
      preserve_focus = true,
      clip,
      full_page = false,
      element_id,
    } = params;
    const normalizedWaitMs = Math.max(3_000, Math.floor(wait_ms));
    let originalTabId: number | undefined;
    let targetTabId: number | undefined;
    let createdTempTab = false;
    const signal = context?.signal;

    // 校验 clip 参数有效性（宽高必须 > 0）
    const validClip = clip && clip.width > 0 && clip.height > 0 ? clip : undefined;

    // 判断是否需要走 CDP 路径
    const useCDP = Boolean(validClip || full_page || element_id);

    try {
      const [currentActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      originalTabId = currentActiveTab?.id;

      let targetTab: chrome.tabs.Tab | undefined;

      if (typeof tab_id === 'number' && tab_id > 0) {
        targetTab = await chrome.tabs.get(tab_id);
      } else if (typeof context?.tabId === 'number' && context.tabId > 0) {
        targetTab = await chrome.tabs.get(context.tabId);
      } else {
        targetTab = currentActiveTab;
      }

      if (url) {
        targetTab = await chrome.tabs.create({
          url,
          active: true,
        });
        createdTempTab = true;
      } else if (targetTab?.id && !targetTab.active) {
        targetTab = await chrome.tabs.update(targetTab.id, { active: true });
      }

      targetTabId = targetTab?.id;
      const targetWindowId = targetTab?.windowId;
      if (!targetTabId || typeof targetWindowId !== 'number') {
        return { success: false, error: '无法确定截图目标标签页' };
      }

      await waitUntilTabReady(targetTabId, normalizedWaitMs, signal);
      await sleep(260, signal);

      let base64Data: string;
      let screenshotMode = '可见区域';

      if (useCDP) {
        // === CDP 截图路径 ===
        const cdpParams: Record<string, any> = {
          format: format === 'jpeg' ? 'jpeg' : 'png',
        };
        if (format === 'jpeg') {
          cdpParams.quality = quality;
        }

        // element_id → 查询元素 rect → 转为 clip
        let resolvedClip = validClip;
        if (element_id && !resolvedClip) {
          const rect = await resolveElementRect(targetTabId, element_id, signal);
          if (!rect) {
            return { success: false, error: `无法获取元素 ${element_id} 的位置信息，元素可能已不存在` };
          }
          resolvedClip = rect;
          screenshotMode = `元素截图(${element_id})`;
        }

        if (resolvedClip) {
          // CDP clip 需要 scale 参数
          cdpParams.clip = {
            x: resolvedClip.x,
            y: resolvedClip.y,
            width: resolvedClip.width,
            height: resolvedClip.height,
            scale: 1,
          };
          if (!element_id) {
            screenshotMode = `区域截图(${resolvedClip.x},${resolvedClip.y} ${resolvedClip.width}x${resolvedClip.height})`;
          }
        }

        if (full_page) {
          cdpParams.captureBeyondViewport = true;
          // 全页截图需要先获取页面完整尺寸作为 clip
          if (!resolvedClip) {
            const layoutResult = await CDPSessionManager.sendCommand(
              targetTabId,
              'Page.getLayoutMetrics',
            );
            if (layoutResult.success && layoutResult.result) {
              const { contentSize } = layoutResult.result;
              if (contentSize) {
                cdpParams.clip = {
                  x: 0,
                  y: 0,
                  width: contentSize.width,
                  height: contentSize.height,
                  scale: 1,
                };
              }
            }
            screenshotMode = '全页截图';
          }
        }

        const cdpResult = await CDPSessionManager.sendCommand(
          targetTabId,
          'Page.captureScreenshot',
          cdpParams,
        );

        if (!cdpResult.success) {
          return { success: false, error: `CDP 截图失败: ${cdpResult.error}` };
        }

        base64Data = cdpResult.result?.data || '';
      } else {
        // === 原有 captureVisibleTab 路径 ===
        const dataUrl = await chrome.tabs.captureVisibleTab(targetWindowId, {
          format: format as 'png' | 'jpeg',
          quality: format === 'jpeg' ? quality : undefined,
        });
        base64Data = dataUrl.split(',')[1] || '';
      }

      const sizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
      // CDP 返回纯 base64，需要加 data URL 前缀
      const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const dataUrlForStorage = useCDP
        ? `data:${mimeType};base64,${base64Data}`
        : `data:${mimeType};base64,${base64Data}`;
      const artifact = await ArtifactStore.saveScreenshot(dataUrlForStorage, format as 'png' | 'jpeg', sizeKB);

      return {
        success: true,
        data: {
          artifact_id: artifact.id,
          format,
          sizeKB,
          target_tab_id: targetTabId,
          target_url: url || targetTab?.url,
          mode: screenshotMode,
          message: `${screenshotMode}完成（${format}，约 ${sizeKB}KB）`,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || '截图失败' };
    } finally {
      if (createdTempTab && close_after_capture && targetTabId) {
        try {
          await chrome.tabs.remove(targetTabId);
        } catch {
          // ignore
        }
      }

      if (preserve_focus && originalTabId && (!targetTabId || originalTabId !== targetTabId)) {
        try {
          await chrome.tabs.update(originalTabId, { active: true });
        } catch {
          // ignore
        }
      }
    }
  },
};
