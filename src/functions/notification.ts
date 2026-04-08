/**
 * 浏览器桌面通知工具
 * 使用 chrome.notifications API 发送系统通知
 */

import type { FunctionDefinition } from './types';

export const notificationFunction: FunctionDefinition = {
  name: 'notification',
  description: 'Send a browser desktop notification. Use cases: remind the user of something, notify task completion, report monitoring results, etc. Notifications appear in the system notification center.',
  supportsParallel: true,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Notification title',
      },
      message: {
        type: 'string',
        description: 'Notification body text',
      },
    },
    required: ['title', 'message'],
  },
  execute: async (params: { title: string; message: string }) => {
    const { title, message } = params;

    const notificationId = `mole-${Date.now()}`;

    try {
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: './logo.png',
        title,
        message,
      });

      return {
        success: true,
        data: { message: `已发送通知：${title}` },
      };
    } catch (err: any) {
      return { success: false, error: err.message || '发送通知失败' };
    }
  },
};
