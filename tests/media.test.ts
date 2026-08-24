import { describe, expect, it } from 'vitest'
import { waveformSliceStyle } from '@engine/media'

describe('waveformSliceStyle', () => {
  it('estica o arquivo inteiro quando o clipe usa o arquivo todo', () => {
    const style = waveformSliceStyle(10, 0, 10, 200)
    expect(style.backgroundSize).toBe('200px 100%')
    expect(style.backgroundPosition).toBe('0px 50%')
  })

  it('recorta o trecho in/out no bloco do clipe', () => {
    // 50 s de arquivo, clipe usa 20–30 s, bloco de 100 px → a PNG inteira tem 500 px
    // e anda 200 px para a esquerda (20 s / 10 s * 100).
    const style = waveformSliceStyle(50, 20, 30, 100)
    expect(style.backgroundSize).toBe('500px 100%')
    expect(style.backgroundPosition).toBe('-200px 50%')
  })
})
