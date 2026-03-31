/**
 * 位置持久化 Hook — 从 chrome.storage 加载/保存胶囊球位置
 */
import { useEffect } from 'react';
import { STORAGE_KEY, PILL_HEIGHT, PILL_WIDTH, EDGE_MARGIN } from '../constants';
import type { Side, SavedPosition } from '../constants';
import { useMole } from '../context/useMole';

/** 获取可视区域宽度 */
const getViewportWidth = (): number => document.documentElement.clientWidth;

const clampY = (y: number): number => {
  return Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - PILL_HEIGHT - EDGE_MARGIN));
};

const getTriggerX = (side: Side): number => {
  if (side === 'left') {
    return -(PILL_WIDTH + 10 - PILL_WIDTH) / 2;
  }
  return getViewportWidth() - PILL_WIDTH - (10 / 2);
};

/**
 * 加载保存的位置，初始化到 state
 * 返回定位计算工具函数
 */
export const usePosition = () => {
  const { state, dispatch } = useMole();

  // 初始化加载
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY] as SavedPosition | undefined;
      if (saved) {
        dispatch({
          type: 'SET_POSITION',
          payload: { side: saved.side, currentY: clampY(saved.y) },
        });
      } else {
        dispatch({
          type: 'SET_Y',
          payload: window.innerHeight - PILL_HEIGHT - 100,
        });
      }
    });
  }, [dispatch]);

  // resize 时重新 clamp
  useEffect(() => {
    const onResize = () => {
      dispatch({ type: 'SET_Y', payload: clampY(state.currentY) });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [state.currentY, dispatch]);

  const savePosition = (pos: SavedPosition) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: pos });
    } catch { /* 忽略 */ }
    dispatch({ type: 'SET_POSITION', payload: { side: pos.side, currentY: pos.y } });
  };

  return {
    side: state.side,
    currentY: state.currentY,
    savePosition,
    clampY,
    getTriggerX,
  };
};
