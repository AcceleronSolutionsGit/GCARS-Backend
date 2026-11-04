/**
 * G-CARS 2 — Backend PM2 Ecosystem Configuration
 * ─────────────────────────────────────────────────────────────
 * Deployment commands:
 *   pm2 start ecosystem.config.js
 *   pm2 reload ecosystem.config.js --update-env
 *   pm2 stop ecosystem.config.js
 *   pm2 logs gcars-backend
 * ─────────────────────────────────────────────────────────────
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'gcars-backend',
      cwd: __dirname,
      script: 'src/server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 4000,
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 5040,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5040,
      },
      time: true,
      merge_logs: true,
      out_file: path.join(__dirname, 'logs/backend.out.log'),
      error_file: path.join(__dirname, 'logs/backend.err.log'),
    },
  ],
};
