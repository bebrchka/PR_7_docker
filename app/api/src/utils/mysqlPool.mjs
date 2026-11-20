import mysql from 'mysql2'

const password = process.env.MYSQL_PASSWORD

if (!password) {
  throw new Error('MYSQL_PASSWORD must be set')
}

const pool = mysql.createPool({
  connectionLimit: 100,
  host: process.env.MYSQL_HOST || 'mysql',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password,
  database: process.env.MYSQL_DATABASE || 'time_db',
  waitForConnections: true,
})

export default pool
