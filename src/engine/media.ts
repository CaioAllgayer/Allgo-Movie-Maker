import type { ColorAdjust, MediaItem, MediaKind } from '@shared/types'
import { uid } from '@store/project'

/** URL do protocolo custom que o main serve (ver electron/protocol.ts). */
export function mediaUrl(path: string): string {
  return `allgo://media/?path=${encodeURIComponent(path)}`
}

/**
 * URL distinta por deck. Dois <video> com o MESMO src compartilham o pipeline
 * no Chromium — seek num clipe splitado puxava o outro de volta. O protocolo
 * ignora o query extra e continua servindo o arquivo.
 */
export function deckMediaUrl(path: string, deck: number): string {
  return `allgo://media/?path=${encodeURIComponent(path)}&deck=${deck}`
}

/**
 * Recorta a PNG da waveform (arquivo inteiro) no trecho in/out do clipe.
 * `clipWidthPx` é a largura atual do bloco na timeline.
 */
export function waveformSliceStyle(
  mediaDuration: number | undefined,
  inPoint: number,
  outPoint: number,
  clipWidthPx: number
): { backgroundSize: string; backgroundPosition: string; backgroundRepeat: string } {
  const span = Math.max(0.001, outPoint - inPoint)
  const total = mediaDuration && mediaDuration > 0 ? mediaDuration : span
  const width = Math.max(1, clipWidthPx)
  return {
    backgroundSize: `${(total / span) * width}px 100%`,
    backgroundPosition: `${-(inPoint / span) * width}px 50%`,
    backgroundRepeat: 'no-repeat'
  }
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
 * Brilho CSS é multiplicativo (`brightness(1 + v/200)`). O export replica isso
 * com `colorchannelmixer` em RGB (ver `colorFilterChain` em buildExportCommand),
 * não com o `eq brightness` aditivo — esse último quase não aparecia no arquivo
 * final. Contraste e saturação usam o mesmo fator nos dois lados.
 */
export function cssFilterFor(adjust: ColorAdjust): string {
  const brightness = 1 + adjust.brightness / 200
  const contrast = 1 + adjust.contrast / 100
  const saturate = 1 + adjust.saturation / 100
  return `brightness(${brightness.toFixed(4)}) contrast(${contrast.toFixed(4)}) saturate(${saturate.toFixed(4)})`
}

/** Nome padrão sugerido ao salvar/exportar: "BEA dd-mm-aaaa" (válido no Windows). */
export function suggestedFileName(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `BEA ${dd}-${mm}-${now.getFullYear()}`
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
