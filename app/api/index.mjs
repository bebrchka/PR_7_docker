import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import {
  readRecords,
  insertRecord,
  deleteRecord,
} from './src/utils/records.mjs'
import {
  incrementTimesCreated,
  incrementTimesDeleted,
  initializeMetricsStorage,
  metricsRegistry,
  observeHttpRequest,
  persistHttpRequest,
  closeMetricsStorage,
} from './src/utils/metrics.mjs'

const PORT = Number(process.env.PORT || 5000)

const app = express()
app.use(bodyParser.json())
app.use(cors())
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint()
  res.once('finish', () => {
    if (req.path === '/metrics') return

    const labels = {
      method: req.method,
      route: typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
      status: String(res.statusCode),
    }
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9
    observeHttpRequest(labels, durationSeconds)
    persistHttpRequest(labels).catch((error) => {
      console.error('Failed to persist HTTP request counter:', error)
    })
  })
  next()
})

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next)
}

app.get('/', (_, res) => {
  res.send('Hello from the time saving service!')
})

app.get('/metrics', asyncRoute(async (_, res) => {
  res.set('Content-Type', metricsRegistry.contentType)
  res.end(await metricsRegistry.metrics())
}))

app.get('/healthz', (_, res) => {
  res.send('ok')
})

app.get('/times', asyncRoute(async (_, res) => {
  res.send(await readRecords())
}))

app.post('/times', asyncRoute(async (req, res) => {
  const result = await insertRecord(req.body.time)
  await incrementTimesCreated()
  res.send(result)
}))

app.delete('/time/:id', asyncRoute(async (req, res) => {
  const result = await deleteRecord(req.params.id)
  if (result.affectedRows) await incrementTimesDeleted()
  res.send(result)
}))

app.use((error, _, res, next) => {
  console.error('Request failed:', error)
  if (res.headersSent) return next(error)
  res.status(500).json({ error: 'Internal server error' })
})

async function startServer() {
  await initializeMetricsStorage()
  const server = app.listen(PORT, () => {
    console.log(`Express web server is running on port ${PORT}`)
  })

  const shutdown = (signal) => {
    console.log(`Received ${signal}; waiting for requests and metric writes to finish`)
    server.close(async (error) => {
      if (error) {
        console.error('Failed to stop the HTTP server cleanly:', error)
      }
      try {
        await closeMetricsStorage()
        process.exit(error ? 1 : 0)
      } catch (shutdownError) {
        console.error('Failed to close metric storage cleanly:', shutdownError)
        process.exit(1)
      }
    })
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
}

startServer().catch((error) => {
  console.error('Failed to initialize the application:', error)
  process.exit(1)
})
