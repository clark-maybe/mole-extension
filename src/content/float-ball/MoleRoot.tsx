/**
 * 悬浮球顶层组件
 * 包裹 MoleProvider，渲染所有子组件
 */

import React from 'react';
import { MoleProvider } from './context/MoleContext';
import { Trigger } from './components/Trigger';
import { SearchPanel } from './components/SearchPanel';
import { ImageViewer } from './components/ImageViewer';
import { TakeoverBanner } from './components/TakeoverBanner';
import { useGlobalEvents } from './hooks/useGlobalEvents';

/** 内部组件，在 Provider 内部才能用 hooks */
const MoleInner: React.FC = () => {
  useGlobalEvents();

  return (
    <>
      <Trigger />
      <SearchPanel />
      <ImageViewer />
      <TakeoverBanner />
    </>
  );
};

export const MoleRoot: React.FC = () => {
  return (
    <MoleProvider>
      <MoleInner />
    </MoleProvider>
  );
};
