import { Client } from 'ssh2';
import { logger } from '../utils/logger.js';
import { generateStrongPassword, encryptSecret, decryptSecret } from '../utils/crypto.js';
import { getPool } from '../config/database.js';

function validateUsername(username) {
  if (!username || !/^[a-zA-Z0-9._-]{1,32}$/.test(username)) {
    throw new Error('Username must be 1-32 chars and contain only letters, numbers, dot, underscore, or dash.');
  }
}

function validatePassword(password) {
  if (!password || password.length < 12) {
    throw new Error('Password must be at least 12 characters.');
  }
}

function buildConfig(server) {
  if (!server?.host || !server?.rootUsername || !server?.rootPassword) {
    throw new Error('FreePBX server host, root username, and password are required.');
  }
  return {
    host: server.host,
    port: Number(server.port) || 22,
    username: server.rootUsername,
    password: server.rootPassword,
    readyTimeout: 15000,
  };
}

function execCommand(conn, command, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    
    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    
    conn.exec(command, { pty: false }, (err, stream) => {
      if (err) {
        clearTimeout(timeout);
        return reject(err);
      }
      stream.on('data', (data) => { stdout += data.toString(); });
      stream.stderr.on('data', (data) => { stderr += data.toString(); });
      stream.on('close', (code) => {
        clearTimeout(timeout);
        if (finished) return;
        finished = true;
        // Return both stdout and stderr combined, let caller handle it
        const output = stdout + stderr;
        resolve({ output: output.trim(), code, stderr: stderr.trim() });
      });
    });
  });
}

async function withConnection(server, handler) {
  const config = buildConfig(server);
  logger.info({ host: config.host, port: config.port, username: config.username }, 'Attempting SSH connection to FreePBX');
  const conn = new Client();
  return new Promise((resolve, reject) => {
    conn
      .on('ready', async () => {
        logger.info({ host: config.host }, 'SSH connection established');
        try {
          const result = await handler(conn);
          conn.end();
          resolve(result);
        } catch (err) {
          logger.error({ error: err.message, host: config.host }, 'SSH command execution failed');
          conn.end();
          reject(err);
        }
      })
      .on('error', (err) => {
        logger.error({ error: err.message, host: config.host, port: config.port }, 'SSH connection error');
        reject(err);
      })
      .connect(config);
  });
}

export class FreepbxUserManagerService {
  static async testConnection(server) {
    try {
      const result = await withConnection(server, async (conn) => {
        // Test connection
        await execCommand(conn, 'echo ok', 5000);
        
        // Get FreePBX version
        try {
          const versionResult = await execCommand(
            conn, 
            "fwconsole -V 2>/dev/null | awk '{print $NF}' || echo 'Unknown'", 
            8000
          );
          return { 
            ok: true, 
            version: versionResult.output.trim() || 'Unknown'
          };
        } catch (versionError) {
          logger.warn({ error: versionError.message, host: server.host }, 'Could not get FreePBX version');
          return { ok: true, version: 'Unknown' };
        }
      });
      
      // Save version to database
      if (result.version) {
        const pool = getPool();
        await pool.query(
          'UPDATE freepbx_servers SET freepbx_version = $1 WHERE id = $2',
          [result.version, server.id]
        );
      }
      
      return result;
    } catch (error) {
      logger.error({ error: error.message, host: server.host }, 'FreePBX SSH test failed');
      throw new Error(`SSH test failed: ${error.message}`);
    }
  }

  static async listUsers(server) {
    // List users from FreePBX server, then fetch passwords from our database
    try {
      const result = await withConnection(server, async (conn) => {
        const cmd = `getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 && $1 != "nobody" { print $1 }' | sort`;
        return execCommand(conn, cmd, 5000);
      });
      
      // Common system users to filter out
      const systemUsers = ['centos', 'rocky', 'ubuntu', 'debian', 'asterisk', 'mysql'];
      
      const usernames = result.output ? result.output.split('\n').filter(line => {
        const trimmed = line.trim().toLowerCase();
        return trimmed && 
               /^[a-zA-Z0-9._-]+$/.test(trimmed) && 
               !systemUsers.includes(trimmed);
      }) : [];
      
      // Fetch stored passwords for these users
      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT username, password_encrypted FROM freepbx_user_credentials WHERE server_id = $1',
        [server.id]
      );
      
      const passwordMap = {};
      rows.forEach(row => {
        try {
          passwordMap[row.username] = decryptSecret(row.password_encrypted);
        } catch (err) {
          logger.error({ error: err.message, username: row.username }, 'Failed to decrypt password');
        }
      });
      
      const users = usernames.map(username => ({
        username,
        password: passwordMap[username] || null
      }));
      
      // Add root user with password from server config
      if (server.rootPassword) {
        users.unshift({
          username: server.rootUsername || 'root',
          password: server.rootPassword,
          isRoot: true
        });
      }
      
      logger.info({ host: server.host, userCount: users.length }, 'Listed users with passwords');
      return { users };
      
    } catch (error) {
      logger.error({ error: error.message, host: server.host }, 'Failed to list users');
      return { users: [] };
    }
  }

  static async listExtensions(server) {
    logger.info({ host: server.host }, 'Starting extension list for FreePBX');
    try {
      const result = await withConnection(server, async (conn) => {
        // Step 1: Get extensions from devices table (numeric only)
        const devicesCmd = `mysql asterisk -sN -e "SELECT id, description FROM devices WHERE tech = 'pjsip' AND id REGEXP '^[0-9]+\$' ORDER BY CAST(id AS UNSIGNED)" 2>&1`;
        logger.debug({ command: devicesCmd }, 'Getting devices list');
        const devicesResult = await execCommand(conn, devicesCmd, 10000);
        logger.debug({ output: devicesResult.output }, 'Devices result');
        
        // Step 2: Get PJSIP endpoint status from Asterisk CLI (includes both extensions and trunks)
        const statusCmd = `asterisk -rx "pjsip show endpoints" 2>&1`;
        logger.debug({ command: statusCmd }, 'Getting PJSIP status');
        const statusResult = await execCommand(conn, statusCmd, 10000);
        logger.debug({ output: statusResult.output }, 'Status result (full output)');

        // Step 3: Get registrar contacts (full, non-truncated URI incl. public IP)
        // Example line:
        // /registrar/contact/200;@hash: {"endpoint":"200","uri":"sip:...@35.237.51.81:47159;...","via_addr":"10.10.82.179",...}
        const registrarCmd = `asterisk -rx "database show registrar" 2>&1`;
        logger.debug({ command: registrarCmd }, 'Getting registrar contacts');
        const registrarResult = await execCommand(conn, registrarCmd, 10000);
        logger.debug({ output: registrarResult.output }, 'Registrar result (full output)');
        
        return { 
          devices: devicesResult.output,
          status: statusResult.output,
          registrar: registrarResult.output
        };
      });
      
      logger.debug({ rawResult: result }, 'Raw result from queries');
      
      const extensions = [];
      const trunks = [];
      const statusMap = {};
      // endpoint -> Array<{ ip: string, status: 'Avail'|'Unavail'|'Unknown' }>
      const registrationsMap = {};
      // endpoint -> Array<{ hash: string, ip: string }>
      const registrarContactsByEndpoint = {};
      // endpoint -> Array<{ hashPrefix?: string|null, status?: 'Avail'|'Unavail'|'Unknown', fallbackIp?: string|null }>
      const contactEntriesByEndpoint = {};
      const knownExtensions = new Set();
      
      const stripPort = (host) => {
        const value = String(host || '').trim();
        if (!value) return null;
        // Common cases:
        // - IPv4: "1.2.3.4:5060" -> "1.2.3.4"
        // - Hostname: "gw.example.com:5060" -> "gw.example.com"
        // - IPv6: keep as-is (port parsing is ambiguous without brackets)
        if (value.startsWith('[') && value.includes(']')) {
          // "[2001:db8::1]:5060" -> "2001:db8::1"
          return value.replace(/^\[/, '').replace(/\].*$/, '');
        }
        if (value.includes(':') && (value.match(/\./g) || []).length >= 1) {
          return value.split(':')[0];
        }
        return value;
      };
      
      const extractContactHost = (line) => {
        // Example: "Contact:  200/sip:200@192.168.1.10:5060;...  Avail"
        const m = String(line).match(/@([^\s;>]+)/);
        return m ? stripPort(m[1]) : null;
      };
      
      const extractViaAddress = (line) => {
        // Example: "Via Address: 203.0.113.10:5060"
        const m = String(line).match(/Via Address:\s*([^\s]+)/i);
        return m ? stripPort(m[1]) : null;
      };

      const extractUriHost = (uri) => {
        // Example: "sip:200-abc@35.237.51.81:47159;transport=TCP;..." -> "35.237.51.81"
        const m = String(uri || '').match(/@([^;>\s]+)/);
        return m ? stripPort(m[1]) : null;
      };

      const applyRegistrarIps = (registrarOutput) => {
        if (!registrarOutput || registrarOutput.includes('No entry')) return;
        String(registrarOutput)
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('/registrar/contact/'))
          .forEach((line) => {
            // Example:
            // /registrar/contact/200;@e029e...: {"endpoint":"200","uri":"sip:...@35.237.51.81:47159;..."}
            const idx = line.indexOf(':');
            if (idx < 0) return;
            const keyPart = line.slice(0, idx).trim();
            const jsonPart = line.slice(idx + 1).trim();
            try {
              const obj = JSON.parse(jsonPart);
              // Prefer endpoint from key (more reliable)
              const keyMatch = keyPart.match(/^\/registrar\/contact\/([^;]+);@([^:]+)$/);
              const endpointFromKey = keyMatch?.[1] ? String(keyMatch[1]) : null;
              const hashFromKey = keyMatch?.[2] ? String(keyMatch[2]) : null;
              const endpoint = endpointFromKey || (obj?.endpoint ? String(obj.endpoint) : null);
              const sourceIp = extractUriHost(obj?.uri);
              if (endpoint && hashFromKey && sourceIp) {
                if (!registrarContactsByEndpoint[endpoint]) registrarContactsByEndpoint[endpoint] = [];
                registrarContactsByEndpoint[endpoint].push({ hash: hashFromKey, ip: sourceIp });
              }
            } catch (e) {
              // Ignore malformed lines
            }
          });
      };
      
      const normalizeContactStatus = (raw) => {
        const v = String(raw || '').trim();
        if (!v) return 'Unknown';
        if (v === 'Avail' || v === 'Available') return 'Avail';
        if (v === 'Unavail' || v === 'Unavailable') return 'Unavail';
        return 'Unknown';
      };
      
      const bestOf = (a, b) => {
        // Avail wins, then Unavail, then Unknown
        const rank = (s) => (s === 'Avail' ? 2 : s === 'Unavail' ? 1 : 0);
        return rank(b) > rank(a) ? b : a;
      };
      
      const findRegistrarIp = (endpoint, hashPrefix) => {
        if (!endpoint || !hashPrefix) return null;
        const list = registrarContactsByEndpoint[endpoint] || [];
        const match = list.find((c) => c.hash.startsWith(hashPrefix) || hashPrefix.startsWith(c.hash));
        return match?.ip || null;
      };
      
      // Parse status output (pjsip show endpoints detailed format)
      if (result.status && !result.status.includes('ERROR') && result.status.trim()) {
        let currentEndpoint = null;
        
        result.status.split('\n').forEach(line => {
          const trimmed = line.trim();
          
          // Check for Endpoint line: " Endpoint:  200/200  ..."
          if (trimmed.startsWith('Endpoint:')) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
              const endpointPart = parts[1].split('/')[0]; // Extract "200" from "200/200" or "FlowrouteConnex"
              // Skip header artifacts like "<Endpoint/CID...>"
              if (endpointPart.startsWith('<')) {
                currentEndpoint = null;
                return;
              }
              currentEndpoint = endpointPart;
              // Initialize as offline, will be changed to online if we find an active Contact
              statusMap[currentEndpoint] = 'offline';
              contactEntriesByEndpoint[currentEndpoint] = contactEntriesByEndpoint[currentEndpoint] || [];
              logger.debug({ endpoint: currentEndpoint, line: trimmed }, 'Found endpoint');
            }
          }
          
          // Check for Contact line and parse per-contact status
          if (trimmed.startsWith('Contact:') && currentEndpoint) {
            const parts = trimmed.split(/\s+/);
            const fallbackIp = extractContactHost(trimmed);
            const idx = parts.findIndex((p) => p === 'Avail' || p === 'Available' || p === 'Unavail' || p === 'Unavailable');
            const status = idx >= 0 ? normalizeContactStatus(parts[idx]) : 'Unknown';
            const hashPrefix = idx > 0 ? parts[idx - 1] : null;
            contactEntriesByEndpoint[currentEndpoint].push({ hashPrefix, status, fallbackIp });

            if (status === 'Avail') {
              statusMap[currentEndpoint] = 'online';
              logger.debug({ endpoint: currentEndpoint, line: trimmed }, 'Found active contact - marking online');
            }
          }
          
          // Prefer "Via Address" if present (often the public/NAT address)
          if (currentEndpoint && trimmed.toLowerCase().includes('via address:')) {
            const viaIp = extractViaAddress(trimmed);
            if (viaIp) {
              // Treat as a fallback "Unknown" source unless overridden by registrar/contact-status join
              contactEntriesByEndpoint[currentEndpoint] = contactEntriesByEndpoint[currentEndpoint] || [];
              contactEntriesByEndpoint[currentEndpoint].push({ hashPrefix: null, status: 'Unknown', fallbackIp: viaIp });
            }
          }
        });
        
        logger.debug(
          {
            statusMap,
            contactEntriesByEndpoint,
          },
          'Final status map'
        );
      }

      // Prefer full registrar URIs for Source IP (avoids CLI column truncation)
      if (result.registrar && !result.registrar.includes('ERROR') && result.registrar.trim()) {
        applyRegistrarIps(result.registrar);
        logger.debug(
          { registrarContactsByEndpoint },
          'Applied registrar contacts'
        );
      }
      
      // Build per-endpoint registrations: join contact status (pjsip show endpoints) with registrar IPs by hash prefix.
      for (const [endpoint, entries] of Object.entries(contactEntriesByEndpoint)) {
        const ipToStatus = new Map();
        for (const entry of entries || []) {
          const ip = findRegistrarIp(endpoint, entry.hashPrefix) || entry.fallbackIp || null;
          if (!ip) continue;
          const prev = ipToStatus.get(ip) || 'Unknown';
          ipToStatus.set(ip, bestOf(prev, entry.status || 'Unknown'));
        }
        
        // Also include any registrar entries we didn't see in contact lines (status unknown)
        for (const rc of registrarContactsByEndpoint[endpoint] || []) {
          if (!ipToStatus.has(rc.ip)) {
            ipToStatus.set(rc.ip, 'Unknown');
          }
        }
        
        const registrations = Array.from(ipToStatus.entries())
          .map(([ip, status]) => ({ ip, status }))
          .sort((a, b) => {
            // Avail first, then Unavail, then Unknown; stable-ish by IP
            const rank = (s) => (s === 'Avail' ? 2 : s === 'Unavail' ? 1 : 0);
            const r = rank(b.status) - rank(a.status);
            return r !== 0 ? r : a.ip.localeCompare(b.ip);
          });
        
        registrationsMap[endpoint] = registrations;
      }
      
      // Parse devices table output (extensions)
      if (result.devices && !result.devices.includes('ERROR') && result.devices.trim()) {
        result.devices.split('\n').forEach(line => {
          const parts = line.trim().split('\t');
          if (parts.length >= 1 && parts[0]) {
            const number = parts[0];
            const name = parts.length >= 2 ? (parts[1] || null) : null;
            const status = statusMap[number] || 'offline';
            const registrations = registrationsMap[number] || [];
            const sourceIps = registrations.map((r) => r.ip);
            const sourceIp = sourceIps.length > 0 ? sourceIps[0] : null;
            extensions.push({ number, name, status, sourceIp, sourceIps, registrations });
            knownExtensions.add(number);
            logger.debug({ number, name, status, registrations, source: 'devices' }, 'Parsed extension');
          }
        });
      }
      
      // Extract trunks from statusMap (anything that's not a numeric extension)
      for (const [endpointId, status] of Object.entries(statusMap)) {
        // Skip if it's a numeric extension or already added
        if (/^\d+$/.test(endpointId) || knownExtensions.has(endpointId)) {
          continue;
        }
        // Skip header artifacts
        if (endpointId.startsWith('<') || endpointId.length < 2) {
          continue;
        }
        
        trunks.push({
          number: endpointId,
          name: null, // Trunk names aren't easily available from CLI
          status,
          registrations: registrationsMap[endpointId] || [],
          sourceIps: (registrationsMap[endpointId] || []).map((r) => r.ip),
          sourceIp: (registrationsMap[endpointId] || [])[0]?.ip || null,
        });
        logger.debug({ number: endpointId, status, source: 'cli-trunks' }, 'Parsed trunk from CLI');
      }
      
      logger.info({ host: server.host, extensionCount: extensions.length, trunkCount: trunks.length, trunks }, 'Listed extensions and trunks');
      return { extensions, trunks };
      
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack, host: server.host }, 'Failed to list extensions');
      return { extensions: [], trunks: [] };
    }
  }

  static async getSystemMetrics(server) {
    logger.info({ host: server.host }, 'Fetching system metrics for FreePBX');
    try {
      const parseOpenPortsFromIptables = (iptablesRules) => {
        // FreePBX Firewall module organizes exposure via zones (e.g. zone-external).
        // To avoid "noise", only report ports reachable from the zone-external chain
        // (services allowed for the external/WAN zone), which is the closest representation
        // of "open to the internet" in FreePBX terms.
        const lines = String(iptablesRules || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const rulesByChain = new Map(); // chain -> string[]
        const chainNames = new Set();
        
        for (const line of lines) {
          if (line.startsWith('-N ')) {
            const name = line.slice(3).trim();
            if (name) chainNames.add(name);
          }
          if (line.startsWith('-A ')) {
            const parts = line.split(/\s+/);
            const chain = parts[1];
            if (!rulesByChain.has(chain)) rulesByChain.set(chain, []);
            rulesByChain.get(chain).push(line);
          }
        }
        
        const addPort = (set, port, proto) => {
          if (!port || !proto) return;
          set.add(`${port}/${proto}`);
        };
        
        const extractPortsFromRule = (rule) => {
          const protoMatch = rule.match(/\s-p\s+(tcp|udp)\b/i);
          const proto = protoMatch ? protoMatch[1].toLowerCase() : null;
          if (!proto) return [];
          
          const found = [];
          const dportMatch = rule.match(/\s--dport\s+(\d+)(?::(\d+))?\b/);
          if (dportMatch) {
            const start = dportMatch[1];
            const end = dportMatch[2];
            found.push({ port: end ? `${start}-${end}` : start, proto });
            return found;
          }
          const dportsMatch = rule.match(/\s--dports\s+([0-9,]+)\b/);
          if (dportsMatch) {
            for (const p of dportsMatch[1].split(',').map((x) => x.trim()).filter(Boolean)) {
              found.push({ port: p, proto });
            }
          }
          return found;
        };
        
        const getJumpTarget = (rule) => {
          const m = rule.match(/\s-j\s+([A-Za-z0-9_.-]+)\b/);
          return m ? m[1] : null;
        };
        
        // If the PBX isn't using FreePBX firewall zones, don't guess.
        if (!chainNames.has('zone-external') && !rulesByChain.has('zone-external')) {
          return [];
        }
        
        // Traverse chains reachable from zone-external.
        const visited = new Set();
        const stack = ['zone-external'];
        const results = new Set();
        
        while (stack.length) {
          const chain = stack.pop();
          if (!chain || visited.has(chain)) continue;
          visited.add(chain);
          const rules = rulesByChain.get(chain) || [];
          for (const rule of rules) {
            const target = getJumpTarget(rule);
            if (!target) continue;
            
            // Collect ports from ACCEPT rules directly in reachable chains.
            if (target === 'ACCEPT') {
              for (const { port, proto } of extractPortsFromRule(rule)) {
                addPort(results, port, proto);
              }
              continue;
            }
            
            // Recurse into other FreePBX-managed chains (service chains, ratelimit, etc.)
            if (chainNames.has(target) || rulesByChain.has(target)) {
              stack.push(target);
            }
          }
        }
        
        const arr = Array.from(results);
        arr.sort((a, b) => {
          const [pa, proA] = a.split('/');
          const [pb, proB] = b.split('/');
          if (proA !== proB) return proA.localeCompare(proB);
          const na = parseInt(pa.split('-')[0], 10);
          const nb = parseInt(pb.split('-')[0], 10);
          if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
          return a.localeCompare(b);
        });
        return arr;
      };
      
      const result = await withConnection(server, async (conn) => {
        // Memory: Format as "used/total (percent%)"
        const memCmd = `free -m | grep Mem | awk '{printf "%.1f/%.1fGB (%.0f%%)", $3/1024, $2/1024, $3/$2*100}' 2>&1`;
        const memResult = await execCommand(conn, memCmd, 5000);
        
        // Disk: Format as "used/total (percent)"
        const diskCmd = `df -h / | tail -1 | awk '{printf "%s/%s (%s)", $3, $2, $5}' 2>&1`;
        const diskResult = await execCommand(conn, diskCmd, 5000);
        
        // Asterisk uptime
        const asteriskUptimeCmd = `asterisk -rx "core show uptime" 2>&1 | grep "System uptime:" | sed 's/System uptime: //' 2>&1`;
        const asteriskUptimeResult = await execCommand(conn, asteriskUptimeCmd, 5000);
        
        // Firewall rules (iptables) + derived "open ports"
        const iptablesCmd = `iptables -S 2>/dev/null || true`;
        const iptablesResult = await execCommand(conn, iptablesCmd, 5000);
        
        // Fail2ban status
        const fail2banCmd = `if systemctl is-active fail2ban >/dev/null 2>&1; then echo "active"; else echo "inactive"; fi`;
        const fail2banResult = await execCommand(conn, fail2banCmd, 5000);
        
        // CPU: Run LAST after other commands have completed, so it measures settled CPU
        const cpuCmd = `top -bn1 | grep "Cpu(s)" | sed 's/.*, *\\([0-9.]*\\) *id.*/\\1/' | awk '{printf "%.1f", 100 - $1}' 2>&1`;
        const cpuResult = await execCommand(conn, cpuCmd, 5000);
        
        return {
          cpu: cpuResult.output.trim(),
          memory: memResult.output.trim(),
          disk: diskResult.output.trim(),
          asteriskUptime: asteriskUptimeResult.output.trim(),
          iptables: iptablesResult.output || '',
          fail2ban: fail2banResult.output.trim()
        };
      });
      
      // Format the results
      const openPorts = parseOpenPortsFromIptables(result.iptables);
      const firewallStatus = (String(result.iptables || '').trim().length > 30 ? 'active' : 'inactive');
      const metrics = {
        cpu: result.cpu ? `${result.cpu}%` : 'N/A',
        memory: result.memory || 'N/A',
        disk: result.disk || 'N/A',
        asteriskUptime: result.asteriskUptime || null,
        firewallStatus,
        fail2banStatus: (result.fail2ban === 'active' ? 'active' : 'inactive'),
        openPorts
      };
      
      logger.info({ host: server.host, metrics }, 'Fetched system metrics');
      return metrics;
      
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack, host: server.host }, 'Failed to fetch system metrics');
      throw new Error(`Failed to fetch system metrics: ${error.message}`);
    }
  }

  static async createUser(server, { username, password }) {
    validateUsername(username);
    const effectivePassword = password || generateStrongPassword(24);
    validatePassword(effectivePassword);

    logger.info({ host: server.host, username }, 'Creating FreePBX GUI administrator + SSH user');

    // Create BOTH FreePBX GUI admin AND Linux system user for SSH
    const escapedPassword = effectivePassword.replace(/'/g, "'\\''");
    const escapedUsername = username.replace(/'/g, "'\\''");
    
    try {
      await withConnection(server, async (conn) => {
        // 1. Create Linux system user
        await execCommand(conn, `id -u ${username} >/dev/null 2>&1 || useradd -m -s /bin/bash ${username}`);
        
        // 2. Set password
        await execCommand(conn, `printf '%s:%s' "${username}" "${effectivePassword}" | chpasswd`);
        
        // 3. Add to sudo groups
        await execCommand(conn, `getent group wheel >/dev/null && usermod -aG wheel ${username} || true`);
        await execCommand(conn, `getent group sudo >/dev/null && usermod -aG sudo ${username} || true`);
        
        // 4 & 5. Create FreePBX GUI admin - remove "deleted" column check
        await execCommand(conn, `mysql asterisk -e "DELETE FROM ampusers WHERE username='${escapedUsername}'" 2>/dev/null || true`);
        const result = await execCommand(conn, `mysql asterisk -e "INSERT INTO ampusers (username, password_sha1, extension_low, extension_high, deptname, sections) VALUES ('${escapedUsername}', SHA1('${escapedPassword}'), '', '', 'default', '*')" 2>&1 || echo "MySQL insert may have failed"`);
        
        logger.debug({ insertResult: result.output }, 'MySQL insert result');
      });
      
      // Store the password in our database
      const pool = getPool();
      const encryptedPassword = encryptSecret(effectivePassword);
      await pool.query(
        `INSERT INTO freepbx_user_credentials (server_id, username, password_encrypted, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (server_id, username)
         DO UPDATE SET password_encrypted = $3, updated_at = NOW()`,
        [server.id, username, encryptedPassword]
      );
      
      logger.info({ host: server.host, username }, 'User created successfully (SSH + FreePBX GUI + stored credentials)');
      return { success: true, password: effectivePassword };
    } catch (error) {
      logger.error({ error: error.message, host: server.host, username }, 'Failed to create user');
      throw new Error(`Create user failed: ${error.message}`);
    }
  }

  static async deleteUser(server, { username }) {
    validateUsername(username);
    
    // Prevent deleting root user
    if (username === 'root' || username === server.rootUsername) {
      throw new Error('Cannot delete root user');
    }
    
    const escapedUsername = username.replace(/'/g, "'\\''");
    try {
      await withConnection(server, async (conn) => {
        await execCommand(conn, `mysql asterisk -e "DELETE FROM ampusers WHERE username='${escapedUsername}'" 2>/dev/null || true`);
        await execCommand(conn, `id -u ${username} >/dev/null 2>&1 && userdel -r ${username} || true`);
      });
      
      // Delete stored credentials
      const pool = getPool();
      await pool.query(
        'DELETE FROM freepbx_user_credentials WHERE server_id = $1 AND username = $2',
        [server.id, username]
      );
      
      logger.info({ host: server.host, username }, 'User deleted successfully (SSH + FreePBX GUI + stored credentials)');
      return { success: true };
    } catch (error) {
      logger.error({ error: error.message, host: server.host, username }, 'Failed to delete user');
      throw new Error(`Delete user failed: ${error.message}`);
    }
  }

  static async bulkCreate(serverList, { username, password }) {
    const results = [];
    const effectivePassword = password || generateStrongPassword(24);
    validateUsername(username);
    validatePassword(effectivePassword);

    for (const server of serverList) {
      try {
        await this.createUser(server, { username, password: effectivePassword });
        results.push({ serverId: server.id, status: 'success', message: 'User created', password: effectivePassword });
      } catch (error) {
        results.push({ serverId: server.id, status: 'error', message: error.message });
      }
    }
    return { results, password: effectivePassword };
  }

  static async bulkDelete(serverList, { username }) {
    const results = [];
    validateUsername(username);

    for (const server of serverList) {
      try {
        await this.deleteUser(server, { username });
        results.push({ serverId: server.id, status: 'success', message: 'User deleted' });
      } catch (error) {
        results.push({ serverId: server.id, status: 'error', message: error.message });
      }
    }
    return { results };
  }

  static async updateUserPassword(server, { username, password }) {
    validateUsername(username);
    validatePassword(password);

    logger.info({ host: server.host, username }, 'Updating user password');

    const escapedPassword = password.replace(/'/g, "'\\''");
    const escapedUsername = username.replace(/'/g, "'\\''");
    
    try {
      await withConnection(server, async (conn) => {
        // Update Linux user password
        await execCommand(conn, `printf '%s:%s' "${username}" "${password}" | chpasswd`);
        
        // Update FreePBX GUI password
        await execCommand(conn, `mysql asterisk -e "UPDATE ampusers SET password_sha1 = SHA1('${escapedPassword}') WHERE username='${escapedUsername}'" 2>&1 || echo "MySQL update may have failed"`);
      });
      
      // Update stored password in our database
      const pool = getPool();
      const encryptedPassword = encryptSecret(password);
      await pool.query(
        `UPDATE freepbx_user_credentials 
         SET password_encrypted = $1, updated_at = NOW()
         WHERE server_id = $2 AND username = $3`,
        [encryptedPassword, server.id, username]
      );
      
      logger.info({ host: server.host, username }, 'User password updated successfully');
      return { success: true };
    } catch (error) {
      logger.error({ error: error.message, host: server.host, username }, 'Failed to update user password');
      throw new Error(`Update password failed: ${error.message}`);
    }
  }
}


