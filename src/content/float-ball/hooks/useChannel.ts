/**
 * Channel 通信 Hook
 * 组件挂载时注册监听，卸载时自动注销
 */

import { useEffect, useRef } from 'react';
import Channel from '../../../lib/channel';

/**
 * 监听 Channel 消息，组件卸载时自动 off
 */
export const useChannelOn = (type: string, handler: (data: any, sender?: any) => void) => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler = (data: any, sender?: any) => {
      handlerRef.current(data, sender);
    };
    Channel.on(type, wrappedHandler);
    return () => {
      Channel.off(type, wrappedHandler);
    };
  }, [type]);
};

/**
 * 发送 Channel 消息（简单封装，保持 API 一致）
 */
export const useChannelSend = () => {
  return {
    send: Channel.send.bind(Channel),
    sendToTab: Channel.sendToTab.bind(Channel),
  };
};
