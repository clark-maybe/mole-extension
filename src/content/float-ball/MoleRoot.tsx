/**
 * 悬浮球顶层组件
 * 包裹 MoleProvider，渲染所有子组件
 */

import React, { useCallback } from 'react';
import { MoleProvider } from './context/MoleContext';
import { Trigger } from './components/Trigger';
import { SearchPanel } from './components/SearchPanel';
import { ImageViewer } from './components/ImageViewer';
import { TakeoverBanner } from './components/TakeoverBanner';
import { RecordModal } from './components/RecordModal';
import { useGlobalEvents } from './hooks/useGlobalEvents';
import { useRecorder } from './hooks/useRecorder';
import { useMole } from './context/useMole';

/** 内部组件，在 Provider 内部才能用 hooks */
const MoleInner: React.FC = () => {
  useGlobalEvents();
  const { state, dispatch } = useMole();
  const { startRecording, stopRecording, cancelAuditing } = useRecorder();

  /** 录制按钮点击：录制中 → 停止，否则 → 打开 Modal */
  const handleRecordClick = useCallback(() => {
    if (state.isRecording) {
      stopRecording();
    } else {
      dispatch({ type: 'SET_RECORD_MODAL', payload: true });
    }
  }, [state.isRecording, stopRecording, dispatch]);

  /** Modal 确认：关闭 Modal + 开始录制 */
  const handleModalConfirm = useCallback(() => {
    dispatch({ type: 'SET_RECORD_MODAL', payload: false });
    startRecording();
  }, [dispatch, startRecording]);

  /** Modal 取消 */
  const handleModalCancel = useCallback(() => {
    dispatch({ type: 'SET_RECORD_MODAL', payload: false });
  }, [dispatch]);

  return (
    <>
      <Trigger onRecordClick={handleRecordClick} />
      <SearchPanel stopRecording={stopRecording} cancelAuditing={cancelAuditing} />
      <ImageViewer />
      <TakeoverBanner />
      <RecordModal
        visible={state.showRecordModal}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />
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
