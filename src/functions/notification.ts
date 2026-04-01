/**
 * 浏览器桌面通知工具
 * 使用 chrome.notifications API 发送系统通知
 */

import type { FunctionDefinition } from './types';

export const notificationFunction: FunctionDefinition = {
  name: 'notification',
  description: '发送浏览器桌面通知。适用于：提醒用户注意某事、通知任务完成、报告监控结果等。通知会显示在系统通知中心。',
  supportsParallel: true,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '通知标题',
      },
      message: {
        type: 'string',
        description: '通知内容',
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
