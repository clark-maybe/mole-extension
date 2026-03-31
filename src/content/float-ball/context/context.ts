/**
 * MoleContext 定义（纯 Context 对象，无组件）
 */

import { createContext, type Dispatch } from 'react';
import type { MoleState, MoleAction } from './types';

export interface MoleContextValue {
  state: MoleState;
  dispatch: Dispatch<MoleAction>;
}

export const MoleContext = createContext<MoleContextValue | null>(null);
