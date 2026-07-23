import { extname } from 'node:path'
import type { MediaInfo, MediaKind } from '@shared/types'
import { ffprobePath } from './paths'
import { run } from './run'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mts'])

export function kindFromPath(path: string): MediaKind | null {
  const ext = extname(path).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (VIDEO_EXT.has(ext)) return 'video'
  return null
}

function parseFraction(value: string | undefined): number {
  if (!value) return 0
  const [a, b] = value.split('/')
  const n = Number(a)
  const d = b === undefined ? 1 : Number(b)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0
  return n / d
}

export async function probeFile(path: string): Promise<MediaInfo> {
  const { code, stdout, stderr } = await run(ffprobePath(), [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path
  ])
  if (code !== 0) throw new Error(`ffprobe falhou em ${path}: ${stderr.trim() || 'erro desconhecido'}`)

  const data = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>
    format?: Record<string, unknown>
  }
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')

  const kind = kindFromPath(path) ?? (video ? 'video' : audio ? 'audio' : 'video')

  // ⚠️ Vídeos de celular podem trazer rotação nos metadados. A largura/altura
  // "de exibição" já vem trocada quando há side data de rotação em builds
  // recentes do ffprobe; o Chromium e o FFmpeg (autorotate ligado por padrão)
  // aplicam a rotação sozinhos, então só normalizamos aqui.
  let width = Number(video?.width ?? 0)
  let height = Number(video?.height ?? 0)
  const rotation = Math.abs(Number(video?.rotation ?? 0)) % 180
  if (rotation === 90) [width, height] = [height, width]

  const formatDuration = Number((data.format?.duration as string) ?? 0)
  const streamDuration = Number((video?.duration ?? audio?.duration ?? 0) as string)
  const duration = Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : streamDuration

  const fps =
    parseFraction(video?.avg_frame_rate as string) ||
    parseFraction(video?.r_frame_rate as string) ||
    30

  return {
    kind,
    duration: kind === 'image' ? 0 : Math.max(0, duration || 0),
    width: width || 0,
    height: height || 0,
    fps: kind === 'image' ? 0 : Math.round(fps * 1000) / 1000,
    hasAudio: Boolean(audio),
    codec: String(video?.codec_name ?? audio?.codec_name ?? '')
  }
}
