import { execFile } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Executa um binário e coleta a saída. Nunca rejeita por exit code != 0. */
export function run(bin: string, args: string[], timeout = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === 'number'
          ? Number((err as NodeJS.ErrnoException).code)
          : err
            ? 1
            : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    )
  })
}
