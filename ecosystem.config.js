module.exports = {
  apps: [
    {
      name: 'ai-call-backend',
      cwd: '/home/deployer/AI-Call-Analyzer/backend',
      script: 'src/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: '/home/deployer/AI-Call-Analyzer/backend/pm2-error.log',
      out_file: '/home/deployer/AI-Call-Analyzer/backend/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      name: 'ai-call-frontend',
      cwd: '/home/deployer/AI-Call-Analyzer/frontend',
      script: 'node_modules/.bin/next',
      args: 'start',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      error_file: '/home/deployer/AI-Call-Analyzer/frontend/pm2-error.log',
      out_file: '/home/deployer/AI-Call-Analyzer/frontend/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};

