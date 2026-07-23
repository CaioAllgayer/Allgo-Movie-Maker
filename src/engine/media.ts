import type { ColorAdjust, MediaItem, MediaKind } from '@shared/types'
import { uid } from '@store/project'

/** URL do protocolo custom que o main serve (ver electron/protocol.ts). */
export function mediaUrl(path: string): string {
  return `allgo://media/?path=${encodeURIComponent(path)}`
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mts']

export function kindOf(path: string): MediaKind | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return null
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Roda o ffprobe e monta os MediaItem de uma lista de caminhos. */
export async function importPaths(paths: string[]): Promise<{ items: MediaItem[]; errors: string[] }> {
  const items: MediaItem[] = []
  const errors: string[] = []

  for (const path of paths) {
    const kind = kindOf(path)
    if (!kind) {
      errors.push(`${baseName(path)}: formato não suportado`)
      continue
    }
    try {
      const info = await window.allgo.probeFile(path)
      const [thumb] = await window.allgo.generateThumbnails(path, 1, 80)
      items.push({
        id: uid('m'),
        path,
        name: baseName(path),
        kind,
        duration: kind === 'image' ? undefined : info.duration,
        width: info.width || undefined,
        height: info.height || undefined,
        fps: info.fps || undefined,
        hasAudio: info.hasAudio,
        thumbnail: thumb
      })
    } catch (err) {
      errors.push(`${baseName(path)}: ${(err as Error).message}`)
    }
  }
  return { items, errors }
}

/**
 * Mapeamento dos sliders para o filtro CSS do preview.
 *
 * ⚠️ CSS e o filtro `eq` do FFmpeg não são matematicamente idênticos (as curvas
 * são diferentes, principalmente no contraste em extremos). Com este mapeamento
 * — o mesmo documentado em §9.4 e implementado em buildExportCommand.ts — os
 * dois ficam próximos o suficiente para ajustes moderados, que é o uso real.
 */
export function cssFilterFor(adjust: ColorAdjust): string {
  const brightness = 1 + adjust.brightness / 200
  const contrast = 1 + adjust.contrast / 100
  const saturate = 1 + adjust.saturation / 100
  return `brightness(${brightness.toFixed(4)}) contrast(${contrast.toFixed(4)}) saturate(${saturate.toFixed(4)})`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}
