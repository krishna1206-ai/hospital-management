import { createApp } from './app.js'
import { config } from './config.js'
import { get } from './db/index.js'
import { seed, seedBaseline } from './db/seed.js'

seedBaseline()
if (!get('SELECT id FROM users LIMIT 1')) {
  if (config.isProduction) {
    console.error('No users exist. Run "npm run create-admin" to create the first administrator.')
  } else {
    await seed()
    console.log('Empty database: loaded demo data. See README for sign-in accounts.')
  }
}

const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
