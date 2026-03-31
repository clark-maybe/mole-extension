/**
 * 截图预览浮层组件
 * 全屏预览截图，支持左右切换
 */

import React, { useCallback, useEffect } from 'react';
import { useMole } from '../context/useMole';

export const ImageViewer: React.FC = () => {
  const { state, dispatch } = useMole();
  const { screenshotPreviewList, screenshotPreviewIndex } = state;
  const isOpen = screenshotPreviewList.length > 0;

  const close = useCallback(() => {
    dispatch({ type: 'SET_SCREENSHOT_PREVIEW', payload: { list: [], index: 0 } });
  }, [dispatch]);

  const navigate = useCallback((delta: number) => {
    if (screenshotPreviewList.length === 0) return;
    const newIndex = (screenshotPreviewIndex + delta + screenshotPreviewList.length) % screenshotPreviewList.length;
    dispatch({ type: 'SET_SCREENSHOT_PREVIEW', payload: { list: screenshotPreviewList, index: newIndex } });
  }, [screenshotPreviewList, screenshotPreviewIndex, dispatch]);

  // 键盘导航
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { navigate(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { navigate(1); e.preventDefault(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, close, navigate]);

  if (!isOpen) return null;

  const currentSrc = screenshotPreviewList[screenshotPreviewIndex] || '';
  const meta = `${screenshotPreviewIndex + 1} / ${screenshotPreviewList.length}`;

  return (
    <div className="mole-image-viewer open">
      <div className="mole-image-viewer-content">
        <button className="mole-image-viewer-close" type="button" aria-label="关闭预览" onClick={close}>
          ×
        </button>
        <div className="mole-image-viewer-stage">
          {screenshotPreviewList.length > 1 && (
            <button className="mole-image-viewer-nav prev" type="button" aria-label="上一张" onClick={() => navigate(-1)}>
              ‹
            </button>
          )}
          <img className="mole-image-viewer-img" src={currentSrc} alt="截图预览" />
          {screenshotPreviewList.length > 1 && (
            <button className="mole-image-viewer-nav next" type="button" aria-label="下一张" onClick={() => navigate(1)}>
              ›
            </button>
          )}
        </div>
        <div className="mole-image-viewer-meta">{meta}</div>
      </div>
    </div>
  );
};
