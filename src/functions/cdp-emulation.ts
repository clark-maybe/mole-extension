/**
 * CDP 设备/环境模拟工具
 * 通过 chrome.debugger 的 Emulation 域模拟设备特征
 * 支持视口尺寸、User-Agent、地理位置、语言/时区、网络条件
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { CDPSessionManager } from '../lib/cdp-session';

/** 获取当前活动标签页 ID */
const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
};

export const cdpEmulationFunction: FunctionDefinition = {
  name: 'cdp_emulation',
  description: 'Device and environment emulation tool. Set viewport size (simulate mobile), override User-Agent, fake geolocation, set locale/timezone, simulate network conditions (3G/offline, etc.), and reset all emulations.',
  supportsParallel: true,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['set_viewport', 'set_user_agent', 'set_geolocation', 'set_locale', 'set_network_conditions', 'reset'],
        description: 'Action type',
      },
      // set_viewport
      width: {
        type: 'number',
        description: 'Viewport width in pixels, e.g. 375 (iPhone), 1920 (desktop)',
      },
      height: {
        type: 'number',
        description: 'Viewport height in pixels, e.g. 812 (iPhone X)',
      },
      device_scale_factor: {
        type: 'number',
        description: 'Device pixel ratio, e.g. 2 (Retina), 3 (high-DPI phone), default 1',
      },
      mobile: {
        type: 'boolean',
        description: 'Whether to emulate a mobile device (affects touch events and meta viewport), default false',
      },
      // set_user_agent
      user_agent: {
        type: 'string',
        description: 'User-Agent string to override',
      },
      platform: {
        type: 'string',
        description: 'navigator.platform value (e.g. "Linux armv8l", "Win32")',
      },
      // set_geolocation
      latitude: {
        type: 'number',
        description: 'Latitude (-90 to 90)',
      },
      longitude: {
        type: 'number',
        description: 'Longitude (-180 to 180)',
      },
      accuracy: {
        type: 'number',
        description: 'Location accuracy in meters, default 100',
      },
      // set_locale
      locale: {
        type: 'string',
        description: 'Locale (e.g. "zh-CN", "en-US", "ja-JP")',
      },
      timezone: {
        type: 'string',
        description: 'Timezone ID (e.g. "Asia/Shanghai", "America/New_York", "Europe/London")',
      },
      // set_network_conditions
      offline: {
        type: 'boolean',
        description: 'Whether to simulate offline state',
      },
      latency: {
        type: 'number',
        description: 'Additional latency in milliseconds, e.g. 100 (3G), 20 (4G)',
      },
      download_throughput: {
        type: 'number',
        description: 'Download throughput in bytes/sec, e.g. 750000 (3G ~6Mbps), 4000000 (4G ~32Mbps). -1 means no limit.',
      },
      upload_throughput: {
        type: 'number',
        description: 'Upload throughput in bytes/sec, e.g. 250000 (3G ~2Mbps). -1 means no limit.',
      },
      // 通用
      tab_id: {
        type: 'number',
        description: 'Target tab ID, uses current active tab if not provided',
      },
    },
    required: ['action'],
  },

  validate: (params: any): string | null => {
    const { action } = params || {};
    if (!action) return 'Missing action parameter';
    const validActions = ['set_viewport', 'set_user_agent', 'set_geolocation', 'set_locale', 'set_network_conditions', 'reset'];
    if (!validActions.includes(action)) {
      return `Unsupported action: ${action}`;
    }
    if (action === 'set_viewport') {
      if (!params.width || !params.height) return 'set_viewport requires width and height parameters';
    }
    if (action === 'set_user_agent') {
      if (!params.user_agent) return 'set_user_agent requires user_agent parameter';
    }
    if (action === 'set_geolocation') {
      if (params.latitude === undefined || params.longitude === undefined) {
        return 'set_geolocation requires latitude and longitude parameters';
      }
    }
    if (action === 'set_locale') {
      if (!params.locale && !params.timezone) return 'set_locale requires locale or timezone parameter';
    }
    return null;
  },

  execute: async (
    params: {
      action: string;
      width?: number;
      height?: number;
      device_scale_factor?: number;
      mobile?: boolean;
      user_agent?: string;
      platform?: string;
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      locale?: string;
      timezone?: string;
      offline?: boolean;
      latency?: number;
      download_throughput?: number;
      upload_throughput?: number;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { action, tab_id } = params;

    // 确定目标 tabId
    let tabId: number;
    if (typeof tab_id === 'number' && tab_id > 0) {
      tabId = tab_id;
    } else if (typeof context?.tabId === 'number' && context.tabId > 0) {
      tabId = context.tabId;
    } else {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        return { success: false, error: '无法确定目标标签页' };
      }
      tabId = activeTabId;
    }

    // 确保 debugger 已 attach
    const attachResult = await CDPSessionManager.attach(tabId);
    if (!attachResult.success) {
      return { success: false, error: `无法连接调试器: ${attachResult.error}` };
    }

    switch (action) {
      case 'set_viewport': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Emulation.setDeviceMetricsOverride', {
          width: Math.floor(params.width!),
          height: Math.floor(params.height!),
          deviceScaleFactor: params.device_scale_factor || 1,
          mobile: params.mobile || false,
        });
        if (!result.success) {
          return { success: false, error: `设置视口失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            width: params.width,
            height: params.height,
            device_scale_factor: params.device_scale_factor || 1,
            mobile: params.mobile || false,
            message: `视口已设置为 ${params.width}x${params.height}${params.mobile ? '（移动模式）' : ''}`,
          },
        };
      }

      case 'set_user_agent': {
        const uaParams: Record<string, any> = {
          userAgent: params.user_agent!,
        };
        if (params.platform) {
          uaParams.platform = params.platform;
        }
        const result = await CDPSessionManager.sendCommand(tabId, 'Emulation.setUserAgentOverride', uaParams);
        if (!result.success) {
          return { success: false, error: `设置 User-Agent 失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            user_agent: params.user_agent,
            platform: params.platform,
            message: `User-Agent 已覆盖（刷新页面后生效）`,
          },
        };
      }

      case 'set_geolocation': {
        const result = await CDPSessionManager.sendCommand(tabId, 'Emulation.setGeolocationOverride', {
          latitude: params.latitude!,
          longitude: params.longitude!,
          accuracy: params.accuracy || 100,
        });
        if (!result.success) {
          return { success: false, error: `设置地理位置失败: ${result.error}` };
        }
        return {
          success: true,
          data: {
            latitude: params.latitude,
            longitude: params.longitude,
            accuracy: params.accuracy || 100,
            message: `地理位置已模拟为 (${params.latitude}, ${params.longitude})`,
          },
        };
      }

      case 'set_locale': {
        const results: string[] = [];

        if (params.locale) {
          const localeResult = await CDPSessionManager.sendCommand(tabId, 'Emulation.setLocaleOverride', {
            locale: params.locale,
          });
          if (!localeResult.success) {
            return { success: false, error: `设置语言失败: ${localeResult.error}` };
          }
          results.push(`语言: ${params.locale}`);
        }

        if (params.timezone) {
          const tzResult = await CDPSessionManager.sendCommand(tabId, 'Emulation.setTimezoneOverride', {
            timezoneId: params.timezone,
          });
          if (!tzResult.success) {
            return { success: false, error: `设置时区失败: ${tzResult.error}` };
          }
          results.push(`时区: ${params.timezone}`);
        }

        return {
          success: true,
          data: {
            locale: params.locale,
            timezone: params.timezone,
            message: `已设置 ${results.join('，')}`,
          },
        };
      }

      case 'set_network_conditions': {
        // Network.emulateNetworkConditions 需要 Network 域启用
        // 先确保 Network 域启用
        await CDPSessionManager.sendCommand(tabId, 'Network.enable', {});

        const result = await CDPSessionManager.sendCommand(tabId, 'Network.emulateNetworkConditions', {
          offline: params.offline || false,
          latency: params.latency || 0,
          downloadThroughput: params.download_throughput ?? -1,
          uploadThroughput: params.upload_throughput ?? -1,
        });
        if (!result.success) {
          return { success: false, error: `设置网络条件失败: ${result.error}` };
        }

        const conditions: string[] = [];
        if (params.offline) conditions.push('离线');
        if (params.latency) conditions.push(`延迟 ${params.latency}ms`);
        if (params.download_throughput !== undefined && params.download_throughput >= 0) {
          conditions.push(`下行 ${Math.round(params.download_throughput / 1000)}KB/s`);
        }
        if (params.upload_throughput !== undefined && params.upload_throughput >= 0) {
          conditions.push(`上行 ${Math.round(params.upload_throughput / 1000)}KB/s`);
        }

        return {
          success: true,
          data: {
            offline: params.offline || false,
            latency: params.latency || 0,
            download_throughput: params.download_throughput,
            upload_throughput: params.upload_throughput,
            message: conditions.length > 0
              ? `网络条件已模拟: ${conditions.join(', ')}`
              : '网络条件已设置（无限制）',
          },
        };
      }

      case 'reset': {
        const errors: string[] = [];

        // 重置视口
        const vpResult = await CDPSessionManager.sendCommand(tabId, 'Emulation.clearDeviceMetricsOverride', {});
        if (!vpResult.success) errors.push(`视口: ${vpResult.error}`);

        // 重置 UA（空字符串 = 清除覆盖）
        const uaResult = await CDPSessionManager.sendCommand(tabId, 'Emulation.setUserAgentOverride', { userAgent: '' });
        if (!uaResult.success) errors.push(`UA: ${uaResult.error}`);

        // 重置地理位置
        const geoResult = await CDPSessionManager.sendCommand(tabId, 'Emulation.clearGeolocationOverride', {});
        if (!geoResult.success) errors.push(`地理位置: ${geoResult.error}`);

        if (errors.length > 0) {
          return {
            success: true,
            data: { message: `部分模拟已重置，以下重置失败: ${errors.join('; ')}` },
          };
        }

        return {
          success: true,
          data: { message: '所有模拟设置已重置为默认' },
        };
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  },
};
