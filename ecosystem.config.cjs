// pm2 process definition for the WhatsApp backend.
//
// Usage on the VPS:
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save            # persist across reboots
//   pm2 logs wa-backend
//
// Note: .cjs extension is required because package.json sets "type": "module".
module.exports = {
  apps: [
    {
      name: 'wa-backend',
      script: 'server/index.js',

      // cwd matters: the app resolves sessions/ relative to the working
      // directory, so this must point at the project root.
      cwd: __dirname,

      // Baileys keeps in-memory socket state per session, so this must stay a
      // single process. Do NOT switch to cluster mode or instances > 1: each
      // worker would open its own WhatsApp connection and fight over the same
      // auth files.
      instances: 1,
      exec_mode: 'fork',

      // Load secrets from .env at the project root (Node 22 supports this natively).
      node_args: '--env-file=.env',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,

      // Restart if memory creeps up (long-lived socket + message cache).
      max_memory_restart: '600M',

      // Give the process time to close sockets on SIGTERM.
      kill_timeout: 10000,

      env: {
        NODE_ENV: 'development',
        PORT: 5000,
        HOST: '127.0.0.1',
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        // Listen on loopback only; nginx terminates TLS and proxies to it.
        HOST: '127.0.0.1',
      },

      // Logs (pm2 rotates these with the pm2-logrotate module).
      output: './logs/backend-out.log',
      error: './logs/backend-error.log',
      time: true,
    },
  ],
};
