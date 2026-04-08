/**
 * 页面截图工具
 * 默认使用 chrome.tabs.captureVisibleTab() 截取可见区域
 * 当指定 clip / full_page / element_id 时，走 CDP Page.captureScreenshot 路径
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';
import { ArtifactStore } from '../lib/artifact-store';
import { CDPSessionManager } from '../lib/cdp-session';
import Channel from '../lib/channel';
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
  description: 'Capture a tab screenshot. By default captures the visible area; supports region screenshot (clip), full page screenshot (full_page), and element screenshot (element_id). Also supports opening a specified URL before capturing.\n\n⚠️ Do NOT use this tool for:\n- When you only need text information (use page_viewer, screenshots consume more tokens)\n- Getting a list of interactive elements (use page_snapshot)',
  supportsParallel: true,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Image format, default png',
      },
      quality: {
        type: 'number',
        description: 'Image quality (jpeg only), 0-100, default 80',
      },
      url: {
        type: 'string',
        description: 'Optional: open this URL first, then capture. Suitable for tasks that need to capture evidence from a new page.',
      },
      tab_id: {
        type: 'number',
        description: 'Optional: capture screenshot of the specified tab_id (will temporarily switch to that tab).',
      },
      wait_ms: {
        type: 'number',
        description: 'Page load timeout in milliseconds, default 15000.',
      },
      close_after_capture: {
        type: 'boolean',
        description: 'Whether to close the tab after capturing when opened via url. Default true.',
      },
      preserve_focus: {
        type: 'boolean',
        description: 'Whether to restore focus to the original tab after capturing. Default true.',
      },
      clip: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Top-left x coordinate (viewport coordinates)' },
          y: { type: 'number', description: 'Top-left y coordinate (viewport coordinates)' },
          width: { type: 'number', description: 'Capture width (pixels)' },
          height: { type: 'number', description: 'Capture height (pixels)' },
        },
        required: ['x', 'y', 'width', 'height'],
        description: 'Capture a specific region (viewport coordinates). Uses CDP.',
      },
      full_page: {
        type: 'boolean',
        description: 'Whether to capture the full page (including scrollable area). Uses CDP. Default false.',
      },
      element_id: {
        type: 'string',
        description: 'Element handle returned by page_snapshot, automatically captures that element region. Uses CDP.',
      },
      annotate: {
        type: 'boolean',
        description: 'Whether to annotate interactive elements with numbered labels on the screenshot. When enabled, element number markers are displayed on the screenshot and a mapping from numbers to element_id is returned. Useful when first entering a complex page to precisely locate elements. Only effective for visible area screenshots. Default false.',
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
      annotate?: boolean;
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
      annotate = false,
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

    // 标注模式仅对可见区域截图有效（非 CDP 路径）
    const shouldAnnotate = annotate && !useCDP;

    // 截图前临时隐藏悬浮球的状态标记（在 try 外声明，finally 中使用）
    let floatBallHidden = false;

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

      // 截图前临时隐藏悬浮球，避免遮挡页面内容
      try {
        await new Promise<void>((resolve) => {
          Channel.sendToTab(targetTabId!, '__screenshot_hide', {}, () => {
            floatBallHidden = true;
            resolve();
          });
          // 100ms 超时：content script 可能不在（如 chrome:// 页面）
          setTimeout(resolve, 100);
        });
        if (floatBallHidden) await sleep(80);
      } catch { /* 忽略 */ }

      // 视觉标注：在页面上注入交互元素编号标记
      let annotations: any[] | undefined;
      if (shouldAnnotate) {
        try {
          const annotateResp = await sendToTabWithRetry<any>(
            targetTabId!, '__annotate_elements', {}, { signal, deadlineMs: 8000 },
          );
          if (annotateResp?.success && Array.isArray(annotateResp.annotations)) {
            annotations = annotateResp.annotations;
          }
        } catch { /* 标注失败不阻塞截图 */ }
      }

      let base64Data: string;
      let screenshotMode = shouldAnnotate && annotations
        ? `标注截图（${annotations.length} 个元素）`
        : '可见区域';

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

      // 移除视觉标注（截图完成后立即清理）
      if (shouldAnnotate && targetTabId) {
        try { Channel.sendToTab(targetTabId, '__remove_annotations', {}); } catch { /* 忽略 */ }
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
          annotations: annotations || undefined,
          message: `${screenshotMode}完成（${format}，约 ${sizeKB}KB）`,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || '截图失败' };
    } finally {
      // 移除残留标注（确保异常时也能清理）
      if (shouldAnnotate && targetTabId) {
        try { Channel.sendToTab(targetTabId, '__remove_annotations', {}); } catch { /* 忽略 */ }
      }

      // 恢复悬浮球显示
      if (floatBallHidden && targetTabId) {
        try { Channel.sendToTab(targetTabId, '__screenshot_show', {}); } catch { /* 忽略 */ }
      }

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
