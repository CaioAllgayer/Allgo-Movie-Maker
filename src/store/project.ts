import { create } from 'zustand'
import type { AudioClip, ColorAdjust, ImageClip, MediaItem, Project, VideoClip } from '@shared/types'
import { PROJECT_VERSION } from '@shared/types'
import { clipDuration, computeLayout, maxTransitionAt, MAX_TRANSITION, MIN_TRANSITION } from '@engine/computeLayout'

const HISTORY_LIMIT = 100

export function emptyProject(): Project {
  return {
    version: PROJECT_VERSION,
    name: 'Projeto sem nome',
    fps: 30,
    width: 1920,
    height: 1080,
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    media: [],
    videoTrack: [],
    overlayTracks: [[]],
    musicTrack: []
  }
}

export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const clone = <T>(value: T): T => structuredClone(value)

interface ProjectStore {
  project: Project
  filePath: string | null
  dirty: boolean
  past: Project[]
  future: Project[]

  /** Empurra o estado atual para o histórico. Chame UMA vez por interação
   *  (no pointerdown de um arraste, por exemplo), não a cada frame. */
  commit(): void
  /** Altera o projeto sem tocar no histórico. */
  update(mutate: (p: Project) => void): void
  /** commit + update, para ações de um passo só. */
  edit(mutate: (p: Project) => void): void

  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean

  load(project: Project, filePath: string | null): void
  reset(): void
  markSaved(filePath: string): void

  addMedia(items: MediaItem[]): void
  removeMedia(mediaId: string): void
  relocateMedia(mediaId: string, path: string): void

  appendVideoClip(mediaId: string, atIndex?: number): string | null
  addImageClip(mediaId: string, trackIndex: number, start: number, duration?: number): string | null
  addAudioClip(mediaId: string, start: number): string | null

  removeClip(id: string): void
  splitAt(time: number): void
  moveVideoClip(from: number, to: number): void
  setTransition(junctionIndex: number, duration: number | null): void
  ensureOverlayTrack(index: number): void
  setAdjust(adjust: Partial<ColorAdjust>): void
}

function findClip(project: Project, id: string):
  | { kind: 'video'; clip: VideoClip; index: number }
  | { kind: 'image'; clip: ImageClip; track: number; index: number }
  | { kind: 'audio'; clip: AudioClip; index: number }
  | null {
  const vi = project.videoTrack.findIndex((c) => c.id === id)
  if (vi >= 0) return { kind: 'video', clip: project.videoTrack[vi], index: vi }
  for (let t = 0; t < project.overlayTracks.length; t++) {
    const i = project.overlayTracks[t].findIndex((c) => c.id === id)
    if (i >= 0) return { kind: 'image', clip: project.overlayTracks[t][i], track: t, index: i }
  }
  const ai = project.musicTrack.findIndex((c) => c.id === id)
  if (ai >= 0) return { kind: 'audio', clip: project.musicTrack[ai], index: ai }
  return null
}

export const useProject = create<ProjectStore>((set, get) => ({
  project: emptyProject(),
  filePath: null,
  dirty: false,
  past: [],
  future: [],

  commit() {
    const { project, past } = get()
    const next = [...past, clone(project)]
    if (next.length > HISTORY_LIMIT) next.shift()
    set({ past: next, future: [] })
  },

  update(mutate) {
    const project = clone(get().project)
    mutate(project)
    set({ project, dirty: true })
  },

  edit(mutate) {
    get().commit()
    get().update(mutate)
  },

  undo() {
    const { past, future, project } = get()
    if (!past.length) return
    const previous = past[past.length - 1]
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [clone(project), ...future].slice(0, HISTORY_LIMIT),
      dirty: true
    })
  },

  redo() {
    const { past, future, project } = get()
    if (!future.length) return
    const next = future[0]
    set({
      project: next,
      past: [...past, clone(project)].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true
    })
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  load(project, filePath) {
    set({ project, filePath, dirty: false, past: [], future: [] })
  },

  reset() {
    set({ project: emptyProject(), filePath: null, dirty: false, past: [], future: [] })
  },

  markSaved(filePath) {
    set({ filePath, dirty: false })
  },

  addMedia(items) {
    get().edit((p) => {
      const existing = new Set(p.media.map((m) => m.path))
      for (const item of items) {
        if (existing.has(item.path)) continue
        p.media.push(item)
        existing.add(item.path)
      }
      // O fps do projeto é definido pelo primeiro vídeo importado; tudo é
      // normalizado a ele no export.
      if (p.videoTrack.length === 0) {
        const firstVideo = items.find((m) => m.kind === 'video' && m.fps)
        if (firstVideo?.fps) p.fps = Math.round(firstVideo.fps * 1000) / 1000
      }
    })
  },

  removeMedia(mediaId) {
    get().edit((p) => {
      p.media = p.media.filter((m) => m.id !== mediaId)
      p.videoTrack = p.videoTrack.filter((c) => c.mediaId !== mediaId)
      p.overlayTracks = p.overlayTracks.map((t) => t.filter((c) => c.mediaId !== mediaId))
      p.musicTrack = p.musicTrack.filter((c) => c.mediaId !== mediaId)
    })
  },

  relocateMedia(mediaId, path) {
    get().edit((p) => {
      const media = p.media.find((m) => m.id === mediaId)
      if (media) {
        media.path = path
        media.missing = false
        media.name = path.split(/[\\/]/).pop() ?? media.name
      }
    })
  },

  appendVideoClip(mediaId, atIndex) {
    const { project } = get()
    const media = project.media.find((m) => m.id === mediaId)
    if (!media || media.kind !== 'video') return null
    const id = uid('vc')
    get().edit((p) => {
      const clip: VideoClip = {
        id,
        mediaId,
        inPoint: 0,
        outPoint: media.duration ?? 5,
        volume: 1,
        muted: false
      }
      const index = atIndex ?? p.videoTrack.length
      p.videoTrack.splice(Math.max(0, Math.min(index, p.videoTrack.length)), 0, clip)
      if (p.videoTrack.length === 1 && media.fps) p.fps = Math.round(media.fps * 1000) / 1000
    })
    return id
  },

  addImageClip(mediaId, trackIndex, start, duration = 5) {
    const { project } = get()
    const media = project.media.find((m) => m.id === mediaId)
    if (!media || media.kind !== 'image') return null
    const id = uid('ic')
    // Escala inicial: a placa entra ocupando no máximo 60% da largura do quadro.
    const naturalWidth = media.width || 960
    const scale = Math.min(1, (project.width * 0.6) / naturalWidth)
    get().edit((p) => {
      while (p.overlayTracks.length <= trackIndex) p.overlayTracks.push([])
      const clip: ImageClip = {
        id,
        mediaId,
        start: Math.max(0, start),
        duration,
        x: 0.5,
        y: 0.5,
        scale,
        opacity: 1,
        fadeIn: 0.5,
        fadeOut: 0.5
      }
      p.overlayTracks[trackIndex].push(clip)
      p.overlayTracks[trackIndex].sort((a, b) => a.start - b.start)
    })
    return id
  },

  addAudioClip(mediaId, start) {
    const { project } = get()
    const media = project.media.find((m) => m.id === mediaId)
    if (!media || media.kind !== 'audio') return null
    const id = uid('ac')
    get().edit((p) => {
      p.musicTrack.push({
        id,
        mediaId,
        start: Math.max(0, start),
        inPoint: 0,
        outPoint: media.duration ?? 30,
        volume: 0.6,
        fadeIn: 1,
        fadeOut: 1.5
      })
      p.musicTrack.sort((a, b) => a.start - b.start)
    })
    return id
  },

  removeClip(id) {
    get().edit((p) => {
      const found = findClip(p, id)
      if (!found) return
      if (found.kind === 'video') {
        // Trilha magnética: remover puxa os seguintes (não deixa buraco).
        p.videoTrack.splice(found.index, 1)
        const last = p.videoTrack[p.videoTrack.length - 1]
        if (last) delete last.transitionAfter
      } else if (found.kind === 'image') {
        p.overlayTracks[found.track].splice(found.index, 1)
      } else {
        p.musicTrack.splice(found.index, 1)
      }
    })
  },

  splitAt(time) {
    const { project } = get()
    const layout = computeLayout(project)
    const target = layout.clips.find((c) => time > c.timelineStart + 0.05 && time < c.timelineEnd - 0.05)
    if (!target) return
    get().edit((p) => {
      const index = p.videoTrack.findIndex((c) => c.id === target.clipId)
      if (index < 0) return
      const original = p.videoTrack[index]
      const cutAtSource = original.inPoint + (time - target.timelineStart)
      const right: VideoClip = {
        ...clone(original),
        id: uid('vc'),
        inPoint: cutAtSource
      }
      original.outPoint = cutAtSource
      // A transição que existia depois do clipe passa a ser da metade direita;
      // a junção nova nasce como corte seco.
      right.transitionAfter = original.transitionAfter
      delete original.transitionAfter
      p.videoTrack.splice(index + 1, 0, right)
    })
  },

  moveVideoClip(from, to) {
    get().edit((p) => {
      if (from === to || from < 0 || from >= p.videoTrack.length) return
      const [clip] = p.videoTrack.splice(from, 1)
      p.videoTrack.splice(Math.max(0, Math.min(to, p.videoTrack.length)), 0, clip)
      const last = p.videoTrack[p.videoTrack.length - 1]
      if (last) delete last.transitionAfter
    })
  },

  setTransition(junctionIndex, duration) {
    const { project } = get()
    get().edit((p) => {
      const clip = p.videoTrack[junctionIndex]
      if (!clip || !p.videoTrack[junctionIndex + 1]) return
      if (duration == null) {
        delete clip.transitionAfter
        return
      }
      const max = Math.max(MIN_TRANSITION, maxTransitionAt(project, junctionIndex))
      const value = Math.min(Math.max(duration, MIN_TRANSITION), Math.min(MAX_TRANSITION, max))
      clip.transitionAfter = { duration: value }
    })
  },

  ensureOverlayTrack(index) {
    get().update((p) => {
      while (p.overlayTracks.length <= index) p.overlayTracks.push([])
    })
  },

  setAdjust(adjust) {
    get().update((p) => {
      p.adjust = { ...p.adjust, ...adjust }
    })
  }
}))

/** Helpers de leitura usados pelos componentes. */
export const mediaOf = (project: Project, mediaId: string): MediaItem | undefined =>
  project.media.find((m) => m.id === mediaId)

export const videoClipDuration = clipDuration
