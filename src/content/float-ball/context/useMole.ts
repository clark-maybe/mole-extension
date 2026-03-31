/**
 * useMole — 访问悬浮球全局状态的 Hook
 */

import { useContext } from 'react';
import { MoleContext } from './context';

export const useMole = () => {
  const ctx = useContext(MoleContext);
  if (!ctx) throw new Error('useMole 必须在 MoleProvider 内使用');
  return ctx;
};
