/**
 * 悬浮球顶层组件
 * 主视图已迁移到 Side Panel，content script 只保留触发器和接管提示
 */

import React, { useCallback } from 'react';
import { MoleProvider } from './context/MoleContext';
import { Trigger } from './components/Trigger';
import { TakeoverBanner } from './components/TakeoverBanner';
import { useGlobalEvents } from './hooks/useGlobalEvents';
import { useAIStream } from './hooks/useAIStream';
import { useRecorder } from './hooks/useRecorder';
import { useMole } from './context/useMole';

/** 内部组件，在 Provider 内部才能用 hooks */
const MoleInner: React.FC = () => {
  useGlobalEvents();
  useAIStream({ current: null });
  const { state } = useMole();
  const { startRecording, stopRecording } = useRecorder();

  const handleRecordClick = useCallback(() => {
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [state.isRecording, stopRecording, startRecording]);

  return (
    <>
      <Trigger onRecordClick={handleRecordClick} />
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
