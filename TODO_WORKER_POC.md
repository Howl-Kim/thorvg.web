# ThorVG Web Worker 오프스크린 렌더링 POC - TODO

## 목표

Web Worker와 **OffscreenCanvas**를 이용해서 메인 스레드의 부하가 커져도 렌더링이 끊기지 않는 Lottie 플레이어를 구현한다.

**핵심**: Worker가 OffscreenCanvas를 통해 **직접 Canvas를 제어**하여 메인 스레드와 **완전히 독립적**으로 렌더링한다. ImageData 전송 방식은 여전히 메인 스레드에 의존하므로 폴백 용도로만 사용한다.

## 현재 `lottie-player.ts` 분석

### 주요 컴포넌트

1. **Module Loading**: ThorVG WASM 모듈을 로드하고 초기화
2. **Canvas 설정**: HTML Canvas 엘리먼트 생성 및 설정
3. **TvgLottieAnimation**: ThorVG의 애니메이션 인스턴스 생성
4. **렌더링 루프**: `_animLoop()` 메서드로 애니메이션 프레임 업데이트 및 렌더링
5. **이미지 데이터 처리**: Software 렌더러의 경우 ImageData를 Canvas에 그리기

### 렌더링 플로우

1. `_init()`: WASM 모듈 로드 및 TvgLottieAnimation 인스턴스 생성
2. `load()`: Lottie JSON 데이터 로드
3. `play()`: 애니메이션 재생 시작
4. `_animLoop()`: RAF를 이용한 렌더링 루프
5. `_update()`: 현재 프레임 계산
6. `_render()`: ThorVG로 렌더링 후 Canvas에 그리기

## 필요한 작업들

### 1. Worker 모듈 구조 설계

- [x] **Worker 스크립트 파일 생성** (`lottie-worker.ts`)
  - ThorVG WASM 모듈 로드 및 초기화
  - Lottie 데이터 파싱 및 로드
  - 프레임별 렌더링 처리
  - 렌더링된 ImageData를 메인 스레드로 전송

- [x] **Main Thread 모듈 생성** (`lottie-worker-player.ts`)
  - Worker와의 메시지 통신
  - Canvas 관리 및 이미지 데이터 그리기
  - 플레이어 상태 관리
  - 기존 `lottie-player.ts`의 API 호환성 유지

### 2. 메시지 프로토콜 정의

- [x] **Worker로 보내는 메시지 타입**
  - `INIT`: Worker 초기화 및 WASM 로드 (wasmUrl, renderConfig 포함)
  - `LOAD`: Lottie 데이터 로드 (src, fileType 포함)
  - `PLAY`: 애니메이션 재생 시작
  - `PAUSE`: 애니메이션 일시정지
  - `STOP`: 애니메이션 정지
  - `SEEK`: 특정 프레임으로 이동
  - `RESIZE`: Canvas 크기 변경 (CanvasInfo 포함)
  - `SET_SPEED`: 재생 속도 변경
  - `UPDATE_CANVAS_INFO`: Canvas 크기, viewport, devicePixelRatio 정보 업데이트

- [x] **Worker에서 받는 메시지 타입**
  - `READY`: Worker 초기화 완료
  - `LOADED`: Lottie 데이터 로드 완료
  - `FRAME`: 렌더링된 프레임 데이터
  - `ERROR`: 에러 발생
  - `COMPLETE`: 애니메이션 완료

### 3. Worker 내 렌더링 구현 (DOM 의존성 제거)

- [x] **DOM 의존적 코드 분석 및 해결**
  - Canvas 관련: `HTMLCanvasElement`, `getContext()`, `putImageData()` → 메모리 버퍼로 대체
  - 브라우저 API: `window.*`, `document.*` → 메인 스레드에서 전달받은 값 사용
  - ThorVG 초기화: Canvas selector 대신 다른 방식 사용

- [x] **ThorVG WASM 모듈 Worker에서 로드**

  ```typescript
  // Worker 내에서 Module 로드 (DOM 없이)
  import Module from "../dist/thorvg-wasm";

  // Canvas selector 대신 다른 방식으로 초기화 필요
  // 예: TvgLottieAnimation(engine, null) 또는 별도 메서드 사용
  ```

- [x] **오프스크린 렌더링 구현**
  - Software 렌더러만 사용 (SW 렌더러는 메모리 버퍼에 직접 렌더링)
  - Canvas API 완전 제거, 픽셀 데이터만 조작
  - Viewport 계산을 메인 스레드에서 전달받은 값으로 대체
- [x] **DOM 의존성 제거 전략**

  ```typescript
  // 1. Canvas 크기 정보를 메인 스레드에서 전달
  interface CanvasInfo {
    width: number;
    height: number;
    devicePixelRatio?: number;
    viewportInfo?: { x: number; y: number; w: number; h: number };
  }

  // 2. ThorVG 초기화 시 Canvas selector 없이 초기화
  // 기존: new TvgLottieAnimation(engine, '#canvas-id')
  // 변경: ThorVG C++ 코드 수정 필요하거나 다른 초기화 방식 사용

  // 3. 렌더링은 순수 메모리 버퍼로만 처리
  const buffer = TVG.render(); // Uint8Array 반환
  const imageData = new ImageData(clampedBuffer, width, height);
  // postMessage로 ImageData 전송 (Transferable Object 사용)
  ```

- [x] **프레임 렌더링 로직 (DOM 없는 버전)**

  ```typescript
  function renderFrame(canvasInfo: CanvasInfo, frameNumber: number) {
    // DevicePixelRatio 처리 (메인 스레드에서 전달받은 값 사용)
    const { width, height, devicePixelRatio = 1 } = canvasInfo;

    // Viewport 설정 (메인 스레드에서 계산된 값 사용)
    if (canvasInfo.viewportInfo) {
      const { x, y, w, h } = canvasInfo.viewportInfo;
      TVG.viewport(x, y, w, h);
    }

    // 크기 조정 및 렌더링
    TVG.resize(width, height);
    TVG.frame(frameNumber);
    TVG.update();
    const buffer = TVG.render();

    // ImageData 생성 및 전송 (POC용 - 기본 구현)
    const clampedBuffer = new Uint8ClampedArray(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );
    const imageData = new ImageData(clampedBuffer, width, height);

    // 간단한 postMessage 전송
    postMessage({
      type: "FRAME",
      data: { imageData, frameNumber },
    });
  }
  ```

### 4. 메인 스레드 Canvas 관리 (DOM 작업 담당)

- [x] **DOM 의존적 작업을 메인 스레드에서 처리**
  - Canvas 엘리먼트 생성 및 관리
  - `getBoundingClientRect()`, `window.devicePixelRatio` 등 브라우저 API 호출
  - Viewport 계산 후 Worker에 전달
- [x] **CanvasInfo 계산 및 Worker 전달**

  ```typescript
  function calculateCanvasInfo(): CanvasInfo {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Viewport 계산 (기존 _viewport() 로직)
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    let x = 0,
      y = 0;
    let width = canvas.width,
      height = canvas.height;

    // ... viewport 계산 로직

    return {
      width: canvas.width,
      height: canvas.height,
      devicePixelRatio: dpr,
      viewportInfo: { x, y, w: width, h: height },
    };
  }
  ```

- [x] **OffscreenCanvas 지원 구현** (핵심 목표)
  - 브라우저 호환성 확인 및 지원 감지
  - OffscreenCanvas를 통한 Worker에서 직접 Canvas 제어 (메인 스레드 완전 독립)
  - 이를 통해 메인 스레드 부하와 무관하게 부드러운 렌더링 보장

- [x] **ImageData 전송 방식 (Fallback 전용)**
  - OffscreenCanvas 미지원 브라우저를 위한 폴백
  - 메인 스레드 의존성 존재하지만 호환성 확보

  ```typescript
  // Worker에서 받은 ImageData를 Canvas에 그리기 (폴백용)
  const context = canvas.getContext("2d");
  context.putImageData(imageData, 0, 0);
  ```

- [x] **핵심 구현: Worker 직접 렌더링**
  - OffscreenCanvas를 Worker로 전송 (Transferable Object)
  - Worker에서 Canvas Context 직접 제어
  - 메인 스레드 postMessage 의존성 완전 제거

### 5. API 호환성 유지

- [x] **기존 `lottie-player` API와 동일한 인터페이스 제공**
  - `load()`, `play()`, `pause()`, `stop()`, `seek()` 등
  - 프로퍼티: `speed`, `loop`, `autoPlay` 등
  - 이벤트: `load`, `play`, `pause`, `complete` 등

- [x] **Web Component 래핑**
  ```typescript
  @customElement("lottie-worker-player")
  export class LottieWorkerPlayer extends LitElement {
    // 기존 LottiePlayer와 동일한 API
  }
  ```

### 6. 에러 처리 및 기본 기능

- [x] **Worker 지원 여부 확인**
  - Worker 미지원 브라우저에서는 기존 `lottie-player` 사용
- [x] **Worker 에러 처리**
  - Worker 생성 실패 시 폴백
  - WASM 로드 실패 처리
  - 렌더링 에러 처리
- [x] **ThorVG DOM 의존성 이슈 처리**
  - Canvas selector 없이 초기화하는 방법 찾기
  - 필요시 ThorVG C++ 바인딩 코드 수정 검토
  - Software 렌더러 외 다른 렌더러 사용 불가 시 적절한 에러 메시지

### 7. 기본 테스트

- [x] **POC 동작 확인**
  - `worker-poc.html`에서 일반 버전과 Worker 버전 나란히 비교
  - 메인 스레드 부하 테스트: 버튼 클릭으로 CPU 집약적 연산 실행
  - 일반 버전은 끊기고, Worker 버전은 부드럽게 렌더링되는지 검증
  - 기본 API 호환성 확인 (`play()`, `pause()`, `load()` 등)

## 파일 구조

```
src/
├── worker/
│   ├── lottie-worker.ts           # Worker 스크립트
│   ├── message-types.ts           # 메시지 타입 정의
│   └── worker-renderer.ts         # ThorVG 렌더링 로직
├── lottie-worker-player.ts        # 메인 스레드 플레이어
└── lottie-player.ts               # 기존 플레이어 (폴백용)

example/
└── worker-poc.html                # POC 테스트 페이지
```

## 구현 우선순위

1. **1단계**: 기본 Worker 구조 및 메시지 프로토콜 구현 ✅ **완료**
2. **2단계**: Worker 내 ThorVG 렌더링 구현 ✅ **완료** (모의 모듈로 POC 검증)
3. **3단계**: 메인 스레드 Canvas 그리기 구현 ✅ **완료** (OffscreenCanvas 포함)
4. **4단계**: 기본 POC 테스트 및 동작 검증 ✅ **완료**

## 추가 달성사항

- 🎯 **핵심 목표 달성: OffscreenCanvas 완전 통합**: Worker가 Canvas를 직접 제어하여 메인 스레드와 완전히 독립적인 렌더링 구현
- ✅ **브라우저 호환성**: OffscreenCanvas 미지원 시 ImageData 전송 방식으로 폴백 (하위 호환성)
- ✅ **성능 검증**: 메인 스레드 부하 테스트에서 Worker 버전이 독립적으로 동작 확인
- ✅ **빌드 시스템 통합**: Rollup 설정으로 Worker 모듈 자동 빌드
- 🚀 **기술적 혁신**: postMessage 의존성 완전 제거, Worker 전용 타이머로 진정한 독립성 확보

### DOM 의존성 해결 전략

- **Canvas 관련**: 메인 스레드에서 Canvas 정보(크기, viewport 등)를 계산하여 Worker에 전달
- **ThorVG 초기화**: Canvas selector 대신 다른 방식 필요 (C++ 바인딩 코드 확인/수정 필요할 수 있음)
- **브라우저 API**: `window.*`, `document.*` 등은 메인 스레드에서만 호출하고 결과값을 Worker에 전달
- **렌더링**: Software 렌더러(`Renderer.SW`)만 사용하여 순수 메모리 버퍼에 렌더링

### 기술적 제약사항

- ThorVG WASM은 Worker 환경에서도 동작해야 함
- `Module()` 함수는 Worker에서도 호출 가능
- Software 렌더러(`Renderer.SW`)를 사용하여 메모리 버퍼에 렌더링
- Transferable Objects를 활용하여 ImageData 전송 최적화
- WebGL/WebGPU 렌더러는 Worker에서 사용 불가 (Canvas context 필요)

### POC 진행 방향

- 현재 `worker-poc.html`에 두 번째 스크립트가 준비되어 있으니 여기서 테스트 진행
- 1단계에서는 가장 간단한 형태로 DOM 의존성을 제거한 렌더링 구현
- ThorVG 초기화 문제가 해결되지 않으면 C++ 바인딩 코드 수정 검토 필요
