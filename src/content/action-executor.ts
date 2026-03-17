/**
 * 页面动作执行器（Content Script 侧）
 * 剪贴板操作和选中文本获取
 * 注：原有的 __execute_page_action 已迁移至 cdp_input，此处仅保留剪贴板和选中文本处理器
 */

import Channel from '../lib/channel';

/** 初始化页面动作执行处理器 */
export const initActionExecutor = () => {
  // 剪贴板操作
  Channel.on('__clipboard_ops', async (data: any, _sender: any, sendResponse: any) => {
    try {
      const { action, text } = data || {};
      if (action === 'write') {
        if (!text) {
          sendResponse?.({ success: false, error: '写入剪贴板需要提供 text' });
          return true;
        }
        await navigator.clipboard.writeText(text);
        sendResponse?.({ success: true, data: { message: '已复制到剪贴板' } });
      } else if (action === 'read') {
        const content = await navigator.clipboard.readText();
        sendResponse?.({ success: true, data: { text: content } });
      } else {
        sendResponse?.({ success: false, error: `不支持的操作: ${action}` });
      }
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '剪贴板操作失败' });
    }
    return true;
  });

  // 获取用户选中文本
  Channel.on('__get_selection', (_data: any, _sender: any, sendResponse: any) => {
    try {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';

      if (!text) {
        sendResponse?.({ success: true, data: { text: '', message: '用户未选中任何文本' } });
        return true;
      }

      // 获取选区周围的上下文（选区所在元素的文本）
      let surroundingText = '';
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const parentEl = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as HTMLElement;
        if (parentEl) {
          surroundingText = (parentEl.textContent || '').trim().slice(0, 500);
        }
      }

      sendResponse?.({
        success: true,
        data: {
          text,
          length: text.length,
          surroundingText: surroundingText !== text ? surroundingText : undefined,
          pageUrl: window.location.href,
          pageTitle: document.title,
        },
      });
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '获取选中文本失败' });
    }
    return true;
  });
};
