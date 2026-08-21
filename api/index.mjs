// Vercel serverless entry. The whole API app runs as one function; vercel.json
// rewrites every /api/* request here, and the Vite build serves the interface
// as static files. An Express app is itself a (req, res) handler, which is
// exactly what Vercel's Node runtime expects as the default export.

import { createApp } from '../server/app.mjs'

const { app } = createApp()

export default app
