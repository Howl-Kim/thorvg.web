/*
 * Copyright (c) 2023 - 2024 the ThorVG project. All rights reserved.
 * 
 * ThorVG Lottie Worker - 오프스크린 렌더링 담당
 */

import { WorkerMessage, WorkerResponse, CanvasInfo, RenderConfig, FileType } from './message-types.js';

// @ts-ignore: WASM Glue code doesn't have type & Only available on build progress
import Module from '../../dist/thorvg-wasm';

let _module: any;
let _moduleRequested: boolean = false;
let _TVG: any;
let _isInitialized: boolean = false;
let _currentCanvasInfo: CanvasInfo | null = null;

// 애니메이션 상태
let _isPlaying: boolean = false;
let _animationStartTime: number = 0;
let _animationSpeed: number = 1.0;
let _totalFrames: number = 60;
let _duration: number = 2.0;
let _animationFrame: number | null = null;

// OffscreenCanvas 관련
let _useOffscreenCanvas: boolean = false;
let _offscreenCanvas: OffscreenCanvas | null = null;
let _offscreenContext: OffscreenCanvasRenderingContext2D | null = null;

// Renderer 타입 정의 (lottie-player.ts와 동일)
enum Renderer {
  SW = 'sw',
  WG = 'wg', 
  GL = 'gl',
}

// 초기화 상태
enum InitStatus {
  IDLE = 'idle',
  FAILED = 'failed',
  REQUESTED = 'requested', 
  INITIALIZED = 'initialized',
}

// 기본 WASM URL
const DEFAULT_WASM_URL = 'https://unpkg.com/@thorvg/lottie-player@latest/dist/thorvg-wasm.wasm';

// 모듈 초기화 상태 관리 (lottie-player.ts와 동일)
let _initStatus = InitStatus.IDLE;

// Worker 모듈 초기화 함수 (Software 렌더러 전용)
async function _initModule(engine: Renderer): Promise<void> {
  // Worker에서는 Software 렌더러만 사용 (WebGL/WebGPU는 DOM 컨텍스트 필요)
  if (engine !== Renderer.WG) {
    // NOTE: thorvg software/webgl renderer doesn't do anything in the module init(). Skip ASAP.
    return;
  }

  // Worker에서는 WebGPU를 지원하지 않으므로 에러 처리
  _initStatus = InitStatus.FAILED;
  throw new Error('Worker only supports Software renderer. WebGPU/WebGL requires main thread context.');
}

// 초기화 함수
async function initializeWorker(wasmUrl?: string, _renderConfig?: RenderConfig, useOffscreenCanvas?: boolean, offscreenCanvas?: OffscreenCanvas): Promise<void> {
  try {
    // OffscreenCanvas 설정
    _useOffscreenCanvas = useOffscreenCanvas || false;
    if (_useOffscreenCanvas && offscreenCanvas) {
      _offscreenCanvas = offscreenCanvas;
      _offscreenContext = _offscreenCanvas.getContext('2d');
    }
    if (_moduleRequested && !_module) {
      // 이미 로드 중이면 대기
      while (!_module) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (!_module) {
      _moduleRequested = true;
      
      try {
        // 실제 ThorVG WASM 모듈 로드
        _module = await Module({
          locateFile: (path: string, prefix: string) => {
            if (path.endsWith('.wasm')) {
              return wasmUrl || DEFAULT_WASM_URL;
            }
            return prefix + path;
          }
        });
        
        if (!_module) {
          throw new Error('Module loading returned null');
        }
      } catch (moduleError) {
        console.error('[Worker] Module loading failed:', moduleError);
        const errorMessage = moduleError instanceof Error ? moduleError.message : String(moduleError);
        throw new Error(`WASM module loading failed: ${errorMessage}`);
      }
    }

    // Worker에서는 Software 렌더러만 사용 (WebGL/WebGPU는 DOM 컨텍스트 필요)
    const engine = Renderer.SW; // 강제로 Software 렌더러 사용
    
    // 모듈 초기화 (Software 렌더러는 초기화 건너뜀)
    await _initModule(engine);
    if (_initStatus === InitStatus.FAILED) {
      throw new Error('Module initialization failed');
    }
    
    // ThorVG 애니메이션 인스턴스 생성 (Worker에서는 Canvas selector 우회)
    try {
      _TVG = new _module.TvgLottieAnimation(engine, '');
    } catch (tvgError) {
      console.error('[Worker] TvgLottieAnimation creation failed:', tvgError);
      // 빈 문자열이 안되면 null을 시도
      try {
        _TVG = new _module.TvgLottieAnimation(engine, null);
      } catch (nullError) {
        console.error('[Worker] TvgLottieAnimation with null failed:', nullError);
        throw new Error('TvgLottieAnimation creation failed with both empty string and null selector');
      }
    }
    
    _isInitialized = true;
    
    postMessage({ type: 'READY', data: {} } as WorkerResponse);
    
  } catch (error) {
    console.error('[Worker] Initialization failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    postMessage({ 
      type: 'ERROR', 
      data: { message: 'Worker initialization failed', error: errorMessage } 
    } as WorkerResponse);
  }
}

// Lottie 데이터 로드 (lottie-player.ts의 _parseSrc 로직 적용)
async function loadLottieData(src: string | object, fileType: FileType): Promise<void> {
  try {
    if (!_isInitialized || !_TVG) {
      throw new Error('Worker not initialized');
    }

    // lottie-player.ts의 _parseSrc 로직과 동일한 데이터 파싱
    const encoder = new TextEncoder();
    let data: Uint8Array;

    switch (typeof src) {
      case 'object':
        if (src instanceof ArrayBuffer) {
          data = new Uint8Array(src);
        } else {
          const jsonString = JSON.stringify(src);
          data = encoder.encode(jsonString);
        }
        break;
      case 'string':
        if (fileType === 'json' || fileType === 'lot') {
          // JSON 파싱 로직 (lottie-player.ts의 _parseJSON과 동일)
          let jsonData: string;
          try {
            jsonData = JSON.parse(src);
          } catch (err) {
            // URL일 경우 fetch로 로드
            try {
              const srcUrl = new URL(src);
              const result = await fetch(srcUrl.toString());
              const json = await result.json();
              jsonData = JSON.stringify(json);
            } catch (fetchErr) {
              throw new Error('An error occurred while trying to load the Lottie file from URL');
            }
          }
          data = encoder.encode(jsonData);
        } else {
          // 이미지 파일 URL 처리 (lottie-player.ts의 _parseImageFromURL과 동일)
          const response = await fetch(src);
          const buffer = await response.arrayBuffer();
          data = new Uint8Array(buffer);
        }
        break;
      default:
        throw new Error('Invalid src type');
    }

    // Canvas 정보가 있으면 로드 시 사용
    const width = _currentCanvasInfo?.width || 200;
    const height = _currentCanvasInfo?.height || 200;
    
    const isLoaded = _TVG.load(data, fileType, width, height, '');
    if (!isLoaded) {
      throw new Error('Unable to load Lottie data: ' + _TVG.error());
    }

    // Worker 변수 업데이트
    _totalFrames = _TVG.totalFrame();
    _duration = _TVG.duration();
    
    postMessage({
      type: 'LOADED',
      data: {
        totalFrame: _totalFrames,
        size: _TVG.size()
      }
    } as WorkerResponse);
    
  } catch (error) {
    console.error('[Worker] Load failed:', error);
    postMessage({
      type: 'ERROR',
      data: { message: 'Failed to load Lottie data', error }
    } as WorkerResponse);
  }
}

// Worker 자체 애니메이션 루프 (메인 스레드와 독립적)
function startWorkerAnimationLoop(): void {
  if (_isPlaying) {
    return; // 이미 실행 중
  }

  _isPlaying = true;
  _animationStartTime = Date.now();

  // setInterval을 사용한 더 독립적인 타이머 (16ms = 60fps, 부드러운 애니메이션)
  _animationFrame = (self as any).setInterval(() => {
    if (!_isPlaying || !_isInitialized || !_TVG || !_currentCanvasInfo) {
      return;
    }

    const currentTime = Date.now();
    const elapsed = (currentTime - _animationStartTime) / 1000 * _animationSpeed;
    let frameNumber = (elapsed / _duration) * _totalFrames;

    // 루프 처리
    if (frameNumber >= _totalFrames) {
      frameNumber = frameNumber % _totalFrames;
      _animationStartTime = currentTime; // 시작 시간 리셋
    }

    const intFrame = Math.floor(frameNumber);

    // 모든 프레임을 화면에 업데이트 (원래대로 복원)
    renderFrame(intFrame);
  }, 16); // 16ms 간격으로 변경 (60fps, 부드러운 애니메이션)
}

function stopWorkerAnimationLoop(): void {
  _isPlaying = false;
  if (_animationFrame) {
    (self as any).clearInterval(_animationFrame); // clearInterval로 변경
    _animationFrame = null;
  }
}

// 프레임 렌더링
function renderFrame(frameNumber: number): void {
  try {
    if (!_isInitialized || !_TVG) {
      return;
    }

    // OffscreenCanvas 사용 시
    if (_useOffscreenCanvas && _offscreenCanvas && _offscreenContext) {
      const { width, height } = _offscreenCanvas;
      
      // 크기 조정 및 렌더링
      _TVG.resize(width, height);
      _TVG.frame(frameNumber);
      const isUpdated = _TVG.update();

      if (!isUpdated) {
        return;
      }

      const buffer = _TVG.render();
      const clampedBuffer = new Uint8ClampedArray(
        buffer.buffer || buffer,
        buffer.byteOffset || 0,
        buffer.byteLength || buffer.length
      );

      if (clampedBuffer.length > 0) {
        // OffscreenCanvas에 직접 렌더링 (메인 스레드 우회!)
        const imageData = new ImageData(clampedBuffer, width, height);
        _offscreenContext.putImageData(imageData, 0, 0);
      }

      // 프레임 정보만 메인 스레드에 전송 (ImageData는 전송하지 않음)
      postMessage({
        type: 'FRAME',
        data: { frameNumber, useOffscreenCanvas: true }
      } as WorkerResponse);

    } else {
      // Fallback: 기존 ImageData 전송 방식
      if (!_currentCanvasInfo) {
        return;
      }

      const { width, height, viewportInfo } = _currentCanvasInfo;

      // Viewport 설정 (메인 스레드에서 계산된 값 사용)
      if (viewportInfo) {
        const { x, y, w, h } = viewportInfo;
        _TVG.viewport(x, y, w, h);
      }

      // 크기 조정 및 렌더링
      _TVG.resize(width, height);
      _TVG.frame(frameNumber);
      const isUpdated = _TVG.update();

      if (!isUpdated) {
        return;
      }

      const buffer = _TVG.render();
      const clampedBuffer = new Uint8ClampedArray(
        buffer.buffer || buffer,
        buffer.byteOffset || 0,
        buffer.byteLength || buffer.length
      );

      if (clampedBuffer.length > 0) {
        // ImageData 생성 및 전송 (Fallback)
        const imageData = new ImageData(clampedBuffer, width, height);

        postMessage({
          type: 'FRAME',
          data: { imageData, frameNumber, useOffscreenCanvas: false }
        } as WorkerResponse);
      }
    }

  } catch (error) {
    console.error('[Worker] Render frame failed:', error);
    postMessage({
      type: 'ERROR',
      data: { message: 'Frame rendering failed', error }
    } as WorkerResponse);
  }
}

// 메시지 핸들러
self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data;

  switch (type) {
    case 'INIT':
      await initializeWorker(
        data.wasmUrl, 
        data.renderConfig, 
        data.useOffscreenCanvas,
        data.offscreenCanvas
      );
      break;

    case 'LOAD':
      await loadLottieData(data.src, data.fileType);
      break;

    case 'PLAY':
      // Worker 자체 애니메이션 루프 시작
      startWorkerAnimationLoop();
      break;

    case 'PAUSE':
      // 일시정지
      stopWorkerAnimationLoop();
      break;

    case 'STOP':
      // 정지
      stopWorkerAnimationLoop();
      break;

    case 'SEEK':
      // 특정 프레임으로 이동
      renderFrame(data.frame);
      break;

    case 'RESIZE':
    case 'UPDATE_CANVAS_INFO':
      // Canvas 정보 업데이트
      _currentCanvasInfo = data.canvasInfo;
      break;

    case 'SET_SPEED':
      // 속도 변경
      _animationSpeed = data.speed;
      break;

    default:
      console.warn('[Worker] Unknown message type:', type);
  }
});
