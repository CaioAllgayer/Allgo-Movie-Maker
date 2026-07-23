/** Ponte para o atalho "Capturar frame" (Ctrl+Shift+S) chamar o Preview. */
export const captureRegistry: { capture: null | (() => string | null) } = { capture: null }
