/**
 * 全局事件 Hook
 * 监听从宿主文档桥接过来的 CustomEvent（快捷键、ESC、点击外部）
 * 以及提供稳定的每秒计时器
 */

import { useEffect, useRef, useState } from 'react';
import Channel from '../../../lib/channel';
import { useMole } from '../context/useMole';

/**
 * 监听宿主文档通过 CustomEvent 桥接的全局事件
 * 需要传入 React 挂载容器（reactRoot）的引用
 */
export const useGlobalEvents = () => {
  const { state, dispatch } = useMole();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    // 获取 React 挂载容器（mole-react-root）
    // 它是 CustomEvent 的 dispatch 目标
    const reactRoot = document.getElementById('mole-react-root');
    // 在 closed Shadow DOM 内无法用 getElementById，改为向上查找
    // 实际上 reactRoot 就是当前 React 树的根 DOM 节点的父级
    // 我们在 MoleRoot 里获取

    // 快捷键切换
    const handleToggle = () => {
      dispatch({ type: 'TOGGLE_OPEN' });
    };

    // ESC 键
    const handleEscape = () => {
      const s = stateRef.current;
      if (!s.isOpen) return;

      // 有截图预览 → 关闭预览
      if (s.screenshotPreviewList.length > 0) {
        dispatch({ type: 'SET_SCREENSHOT_PREVIEW', payload: { list: [], index: 0 } });
        return;
      }

      // 关闭菜单可见 → 关闭菜单
      if (s.closeMenuVisible) {
        dispatch({ type: 'SET_CLOSE_MENU', payload: false });
        return;
      }

      // 有会话 → 清除会话（新对话）
      if (s.currentTask) {
        Channel.send('__session_clear', { sessionId: s.currentTask.id });
        dispatch({ type: 'SET_TASK', payload: null });
        return;
      }

      // 无会话 → 关闭面板
      dispatch({ type: 'TOGGLE_OPEN', payload: false });
    };

    // 点击外部关闭
    const handleClickOutside = () => {
      const s = stateRef.current;
      if (s.closeMenuVisible) {
        dispatch({ type: 'SET_CLOSE_MENU', payload: false });
      }
      if (s.isOpen) {
        dispatch({ type: 'TOGGLE_OPEN', payload: false });
      }
    };

    // 监听来自入口文件桥接的 CustomEvent
    // 注意：这些事件分发在 reactRoot 上，但在 closed Shadow DOM 中
    // 我们无法从组件内拿到 reactRoot 引用，改为使用 window 上的自定义事件
    window.addEventListener('mole-toggle' as any, handleToggle);
    window.addEventListener('mole-escape' as any, handleEscape);
    window.addEventListener('mole-click-outside' as any, handleClickOutside);

    return () => {
      window.removeEventListener('mole-toggle' as any, handleToggle);
      window.removeEventListener('mole-escape' as any, handleEscape);
      window.removeEventListener('mole-click-outside' as any, handleClickOutside);
    };
  }, [dispatch]);
};

/**
 * 稳定的每秒计时器
 * 返回一个每秒递增的 tick 值，用于触发时间显示更新
 */
export const useSecondTick = (enabled: boolean): number => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return tick;
};
