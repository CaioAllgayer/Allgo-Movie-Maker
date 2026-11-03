import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildExportCommand } from '@engine/buildExportCommand'
import { imageClip, media, project, videoClip } from './helpers'

const FFMPEG = resolve(__dirname, '../resources/bin/ffmpeg.exe')

describe.skipIf(!process.env['ALLGO_E2E'] || !existsSync(FFMPEG))('export Reels — FFmpeg real', () => {
  it('mantém a largura da imagem exibida na prévia vertical', () => {
    const work = mkdtempSync(join(tmpdir(), 'allgo-portrait-'))
    try {
      const source = join(work, 'source.mp4')
      const overlay = join(work, 'overlay.ppm')
      const output = join(work, 'output.mp4')
      const script = join(work, 'filter.txt')

      execFileSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=1',
        '-c:v', 'libx264', '-preset', 'ultrafast', source
      ])
      writeFileSync(overlay, Buffer.concat([
        Buffer.from('P6\n80 40\n255\n'),
        Buffer.alloc(80 * 40 * 3, 255)
      ]))

      const reel = project({
        width: 108,
        height: 192,
        media: [
          media('video', { path: source, width: 320, height: 180, duration: 1, hasAudio: false }),
          media('image', { path: overlay, kind: 'image', width: 80, height: 40 })
        ],
        videoTrack: [videoClip('v1', 'video', { outPoint: 1 })],
        overlayTracks: [[imageClip('i1', 'image', {
          x: 0.5, y: 0.5, scale: 0.75, duration: 1, fadeIn: 0, fadeOut: 0
        })]]
      })
      const command = buildExportCommand(reel, output, {
        fps: 30, codec: 'libx264', quality: 'alta',
        width: 108, height: 192, hwaccel: false,
        filterScriptPath: script, filterComplexFlag: '-filter_complex_script'
      })
      writeFileSync(script, command.filterScript)
      const encode = spawnSync(FFMPEG, command.args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      expect(encode.status, encode.stderr?.slice(-2000)).toBe(0)

      // Na linha central, a imagem branca de 80 px com escala 0,75 deve ocupar 60 px.
      const frame = execFileSync(FFMPEG, [
        '-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
      ])
      const row = frame.subarray(96 * 108, 97 * 108)
      const whiteWidth = [...row].filter((value) => value > 200).length
      expect(whiteWidth).toBeGreaterThanOrEqual(58)
      expect(whiteWidth).toBeLessThanOrEqual(62)
    } finally {
      // O alvo foi criado por mkdtempSync dentro da pasta temporária do sistema.
      if (work.startsWith(tmpdir()) && existsSync(work)) rmSync(work, { recursive: true, force: true })
    }
  }, 30_000)
})
