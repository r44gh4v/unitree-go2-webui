// unitree_go2_webui local entry: the shared API app plus static files (or Vite
// hot reload with --dev), listening on a port. The API routes themselves live
// in app.mjs so the same code can also run as a serverless function on Vercel.

import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080

const { app, locked } = createApp()

// With --dev the interface is served by Vite in middleware mode on this same
// port, so edits to the source hot-reload in the open page - no rebuild, no
// manual refresh. Without it, the prebuilt dist/ is served as before.
const DEV = process.argv.includes('--dev')

if (DEV) {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    root: path.join(__dirname, '..'),
    server: { middlewareMode: true },
    appType: 'spa',
  })
  // API routes are registered first, so they win; everything else goes to Vite.
  app.use(vite.middlewares)
} else {
  const dist = path.join(__dirname, '..', 'dist')
  // Vite hashes every asset filename, so assets can be cached forever; the
  // HTML must revalidate so a rebuild shows up on the next load.
  app.use(express.static(dist, {
    index: false,
    setHeaders: (res, filePath) => {
      res.setHeader(
        'Cache-Control',
        filePath.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate',
      )
    },
  }))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) res.status(404).send('The interface has not been built yet. Run: npm run build')
    })
  })
}

/** Every address this machine can be reached on, so the console is findable
 *  from a phone or a second laptop without anyone hunting for the IP. */
function lanUrls() {
  const out = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`)
    }
  }
  return out
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[unitree_go2_webui] http://localhost:${PORT}${DEV ? ' (dev, hot reload on)' : ''}`)
  // The server already listens on every interface; the only thing missing was
  // saying so. Any device on this network can drive the robot through these,
  // and unlike a cloud deployment they can use every connection method.
  for (const url of lanUrls()) {
    console.log(`[unitree_go2_webui] ${url}  (from any device on this network)`)
  }
  if (locked) {
    console.log('[unitree_go2_webui] password protection is ON - every API call needs a login')
  } else {
    console.log(
      '[unitree_go2_webui] no password set - anyone who can reach this port can drive the robot.\n' +
        '                    Set WEBUI_PASSWORD before exposing it beyond this machine.',
    )
  }
})
