import type { AllgoApi } from '@shared/types'

declare global {
  interface Window {
    allgo: AllgoApi
  }

  interface HTMLVideoElement {
    /** Disponível no Chromium — usado para redesenhar overlays no frame exato. */
    requestVideoFrameCallback?(callback: (now: number, metadata: unknown) => void): number
    cancelVideoFrameCallback?(handle: number): void
  }
}

export {}
