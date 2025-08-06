/*
 * Copyright (c) 2023 - 2024 the ThorVG project. All rights reserved.
 * 
 * Web Worker 메시지 프로토콜 타입 정의
 */

// Canvas 정보 인터페이스
export interface CanvasInfo {
  width: number;
  height: number;
  devicePixelRatio?: number;
  viewportInfo?: { x: number; y: number; w: number; h: number };
}

// 렌더링 설정 (기존 lottie-player.ts에서 가져옴)
export interface RenderConfig {
  enableDevicePixelRatio?: boolean;
  renderer?: 'sw' | 'wg' | 'gl';
}

// 파일 타입 (기존 lottie-player.ts에서 가져옴)
export type FileType = 'json' | 'lot' | 'jpg' | 'png' | 'svg';

// Worker로 보내는 메시지 타입들
export type WorkerMessage = 
  | { type: 'INIT'; data: { wasmUrl?: string; renderConfig?: RenderConfig; useOffscreenCanvas?: boolean; offscreenCanvas?: OffscreenCanvas } }
  | { type: 'LOAD'; data: { src: string | object; fileType: FileType } }
  | { type: 'PLAY'; data?: {} }
  | { type: 'PAUSE'; data?: {} }
  | { type: 'STOP'; data?: {} }
  | { type: 'SEEK'; data: { frame: number } }
  | { type: 'RESIZE'; data: { canvasInfo: CanvasInfo } }
  | { type: 'SET_SPEED'; data: { speed: number } }
  | { type: 'UPDATE_CANVAS_INFO'; data: { canvasInfo: CanvasInfo } };

// Worker에서 받는 메시지 타입들
export type WorkerResponse =
  | { type: 'READY'; data?: {} }
  | { type: 'LOADED'; data: { totalFrame: number; size: [number, number] } }
  | { type: 'FRAME'; data: { imageData?: ImageData; frameNumber: number; useOffscreenCanvas?: boolean } }
  | { type: 'ERROR'; data: { message: string; error?: any } }
  | { type: 'COMPLETE'; data?: {} };

// 플레이어 상태 (기존 lottie-player.ts에서 가져옴)
export type PlayerState = 'destroyed' | 'error' | 'loading' | 'paused' | 'playing' | 'stopped' | 'frozen';

// 플레이어 이벤트 (기존 lottie-player.ts에서 가져옴)
export type PlayerEvent = 'complete' | 'destroyed' | 'error' | 'frame' | 'freeze' | 'load' | 'loop' | 'pause' | 'play' | 'ready' | 'stop';
