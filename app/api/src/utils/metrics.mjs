import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client'
import pool from './mysqlPool.mjs'

const database = pool.promise()
const metricLabels = ['method', 'route', 'status']
const registry = new Registry()
const persistentCounters = new Map()
const pendingMetricWrites = new Set()

registry.setDefaultLabels({ application: 'time-app' })

const httpRequestsTotal = new Counter({
  name: 'time_app_http_requests_total',
  help: 'Total number of completed application HTTP requests.',
  labelNames: metricLabels,
  registers: [registry],
})

const httpRequestDuration = new Histogram({
  name: 'time_app_http_request_duration_seconds',
  help: 'Duration of application HTTP requests in seconds.',
  labelNames: metricLabels,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
})

const timesCreatedTotal = new Counter({
  name: 'time_app_times_created_total',
  help: 'Total number of time records created.',
  registers: [registry],
})

const timesDeletedTotal = new Counter({
  name: 'time_app_times_deleted_total',
  help: 'Total number of time records deleted.',
  registers: [registry],
})

persistentCounters.set(httpRequestsTotal.name, httpRequestsTotal)
persistentCounters.set(timesCreatedTotal.name, timesCreatedTotal)
persistentCounters.set(timesDeletedTotal.name, timesDeletedTotal)

new Gauge({
  name: 'time_app_times_current',
  help: 'Current number of saved time records in MySQL.',
  registers: [registry],
  async collect() {
    const [rows] = await database.execute('SELECT COUNT(*) AS count FROM times')
    this.set(Number(rows[0].count))
  },
})

new Gauge({
  name: 'time_app_process_uptime_seconds',
  help: 'Seconds since the current Node.js process started.',
  registers: [registry],
  collect() {
    this.set(process.uptime())
  },
})

new Gauge({
  name: 'time_app_mysql_up',
  help: 'Whether the application can reach MySQL (1 = up, 0 = down).',
  registers: [registry],
  async collect() {
    try {
      await database.execute('SELECT 1')
      this.set(1)
    } catch (error) {
      console.error('MySQL health check failed:', error)
      this.set(0)
    }
  },
})

collectDefaultMetrics({ register: registry })

function getSeriesKey(metricName, labels) {
  return `${metricName}:${JSON.stringify(labels)}`
}

async function incrementPersistentCounter(counter, labels = {}) {
  const labelsJson = JSON.stringify(labels)
  await database.execute(
    `INSERT INTO app_metric_counters
      (series_key, metric_name, labels_json, metric_value)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE metric_value = metric_value + 1`,
    [getSeriesKey(counter.name, labels), counter.name, labelsJson]
  )
  counter.inc(labels)
}

async function initializeMetricsStorage() {
  await database.execute(`CREATE TABLE IF NOT EXISTS times (
    id INT AUTO_INCREMENT PRIMARY KEY,
    time TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`)
  await database.execute(`CREATE TABLE IF NOT EXISTS app_metric_counters (
    series_key VARCHAR(512) PRIMARY KEY,
    metric_name VARCHAR(128) NOT NULL,
    labels_json JSON NOT NULL,
    metric_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`)

  const [rows] = await database.execute(
    'SELECT metric_name, labels_json, metric_value FROM app_metric_counters'
  )
  for (const row of rows) {
    const counter = persistentCounters.get(row.metric_name)
    if (!counter) {
      throw new Error(`No registered Prometheus counter for ${row.metric_name}`)
    }
    const labels = typeof row.labels_json === 'string'
      ? JSON.parse(row.labels_json)
      : row.labels_json
    const value = Number(row.metric_value)
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid persisted value for ${row.metric_name}`)
    }
    counter.inc(labels, value)
  }

  console.log(`Restored ${rows.length} persistent Prometheus counter series from MySQL`)
}

function observeHttpRequest(labels, durationSeconds) {
  httpRequestDuration.observe(labels, durationSeconds)
}

function persistHttpRequest(labels) {
  const pendingWrite = incrementPersistentCounter(httpRequestsTotal, labels)
  pendingMetricWrites.add(pendingWrite)
  return pendingWrite.finally(() => pendingMetricWrites.delete(pendingWrite))
}

function incrementTimesCreated() {
  return incrementPersistentCounter(timesCreatedTotal)
}

function incrementTimesDeleted() {
  return incrementPersistentCounter(timesDeletedTotal)
}

async function closeMetricsStorage() {
  await Promise.all(pendingMetricWrites)
  await database.end()
}

export {
  closeMetricsStorage,
  incrementTimesCreated,
  incrementTimesDeleted,
  initializeMetricsStorage,
  observeHttpRequest,
  persistHttpRequest,
  registry as metricsRegistry,
}
