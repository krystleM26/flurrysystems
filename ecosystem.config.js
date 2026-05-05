module.exports = {
  apps: [
    {
      name: 'flurry-systems',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/flurry/error.log',
      out_file: '/var/log/flurry/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
