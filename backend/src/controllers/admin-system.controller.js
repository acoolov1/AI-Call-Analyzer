import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { query } from '../config/database.js';

const execAsync = promisify(exec);

export class AdminSystemController {
  static async getSystemMetrics(req, res) {
    try {
      const timestamp = Date.now();
      
      // Get CPU metrics
      const cpus = os.cpus();
      const loadAverage = os.loadavg();
      const cpuCount = cpus.length;
      
      // Calculate CPU usage (simplified - percentage of load vs cores)
      const cpuUsage = Math.min(100, (loadAverage[0] / cpuCount) * 100);
      
      // Get memory metrics
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryPercentUsed = (usedMemory / totalMemory) * 100;
      
      // Get process memory
      const processMemory = process.memoryUsage();
      
      // Get disk space
      let diskInfo = {
        total: 'N/A',
        used: 'N/A',
        available: 'N/A',
        percentUsed: 0
      };
      
      try {
        const { stdout } = await execAsync('df -h / | tail -1');
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 5) {
          diskInfo = {
            total: parts[1],
            used: parts[2],
            available: parts[3],
            percentUsed: parseInt(parts[4])
          };
        }
      } catch (error) {
        console.error('Error getting disk info:', error);
      }
      
      // Get top processes
      let processes = [];
      try {
        const { stdout } = await execAsync('ps aux --sort=-%mem | head -11');
        const lines = stdout.trim().split('\n').slice(1); // Skip header
        processes = lines.map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            user: parts[0],
            pid: parts[1],
            cpu: parseFloat(parts[2]),
            mem: parseFloat(parts[3]),
            command: parts.slice(10).join(' ').substring(0, 80)
          };
        });
      } catch (error) {
        console.error('Error getting processes:', error);
      }
      
      // Get network interfaces
      const networkInterfaces = os.networkInterfaces();
      const activeInterfaces = Object.keys(networkInterfaces).filter(name => 
        !name.startsWith('lo') && networkInterfaces[name].some(i => !i.internal)
      );
      
      // Get network connections count (simplified)
      let connectionCount = 0;
      try {
        const { stdout } = await execAsync('ss -tan | wc -l');
        connectionCount = parseInt(stdout.trim()) - 1; // Subtract header
      } catch (error) {
        console.error('Error getting connection count:', error);
      }
      
      // Check service health
      const services = {
        backend: {
          status: 'healthy',
          message: 'Backend API is running',
          uptime: Math.floor(process.uptime())
        },
        frontend: {
          status: 'unknown',
          message: 'Checking...'
        },
        database: {
          status: 'unknown',
          message: 'Checking...',
          connections: 0
        },
        redis: {
          status: 'disabled',
          message: 'Redis not configured'
        }
      };
      
      // Check frontend
      try {
        const http = await import('http');
        await new Promise((resolve, reject) => {
          const req = http.request('http://localhost:3001', { method: 'HEAD', timeout: 2000 }, (res) => {
            if (res.statusCode === 200 || res.statusCode === 307 || res.statusCode === 301) {
              services.frontend.status = 'healthy';
              services.frontend.message = 'Frontend is responding';
              resolve();
            } else {
              services.frontend.status = 'warning';
              services.frontend.message = `Unexpected status: ${res.statusCode}`;
              resolve();
            }
          });
          req.on('error', (err) => {
            services.frontend.status = 'error';
            services.frontend.message = `Cannot connect: ${err.message}`;
            resolve();
          });
          req.on('timeout', () => {
            req.destroy();
            services.frontend.status = 'error';
            services.frontend.message = 'Connection timeout';
            resolve();
          });
          req.end();
        });
      } catch (error) {
        services.frontend.status = 'error';
        services.frontend.message = `Error: ${error.message}`;
      }
      
      // Check database
      try {
        const result = await query('SELECT 1 as test');
        services.database.status = 'healthy';
        services.database.message = 'Database connected';
        
        // Try to get connection count
        try {
          const poolInfo = await query("SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()");
          services.database.connections = parseInt(poolInfo.rows[0].count);
        } catch (err) {
          // Ignore if can't get connection count
        }
      } catch (error) {
        services.database.status = 'error';
        services.database.message = `Database error: ${error.message}`;
      }
      
      // Determine overall system health
      const getResourceStatus = (percent, highThreshold = 80, criticalThreshold = 95) => {
        if (percent >= criticalThreshold) return 'critical';
        if (percent >= highThreshold) return 'warning';
        return 'healthy';
      };
      
      // Calculate uptime
      const uptimeSeconds = os.uptime();
      const uptimeDays = Math.floor(uptimeSeconds / 86400);
      const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
      const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
      const uptimeFormatted = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`;
      
      const metrics = {
        timestamp,
        cpu: {
          usage: Math.round(cpuUsage * 100) / 100,
          cores: cpuCount,
          loadAverage: loadAverage.map(l => Math.round(l * 100) / 100),
          status: getResourceStatus(cpuUsage)
        },
        memory: {
          total: totalMemory,
          used: usedMemory,
          free: freeMemory,
          percentUsed: Math.round(memoryPercentUsed * 100) / 100,
          status: getResourceStatus(memoryPercentUsed, 85, 95),
          process: {
            rss: processMemory.rss,
            heapTotal: processMemory.heapTotal,
            heapUsed: processMemory.heapUsed,
            external: processMemory.external
          }
        },
        disk: {
          ...diskInfo,
          status: getResourceStatus(diskInfo.percentUsed, 80, 90)
        },
        processes,
        services,
        network: {
          interfaces: activeInterfaces,
          connections: connectionCount
        },
        uptime: {
          seconds: Math.floor(uptimeSeconds),
          formatted: uptimeFormatted
        }
      };
      
      res.json(metrics);
    } catch (error) {
      console.error('Error fetching system metrics:', error);
      res.status(500).json({ 
        error: 'Failed to fetch system metrics',
        message: error.message 
      });
    }
  }

  static async getSystemMetricsHistory(req, res) {
    try {
      const { startDate, endDate } = req.query || {};

      const parseDate = (value, fallback) => {
        if (!value) return fallback;
        const d = new Date(String(value));
        return Number.isNaN(d.getTime()) ? fallback : d;
      };

      const now = new Date();
      const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const start = parseDate(startDate, defaultStart);
      const end = parseDate(endDate, now);

      if (start > end) {
        return res.status(400).json({ error: 'startDate must be before endDate' });
      }

      const result = await query(
        `
        SELECT
          date_trunc('hour', recorded_at) AS hour,
          AVG(cpu_percent)::float8 AS cpu,
          AVG(memory_percent)::float8 AS memory,
          AVG(disk_percent)::float8 AS disk
        FROM system_metrics_samples
        WHERE recorded_at >= $1 AND recorded_at <= $2
        GROUP BY 1
        ORDER BY 1 ASC
        `,
        [start.toISOString(), end.toISOString()]
      );

      const points = (result.rows || []).map((r) => ({
        hour: r.hour ? new Date(r.hour).toISOString() : null,
        cpu: Number(r.cpu || 0),
        memory: Number(r.memory || 0),
        disk: Number(r.disk || 0),
      }));

      return res.json({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        points,
      });
    } catch (error) {
      console.error('Error fetching system metrics history:', error);
      res.status(500).json({
        error: 'Failed to fetch system metrics history',
        message: error.message,
      });
    }
  }
}

