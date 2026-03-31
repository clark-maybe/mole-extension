/**
 * MoleProvider — 悬浮球全局状态 Provider 组件
 */

import React, { useReducer } from 'react';
import { initialMoleState } from './types';
import { moleReducer } from './reducer';
import { MoleContext } from './context';

export const MoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(moleReducer, initialMoleState);
  return (
    <MoleContext.Provider value={{ state, dispatch }}>
      {children}
    </MoleContext.Provider>
  );
};
