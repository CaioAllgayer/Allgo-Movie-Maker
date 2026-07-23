import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { buildExportCommand } from '@engine/buildExportCommand'
import { computeLayout } from '@engine/computeLayout'

/**
 * Teste de integração: monta um projeto realista, gera o comando e roda o
 * FFmpeg de verdade. Os testes unitários conferem o formato do grafo; só este
 * prova que o FFmpeg ACEITA o grafo — erro de sintaxe de filtro não aparece de
 * outro jeito.
 *
 * Precisa dos binários (`npm run setup`) e leva ~30 s, então fica fora do
 * `npm test` normal. Para rodar:
 *
 *   ALLGO_E2E=1 npx vitest run tests/exportIntegration.test.ts
 */

const ROOT = resolve(__dirname, '..')
const FFMPEG = join(ROOT, 'resources', 'bin', 'ffmpeg.exe')
const FFPROBE = join(ROOT, 'resources', 'bin', 'ffprobe.exe')
const WORK = join(tmpdir(), 'allgo-e2e')

const enabled = Boolean(process.env['ALLGO_E2E']) && existsSync(FFMPEG)

const paths = {
  landscape: join(WORK, 'landscape.mp4'),
  vertical: join(WORK, 'vertical.mp4'),
  silent: join(WORK, 'silent.mp4'),
  placa1: join(WORK, 'placa1.png'),
  placa2: join(WORK, 'placa2.png'),
  music: join(WORK, 'music.m4a'),
  output: join(WORK, 'saida.mp4'),
  filter: join(WORK, 'filter.txt')
}

function ffmpeg(args: string[]): void {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
}

function probeDuration(file: string): number {
  const out = execFileSync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    file
  ])
  return Number(String(out).trim())
}

function probeStreams(file: string): { codec_type: string; width?: number; height?: number }[] {
  const out = execFileSync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height',
    '-of', 'json',
    file
  ])
  return JSON.parse(String(out)).streams
}

describe.skipIf(!enabled)('export — integração com o FFmpeg real', () => {
  beforeAll(() => {
    rmSync(WORK, { recursive: true, force: true })
    mkdirSync(WORK, { recursive: true })

    // 1080p com áudio
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      paths.landscape
    ])
    // vertical de celular: tem que entrar com barras, sem esticar
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      paths.vertical
    ])
    // 720p, 25 fps e SEM faixa de áudio
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      paths.silent
    ])
    // placas com canal alpha
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=600x300:d=1', '-frames:v', '1', '-pix_fmt', 'rgba', paths.placa1])
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=400x400:d=1', '-frames:v', '1', '-pix_fmt', 'rgba', paths.placa2])
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', '-c:a', 'aac', paths.music])
  }, 180_000)

  it('exporta um projeto completo e a duração final bate com a timeline', () => {
    const project: Project = {
      version: 1,
      name: 'e2e',
      fps: 30,
      width: 1920,
      height: 1080,
      adjust: { brightness: 15, contrast: 10, saturation: 5 },
      media: [
        { id: 'm1', path: paths.landscape, name: 'landscape.mp4', kind: 'video', duration: 6, width: 1920, height: 1080, fps: 30, hasAudio: true },
        { id: 'm2', path: paths.vertical, name: 'vertical.mp4', kind: 'video', duration: 6, width: 1080, height: 1920, fps: 30, hasAudio: true },
        { id: 'm3', path: paths.silent, name: 'silent.mp4', kind: 'video', duration: 5, width: 1280, height: 720, fps: 25, hasAudio: false },
        { id: 'p1', path: paths.placa1, name: 'placa1.png', kind: 'image', width: 600, height: 300 },
        { id: 'p2', path: paths.placa2, name: 'placa2.png', kind: 'image', width: 400, height: 400 },
        { id: 'a1', path: paths.music, name: 'music.m4a', kind: 'audio', duration: 30, hasAudio: true }
      ],
      videoTrack: [
        // cortado no início/fim + abre do preto + crossfade de 1 s
        { id: 'v1', mediaId: 'm1', inPoint: 0.5, outPoint: 5, volume: 1, muted: false, fadeFromBlack: 1, transitionAfter: { duration: 1 } },
        // vertical, corte seco depois
        { id: 'v2', mediaId: 'm2', inPoint: 1, outPoint: 5, volume: 1.5, muted: false },
        // sem áudio, mutado, fecha no preto
        { id: 'v3', mediaId: 'm3', inPoint: 0, outPoint: 4, volume: 1, muted: true, fadeToBlack: 1.5 }
      ],
      overlayTracks: [
        [{ id: 'i1', mediaId: 'p1', start: 1, duration: 3, x: 0.5, y: 0.25, scale: 1, opacity: 1, fadeIn: 0.5, fadeOut: 0.5 }],
        [{ id: 'i2', mediaId: 'p2', start: 2.5, duration: 4, x: 0.8, y: 0.7, scale: 0.6, opacity: 0.85, fadeIn: 0.4, fadeOut: 0 }]
      ],
      musicTrack: [
        { id: 'mu1', mediaId: 'a1', start: 0, inPoint: 2, outPoint: 14, volume: 0.4, fadeIn: 1, fadeOut: 2 }
      ]
    }

    const command = buildExportCommand(project, paths.output, {
      fps: 30,
      // libx264 para o teste não depender de ter placa NVIDIA na máquina.
      codec: 'libx264',
      quality: 'media',
      width: 1920,
      height: 1080,
      hwaccel: false,
      filterScriptPath: paths.filter,
      filterComplexFlag: '-/filter_complex'
    })
    writeFileSync(paths.filter, command.filterScript, 'utf8')

    const run = spawnSync(FFMPEG, command.args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    expect(run.stderr?.slice(-4000) ?? '', 'ffmpeg deve aceitar o grafo').toSatisfy(() => run.status === 0)
    expect(run.status).toBe(0)

    const expected = computeLayout(project).duration
    const actual = probeDuration(paths.output)
    // Critério de aceite: duração final = duração da timeline (± 1 frame).
    expect(Math.abs(actual - expected)).toBeLessThan(2 / 30)

    const streams = probeStreams(paths.output)
    const video = streams.find((s) => s.codec_type === 'video')
    expect(video?.width).toBe(1920)
    expect(video?.height).toBe(1080)
    expect(streams.some((s) => s.codec_type === 'audio')).toBe(true)
  }, 300_000)

  it('exporta um clipe único sem transições nem overlays', () => {
    const project: Project = {
      version: 1,
      name: 'simples',
      fps: 30,
      width: 1920,
      height: 1080,
      adjust: { brightness: 0, contrast: 0, saturation: 0 },
      media: [
        { id: 'm1', path: paths.landscape, name: 'landscape.mp4', kind: 'video', duration: 6, width: 1920, height: 1080, fps: 30, hasAudio: true }
      ],
      videoTrack: [{ id: 'v1', mediaId: 'm1', inPoint: 1, outPoint: 4, volume: 1, muted: false }],
      overlayTracks: [],
      musicTrack: []
    }
    const output = join(WORK, 'simples.mp4')
    const filter = join(WORK, 'simples.txt')
    const command = buildExportCommand(project, output, {
      fps: 30,
      codec: 'libx264',
      quality: 'media',
      width: 1920,
      height: 1080,
      hwaccel: false,
      filterScriptPath: filter,
      filterComplexFlag: '-/filter_complex'
    })
    writeFileSync(filter, command.filterScript, 'utf8')

    const run = spawnSync(FFMPEG, command.args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    expect(run.status, run.stderr?.slice(-3000)).toBe(0)
    expect(Math.abs(probeDuration(output) - 3)).toBeLessThan(2 / 30)
  }, 180_000)
})
