// Creates the first administrator on a real installation:
//   npm run create-admin -- "Full Name" admin@yourhospital.org "A-long-password-1"
import bcrypt from 'bcryptjs'
import { insert } from './index.js'
import { seedBaseline } from './seed.js'

const [name, email, password] = process.argv.slice(2)
if (!name || !email || !password) {
  console.error('Usage: npm run create-admin -- "Full Name" email password')
  process.exit(1)
}
if (password.length < 10) {
  console.error('Use a password of at least 10 characters.')
  process.exit(1)
}
seedBaseline()
insert('users', { name, email, role: 'admin', password_hash: await bcrypt.hash(password, 10) })
console.log(`Administrator ${email} created.`)
