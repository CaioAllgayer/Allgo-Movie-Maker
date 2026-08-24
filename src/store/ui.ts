import { create } from 'zustand'
import type { EncoderSupport, ExportProgress, MediaItem } from '@shared/types'

export type Selection =
  | { type: 'none' }
  | { type: 'video'; id: string }
  | { type: 'image'; id: string }
  | { type: 'audio'; id: string }
  | { type: 'junction'; index: number }

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
}

interface ExportState {
  jobId: string | null
  progress: ExportProgress | null
  outputPath: string | null
}

interface UiStore {
  selection: Selection
  select(selection: Selection): void
  clearSelection(): void

  /** Prévia de um arquivo do bin na tela central (null = mostrando o projeto). */
  previewMedia: MediaItem | null
  setPreviewMedia(item: MediaItem | null): void

  /** pixels por segundo na timeline */
  zoom: number
  setZoom(zoom: number): void
  snapping: boolean
  toggleSnapping(): void

  showExportModal: boolean
  setShowExportModal(show: boolean): void
  exportState: ExportState
  setExportState(state: Partial<ExportState>): void

  encoders: EncoderSupport | null
  setEncoders(encoders: EncoderSupport): void
  ffmpegOk: boolean | null
  setFfmpegOk(ok: boolean): void

  toasts: Toast[]
  toast(message: string, tone?: Toast['tone'], action?: Toast['action']): void
  dismissToast(id: string): void
}

export const MIN_ZOOM = 2
export const MAX_ZOOM = 600

export const useUi = create<UiStore>((set, get) => ({
  selection: { type: 'none' },
  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: { type: 'none' } }),

  previewMedia: null,
  setPreviewMedia: (previewMedia) => set({ previewMedia }),

  zoom: 60,
  setZoom: (zoom) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),
  snapping: true,
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),

  showExportModal: false,
  setShowExportModal: (showExportModal) => set({ showExportModal }),
  exportState: { jobId: null, progress: null, outputPath: null },
  setExportState: (state) => set((s) => ({ exportState: { ...s.exportState, ...state } })),

  encoders: null,
  setEncoders: (encoders) => set({ encoders }),
  ffmpegOk: null,
  setFfmpegOk: (ffmpegOk) => set({ ffmpegOk }),

  toasts: [],
  toast: (message, tone = 'info', action) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    set((s) => ({ toasts: [...s.toasts, { id, message, tone, action }] }))
    if (!action) {
      setTimeout(() => get().dismissToast(id), 4000)
    }
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
