import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import type { ExportOptions, ExportProgress, ExportResult, Project } from '@shared/types'
import { buildExportCommand } from '@engine/buildExportCommand'
import { ffmpegPath } from './paths'
import { filterComplexFlag } from './detect'

interface Job {
  id: string
  child: ChildProcessWithoutNullStreams
  outputPath: string
  scriptPath: string
  canceled: boolean
}

const jobs = new Map<string, Job>()

function tempDir(): string {
  const dir = join(app.getPath('userData'), 'tmp')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Roda o export. Devolve o jobId imediatamente; progresso e conclusão chegam
 * ao renderer por eventos (`export:progress` / `export:done`).
 */
export async function startExport(
  sender: WebContents,
  project: Project,
  outputPath: string,
  options: Omit<ExportOptions, 'filterScriptPath'>
): Promise<string> {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const scriptPath = join(tempDir(), `${id}.filter.txt`)

  const flag = await filterComplexFlag()
  const command = buildExportCommand(project, outputPath, {
    ...options,
    filterScriptPath: scriptPath,
    filterComplexFlag: flag
  })

  // ⚠️ O grafo passa fácil do limite de linha de comando do Windows com muitos
  // inputs, então vai sempre por arquivo (via -/filter_complex).
  writeFileSync(scriptPath, command.filterScript, 'utf8')

  const child = spawn(ffmpegPath(), command.args, { windowsHide: true })
  const job: Job = { id, child, outputPath, scriptPath, canceled: false }
  jobs.set(id, job)

  const total = command.duration
  let stderrLog = ''
  let stdoutBuffer = ''
  let lastSpeed = 0
  const speeds: number[] = []

  const emitProgress = (outTime: number, speed: number) => {
    if (speed > 0) {
      speeds.push(speed)
      if (speeds.length > 10) speeds.shift()
      lastSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length
    }
    const progress = total > 0 ? Math.max(0, Math.min(1, outTime / total)) : 0
    const remaining = total - outTime
    const payload: ExportProgress = {
      jobId: id,
      progress,
      outTime,
      speed: lastSpeed,
      etaSeconds: lastSpeed > 0 && remaining > 0 ? remaining / lastSpeed : null
    }
    if (!sender.isDestroyed()) sender.send('export:progress', payload)
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''
    let outTime: number | null = null
    let speed = 0
    for (const line of lines) {
      const [key, rawValue] = line.split('=')
      if (!key || rawValue === undefined) continue
      const value = rawValue.trim()
      if (key === 'out_time_us' || key === 'out_time_ms') {
        // out_time_ms do ffmpeg é, na prática, microssegundos (bug histórico
        // mantido por compatibilidade) — os dois campos vêm na mesma escala.
        const n = Number(value)
        if (Number.isFinite(n)) outTime = n / 1_000_000
      } else if (key === 'speed') {
        const n = Number.parseFloat(value.replace('x', ''))
        if (Number.isFinite(n)) speed = n
      }
    }
    if (outTime !== null) emitProgress(outTime, speed)
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrLog += chunk
    if (stderrLog.length > 400_000) stderrLog = stderrLog.slice(-200_000)
  })

  const finish = (result: ExportResult) => {
    jobs.delete(id)
    try {
      rmSync(scriptPath, { force: true })
    } catch {
      /* arquivo temporário: falha ao limpar não é problema */
    }
    if (!sender.isDestroyed()) sender.send('export:done', result)
  }

  child.on('error', (err) => {
    finish({
      jobId: id,
      ok: false,
      canceled: false,
      outputPath,
      log: stderrLog,
      error: `Não foi possível iniciar o FFmpeg: ${err.message}`
    })
  })

  child.on('close', (code) => {
    if (job.canceled) {
      // Cancelamento não pode deixar arquivo parcial (que abre corrompido).
      try {
        rmSync(outputPath, { force: true })
      } catch {
        /* pode estar travado pelo antivírus; o usuário apaga */
      }
      finish({ jobId: id, ok: false, canceled: true, outputPath, log: stderrLog })
      return
    }
    if (code === 0) {
      emitProgress(total, lastSpeed)
      finish({ jobId: id, ok: true, canceled: false, outputPath, log: stderrLog })
    } else {
      finish({
        jobId: id,
        ok: false,
        canceled: false,
        outputPath,
        log: stderrLog,
        error: lastFfmpegError(stderrLog) || `FFmpeg terminou com código ${code}.`
      })
    }
  })

  return id
}

export function cancelExport(jobId: string): void {
  const job = jobs.get(jobId)
  if (!job) return
  job.canceled = true
  job.child.kill('SIGKILL')
}

export function cancelAllExports(): void {
  for (const id of [...jobs.keys()]) cancelExport(id)
}

/** Extrai a última linha útil do stderr para a mensagem curta de erro. */
function lastFfmpegError(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (/error|invalid|no such|failed|unable|not found/i.test(l)) return l
  }
  return lines[lines.length - 1] ?? ''
}
