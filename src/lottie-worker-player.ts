/*
 * Copyright (c) 2023 - 2024 the ThorVG project. All rights reserved.
 * 
 * ThorVG Lottie Worker Player - 메인 스레드 컴포넌트
 */

import { html, PropertyValueMap, LitElement, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { 
  WorkerMessage, 
  WorkerResponse, 
  CanvasInfo, 
  RenderConfig, 
  FileType, 
  PlayerState
} from './worker/message-types.js';

// 기존 lottie-player.ts에서 가져온 타입들
export enum Renderer {
  SW = 'sw',
  WG = 'wg', 
  GL = 'gl',
}

export enum PlayMode {
  Bounce = 'bounce',
  Normal = 'normal',
}

@customElement('lottie-worker-player')
export class LottieWorkerPlayer extends LitElement {
  /**
   * Lottie animation JSON data or URL to JSON.
   */
  @property({ type: String })
  public src?: string;

  /**
   * Custom WASM URL for ThorVG engine
   */
  @property({ type: String })
  public wasmUrl?: string;

  /**
   * File type.
   */
  @property({ type: String })
  public fileType: FileType = 'json';

  /**
   * Rendering configurations.
   */
  @property({ type: Object })
  public renderConfig?: RenderConfig;

  /**
   * Animation speed.
   */
  @property({ type: Number })
  public speed: number = 1.0;

  /**
   * Autoplay animation on load.
   */
  @property({ type: Boolean })
  public autoPlay: boolean = false;

  /**
   * Number of times to loop animation.
   */
  @property({ type: Number })
  public count?: number;

  /**
   * Whether to loop animation.
   */
  @property({ type: Boolean })
  public loop: boolean = false;

  /**
   * Direction of animation.
   */
  @property({ type: Number })
  public direction: number = 1;

  /**
   * Play mode.
   */
  @property()
  public mode: PlayMode = PlayMode.Normal;

  /**
   * Intermission
   */
  @property()
  public intermission: number = 1;

  /**
   * total frame of current animation (readonly)
   */
  @property({ type: Number })
  public totalFrame: number = 0;

  /**
   * current frame of current animation (readonly)
   */
  @property({ type: Number })
  public currentFrame: number = 0;

  /**
   * Player state
   */
  @property({ type: String })
  public currentState: PlayerState = 'loading';

  /**
   * original size of the animation (readonly)
   */
  @property({ type: Array })
  public get size(): [number, number] {
    return this._animationSize || [0, 0];
  }

  private _worker?: Worker;
  private _canvas?: HTMLCanvasElement;
  private _context?: CanvasRenderingContext2D;
  private _offscreenCanvas?: OffscreenCanvas;
  private _animationSize: [number, number] = [0, 0];
  private _supportsOffscreenCanvas: boolean = false;

  protected firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
    this._canvas = this.querySelector('.thorvg') as HTMLCanvasElement;
    this._canvas.id = `thorvg-worker-${Math.random().toString(36).substring(7)}`;
    this._canvas.width = this._canvas.offsetWidth || 200;
    this._canvas.height = this._canvas.offsetHeight || 200;

    // OffscreenCanvas 지원 체크
    this._supportsOffscreenCanvas = typeof OffscreenCanvas !== 'undefined' && 
                                     this._canvas.transferControlToOffscreen !== undefined;

    if (this._supportsOffscreenCanvas) {
      // OffscreenCanvas 사용: Canvas 제어권을 Worker로 이전
      this._offscreenCanvas = this._canvas.transferControlToOffscreen();
    } else {
      // Fallback: 기존 방식 (ImageData 전송)
      this._context = this._canvas.getContext('2d') || undefined;
    }

    // Worker 초기화
    this._initWorker();
  }

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    this.style.display = 'block';
    return this;
  }

  private async _initWorker(): Promise<void> {
    try {
      // Worker 스크립트 경로 (빌드된 파일 사용)
      this._worker = new Worker('../dist/lottie-worker.js', { type: 'module' });

      this._worker.addEventListener('message', this._handleWorkerMessage.bind(this));
      this._worker.addEventListener('error', this._handleWorkerError.bind(this));

      // Worker 초기화
      const initData: any = {
        wasmUrl: this.wasmUrl,
        renderConfig: this.renderConfig,
        useOffscreenCanvas: this._supportsOffscreenCanvas
      };

      // OffscreenCanvas가 지원되면 Canvas 제어권을 Worker로 전송
      if (this._supportsOffscreenCanvas && this._offscreenCanvas) {
        initData.offscreenCanvas = this._offscreenCanvas;
        this._sendToWorker({
          type: 'INIT',
          data: initData
        }, [this._offscreenCanvas]); // Transferable 객체로 전송
      } else {
        this._sendToWorker({
          type: 'INIT',
          data: initData
        });
      }

    } catch (error) {
      console.error('[LottieWorkerPlayer] Worker initialization failed:', error);
      this.currentState = 'error';
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }

  private _sendToWorker(message: WorkerMessage, transfer?: Transferable[]): void {
    if (this._worker) {
      if (transfer) {
        this._worker.postMessage(message, transfer);
      } else {
        this._worker.postMessage(message);
      }
    }
  }

  private _handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const { type, data } = event.data;

    switch (type) {
      case 'READY':
        // Canvas 정보 전송
        this._updateCanvasInfo();
        
        // src가 있으면 자동 로드
        if (this.src) {
          this.load(this.src, this.fileType);
        }
        break;

      case 'LOADED':
        this.totalFrame = data.totalFrame;
        this._animationSize = data.size;
        this.currentState = 'stopped';
        
        this.dispatchEvent(new CustomEvent('load'));
        
        if (this.autoPlay) {
          this.play();
        }
        break;

      case 'FRAME':
        // OffscreenCanvas 사용 시에는 Worker가 직접 렌더링하므로 여기서 처리할 필요 없음
        if (!this._supportsOffscreenCanvas) {
          // Fallback: Worker에서 받은 ImageData를 Canvas에 그리기
          if (this._context && data.imageData) {
            this._context.putImageData(data.imageData, 0, 0);
          }
        }
        
        // 프레임 정보 업데이트 및 이벤트 발생
        this.currentFrame = data.frameNumber;
        this.dispatchEvent(new CustomEvent('frame', {
          detail: { frame: this.currentFrame }
        }));
        break;

      case 'ERROR':
        console.error('[LottieWorkerPlayer] Worker error:', data.message);
        this.currentState = 'error';
        this.dispatchEvent(new CustomEvent('error', { detail: data }));
        break;

      case 'COMPLETE':
        this.currentState = 'stopped';
        this.dispatchEvent(new CustomEvent('complete'));
        break;
    }
  }

  private _handleWorkerError(error: ErrorEvent): void {
    console.error('[LottieWorkerPlayer] Worker error:', error);
    this.currentState = 'error';
    this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
  }

  private _calculateCanvasInfo(): CanvasInfo {
    if (!this._canvas) {
      return { width: 200, height: 200 };
    }

    const rect = this._canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Viewport 계산 (기존 _viewport() 로직 참고)
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    let x = 0, y = 0;
    let width = this._canvas.width, height = this._canvas.height;

    if (rect.left < 0) {
      x = Math.abs(rect.left);
      width -= x;
    }

    if (rect.top < 0) {
      y = Math.abs(rect.top);
      height -= y;
    }

    if (rect.right > windowWidth) {
      width -= rect.right - windowWidth;
    }

    if (rect.bottom > windowHeight) {
      height -= rect.bottom - windowHeight;
    }

    return {
      width: this._canvas.width,
      height: this._canvas.height,
      devicePixelRatio: dpr,
      viewportInfo: { x, y, w: width, h: height }
    };
  }

  private _updateCanvasInfo(): void {
    const canvasInfo = this._calculateCanvasInfo();
    this._sendToWorker({
      type: 'UPDATE_CANVAS_INFO',
      data: { canvasInfo }
    });
  }

  // Worker 자체적으로 애니메이션을 처리하므로 메인 스레드 루프는 불필요
  // private _animationLoop() 함수 제거됨

  /**
   * Configure and load
   */
  public async load(src: string | object, fileType: FileType = 'json'): Promise<void> {
    try {
      this.src = typeof src === 'string' ? src : JSON.stringify(src);
      this.fileType = fileType;
      this.currentState = 'loading';

      this._sendToWorker({
        type: 'LOAD',
        data: { src, fileType }
      });

    } catch (error) {
      this.currentState = 'error';
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }

  /**
   * Start playing animation.
   */
  public play(): void {
    if (this.currentState !== 'stopped' && this.currentState !== 'paused') {
      return;
    }

    if (this.totalFrame < 1) {
      return;
    }

    this.currentState = 'playing';

    // Worker에게 재생 시작 신호만 전송 (Worker가 자체적으로 애니메이션 루프 실행)
    this._sendToWorker({ type: 'PLAY', data: {} });
    this.dispatchEvent(new CustomEvent('play'));
  }

  /**
   * Pause animation.
   */
  public pause(): void {
    this.currentState = 'paused';
    this._sendToWorker({ type: 'PAUSE', data: {} });
    this.dispatchEvent(new CustomEvent('pause'));
  }

  /**
   * Stop animation.
   */
  public stop(): void {
    this.currentState = 'stopped';
    this.currentFrame = 0;

    this._sendToWorker({ type: 'STOP', data: {} });
    this.seek(0);
    this.dispatchEvent(new CustomEvent('stop'));
  }

  /**
   * Seek to a given frame
   */
  public async seek(frame: number): Promise<void> {
    this.currentFrame = frame;
    this._sendToWorker({
      type: 'SEEK',
      data: { frame }
    });
  }

  /**
   * Adjust the canvas size.
   */
  public resize(width: number, height: number): void {
    if (this._canvas) {
      this._canvas.width = width;
      this._canvas.height = height;
      this._updateCanvasInfo();
    }
  }

  /**
   * Destroy animation and worker.
   */
  public destroy(): void {
    if (this._worker) {
      this._worker.terminate();
      this._worker = undefined;
    }

    this.currentState = 'destroyed';
    this.dispatchEvent(new CustomEvent('destroyed'));
    this.remove();
  }

  public render(): TemplateResult {
    return html`
      <canvas class="thorvg" style="width: 100%; height: 100%;" />
    `;
  }
}
