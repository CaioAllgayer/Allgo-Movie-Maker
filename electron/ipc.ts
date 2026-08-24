import { basename, dirname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ExportOptions, Project } from '@shared/types'
import { probeFile } from './ffmpeg/probe'
import { generateThumbnails, generateWaveform } from './ffmpeg/thumbnails'
import { detectEncoders, ffmpegAvailable } from './ffmpeg/detect'
import { cancelExport, startExport } from './ffmpeg/export'
import {
  addRecent,
  autosave,
  clearAutosave,
  lastVideoDir,
  latestAutosave,
  pathsExist,
  readAutosave,
  readProject,
  recentProjects,
  setLastVideoDir,
  writePng,
  writeProject
} from './storage'

const MEDIA_FILTERS = [
  { name: 'Mídia', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'm4a', 'aac'] },
  { name: 'Vídeos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] },
  { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
  { name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'aac'] }
]

function focused(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

export function registerIpc(): void {
  ipcMain.handle('media:probe', (_e, path: string) => probeFile(path))
  ipcMain.handle('media:thumbnails', (_e, path: string, count: number, height: number) =>
    generateThumbnails(path, count, height)
  )
  ipcMain.handle('media:waveform', (_e, path: string, width: number, height: number) =>
    generateWaveform(path, width, height)
  )

  ipcMain.handle('ffmpeg:encoders', () => detectEncoders())
  ipcMain.handle('ffmpeg:available', () => ffmpegAvailable())

  ipcMain.handle(
    'export:start',
    (event, project: Project, outputPath: string, options: Omit<ExportOptions, 'filterScriptPath'>) =>
      startExport(event.sender, project, outputPath, options)
  )
  ipcMain.handle('export:cancel', (_e, jobId: string) => cancelExport(jobId))

  /* ----------------------------- diálogos ----------------------------- */

  ipcMain.handle('dialog:openMedia', async () => {
    const win = focused()
    if (!win) return []
    const res = await dialog.showOpenDialog(win, {
      title: 'Importar mídia',
      properties: ['openFile', 'multiSelections'],
      filters: MEDIA_FILTERS
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('dialog:openProject', async () => {
    const win = focused()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: 'Abrir projeto',
      properties: ['openFile'],
      filters: [{ name: 'Projeto Allgo', extensions: ['allgo'] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:saveProject', async (_e, defaultName: string) => {
    const win = focused()
    if (!win) return null
    const res = await dialog.showSaveDialog(win, {
      title: 'Salvar projeto',
      defaultPath: `${defaultName}.allgo`,
      filters: [{ name: 'Projeto Allgo', extensions: ['allgo'] }]
    })
    return res.canceled ? null : res.filePath
  })

  ipcMain.handle('dialog:saveVideo', async (_e, defaultName: string) => {
    const win = focused()
    if (!win) return null
    // Abre na última pasta usada para exportar (se ainda existir).
    const dir = lastVideoDir()
    const res = await dialog.showSaveDialog(win, {
      title: 'Exportar vídeo',
      defaultPath: dir ? join(dir, `${defaultName}.mp4`) : `${defaultName}.mp4`,
      filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }]
    })
    if (res.canceled || !res.filePath) return null
    setLastVideoDir(dirname(res.filePath))
    return res.filePath
  })

  ipcMain.handle('dialog:savePng', async (_e, defaultName: string) => {
    const win = focused()
    if (!win) return null
    const res = await dialog.showSaveDialog(win, {
      title: 'Salvar frame',
      defaultPath: `${defaultName}.png`,
      filters: [{ name: 'Imagem PNG', extensions: ['png'] }]
    })
    return res.canceled ? null : res.filePath
  })

  ipcMain.handle('dialog:relocate', async (_e, name: string) => {
    const win = focused()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: `Relocalizar "${name}"`,
      properties: ['openFile'],
      filters: MEDIA_FILTERS
    })
    return res.canceled ? null : res.filePaths[0]
  })

  /* ----------------------------- projeto ------------------------------ */

  ipcMain.handle('project:read', (_e, path: string) => {
    const project = readProject(path)
    addRecent(path, project.name || basename(path, '.allgo'))
    return project
  })
  ipcMain.handle('project:write', (_e, path: string, project: Project) => writeProject(path, project))
  ipcMain.handle('project:autosave', (_e, project: Project) => autosave(project))
  ipcMain.handle('project:latestAutosave', () => latestAutosave())
  ipcMain.handle('project:readAutosave', (_e, path: string) => readAutosave(path))
  ipcMain.handle('project:clearAutosave', () => clearAutosave())
  ipcMain.handle('project:recent', () => recentProjects())

  /* ------------------------------ sistema ----------------------------- */

  ipcMain.handle('fs:pathsExist', (_e, paths: string[]) => pathsExist(paths))
  ipcMain.handle('fs:writePng', (_e, path: string, dataUrl: string) => writePng(path, dataUrl))
  ipcMain.handle('shell:showInFolder', (_e, path: string) => {
    shell.showItemInFolder(path)
  })
}
