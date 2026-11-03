import type { EncoderSupport } from '@shared/types'
import { ffmpegPath } from './paths'
import { run } from './run'

const ENCODERS = ['hevc_nvenc', 'h264_nvenc', 'av1_nvenc'] as const

/**
 * Testa cada encoder com um encode real de 1 frame — `-encoders` mente: lista
 * o NVENC mesmo em máquina sem placa NVIDIA, e só falha na hora do export.
 * A detecção é refeita a cada inicialização para acompanhar o estado atual da GPU.
 */
export async function detectEncoders(): Promise<EncoderSupport> {
  const result: EncoderSupport = { hevc_nvenc: false, h264_nvenc: false, av1_nvenc: false }

  for (const enc of ENCODERS) {
    const { code } = await run(
      ffmpegPath(),
      [
        '-hide_banner', '-nostdin',
        '-f', 'lavfi',
        '-i', 'nullsrc=s=640x360:d=0.1',
        '-c:v', enc, '-gpu', '0',
        '-frames:v', '1',
        '-f', 'null', '-'
      ],
      20_000
    )
    result[enc] = code === 0
  }

  return result
}

export async function ffmpegAvailable(): Promise<boolean> {
  const { code } = await run(ffmpegPath(), ['-version'], 10_000)
  return code === 0
}

let cachedFlag: '-/filter_complex' | '-filter_complex_script' | null = null

/**
 * Descobre como esta build carrega o grafo de um arquivo. `-filter_complex_script`
 * foi removido nas builds de 2024+; a substituição é `-/filter_complex` (mecanismo
 * genérico de "ler valor da opção de um arquivo"). Preferimos a flag nova e só
 * caímos para a antiga se a nova não for reconhecida.
 */
export async function filterComplexFlag(): Promise<'-/filter_complex' | '-filter_complex_script'> {
  if (cachedFlag) return cachedFlag
  const { stdout, stderr } = await run(ffmpegPath(), ['-hide_banner', '-h', 'full'], 15_000)
  const help = `${stdout}\n${stderr}`
  // A ajuda lista `-filter_complex` mas não `-/filter_complex` (é sintaxe genérica);
  // se a opção antiga sumiu da ajuda, a build é nova e usa a sintaxe `-/`.
  cachedFlag = help.includes('-filter_complex_script') ? '-filter_complex_script' : '-/filter_complex'
  return cachedFlag
}
