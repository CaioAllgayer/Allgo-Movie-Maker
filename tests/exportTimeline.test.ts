import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildExportCommand } from '@engine/buildExportCommand'
import { media, project, videoClip } from './helpers'

const FFMPEG = resolve(__dirname, '../resources/bin/ffmpeg.exe')
const FFPROBE = resolve(__dirname, '../resources/bin/ffprobe.exe')

describe.skipIf(!process.env['ALLGO_E2E'] || !existsSync(FFMPEG) || !existsSync(FFPROBE))('export — duração real', () => {
  it('inclui o clipe cujo arquivo tem faixa de áudio vazia no trecho escolhido', () => {
    const work = mkdtempSync(join(tmpdir(), 'allgo-timeline-'))
    try {
      const sources = ['red', 'green', 'blue'].map((color, i) => {
        const source = join(work, `source-${i}.mp4`)
        execFileSync(FFMPEG, [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=${i === 2 ? 30 : 60}:d=10`,
          ...(i === 2 ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=0.5'] : []),
          '-c:v', 'libx264', '-preset', 'ultrafast',
          ...(i === 2 ? ['-c:a', 'aac'] : []),
          source
        ])
        return source
      })
      const output = join(work, 'output.mp4')
      const script = join(work, 'filter.txt')
      const p = project({
        width: 320,
        height: 180,
        media: sources.map((source, i) => media(`m${i}`, { path: source, hasAudio: i === 2 })),
        videoTrack: [
          videoClip('c0', 'm0', { inPoint: 2.682923, outPoint: 4.859397, transitionAfter: { duration: 0.2 } }),
          videoClip('c1', 'm1', { inPoint: 4.778821, outPoint: 6.894003, transitionAfter: { duration: 0.2 } }),
          videoClip('c2', 'm2', { inPoint: 1.128311, outPoint: 3.152175 })
        ]
      })
      const command = buildExportCommand(p, output, {
        fps: 30, codec: 'libx264', quality: 'alta', width: 320, height: 180,
        hwaccel: false, filterScriptPath: script, filterComplexFlag: '-filter_complex_script'
      })
      writeFileSync(script, command.filterScript)
      const encode = spawnSync(FFMPEG, command.args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      expect(encode.status, encode.stderr?.slice(-1000)).toBe(0)
      const actualDuration = Number(execFileSync(FFPROBE, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'default=nw=1:nk=1', output
      ], { encoding: 'utf8' }).trim())
      expect(actualDuration).toBeGreaterThan(command.duration - 0.15)
    } finally {
      if (work.startsWith(tmpdir()) && existsSync(work)) rmSync(work, { recursive: true, force: true })
    }
  }, 30_000)
})
