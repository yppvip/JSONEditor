import type { ElectronApplication } from '@playwright/test'

/** Test teardown discards fixture changes; production close protection remains active. */
export async function closeApp(app: ElectronApplication): Promise<void> {
  try {
    if (app.process().exitCode !== null) return
  } catch {
    return
  }
  await app
    .evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    .catch(() => {})
  await app.close()
}
