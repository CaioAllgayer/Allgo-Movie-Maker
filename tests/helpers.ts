import type { ImageClip, MediaItem, Project, VideoClip } from '@shared/types'

export function media(id: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    path: `C:\\midia\\${id}.mp4`,
    name: `${id}.mp4`,
    kind: 'video',
    duration: 30,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    ...overrides
  }
}

export function videoClip(id: string, mediaId: string, overrides: Partial<VideoClip> = {}): VideoClip {
  return { id, mediaId, inPoint: 0, outPoint: 10, volume: 1, muted: false, ...overrides }
}

export function imageClip(id: string, mediaId: string, overrides: Partial<ImageClip> = {}): ImageClip {
  return {
    id,
    mediaId,
    start: 0,
    duration: 5,
    x: 0.5,
    y: 0.5,
    scale: 1,
    opacity: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides
  }
}

export function project(overrides: Partial<Project> = {}): Project {
  return {
    version: 1,
    name: 'teste',
    fps: 30,
    width: 1920,
    height: 1080,
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    media: [],
    videoTrack: [],
    overlayTracks: [],
    musicTrack: [],
    ...overrides
  }
}
