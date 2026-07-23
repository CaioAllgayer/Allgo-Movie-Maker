import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const EXE = process.platform === 'win32' ? '.exe' : ''

function candidates(name: string): string[] {
  const bin = `${name}${EXE}`
  return [
    // empacotado (electron-builder: extraResources -> resources/bin)
    join(process.resourcesPath ?? '', 'bin', bin),
    // dev
    join(app.getAppPath(), 'resources', 'bin', bin),
    join(process.cwd(), 'resources', 'bin', bin)
  ]
}

function resolveBinary(name: string): string {
  for (const p of candidates(name)) {
    if (p && existsSync(p)) return p
  }
  // último recurso: confia no PATH do sistema
  return `${name}${EXE}`
}

let cachedFfmpeg: string | null = null
let cachedFfprobe: string | null = null

export function ffmpegPath(): string {
  if (!cachedFfmpeg) cachedFfmpeg = resolveBinary('ffmpeg')
  return cachedFfmpeg
}

export function ffprobePath(): string {
  if (!cachedFfprobe) cachedFfprobe = resolveBinary('ffprobe')
  return cachedFfprobe
}

/** Diretório de cache de thumbnails/waveforms. */
export function cacheDir(): string {
  return join(app.getPath('userData'), 'cache')
}
