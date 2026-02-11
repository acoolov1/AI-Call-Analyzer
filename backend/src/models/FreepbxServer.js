import { query } from '../config/database.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
import { NotFoundError } from '../utils/errors.js';

function mapRow(row) {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    rootUsername: row.root_username,
    webUrl: row.web_url,
    notes: row.notes,
    hasPassword: Boolean(row.root_password_encrypted),
    freepbxVersion: row.freepbx_version,
    cpu: row.cpu,
    memory: row.memory,
    disk: row.disk,
    asteriskUptime: row.asterisk_uptime,
    firewallStatus: row.firewall_status,
    fail2banStatus: row.fail2ban_status,
    openPorts: row.open_ports,
    metricsUpdatedAt: row.metrics_updated_at,
    endpointsData: row.endpoints_data,
    endpointsUpdatedAt: row.endpoints_updated_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FreepbxServer {
  static async create({ label, host, port = 22, rootUsername = 'root', rootPassword, webUrl, notes, createdBy }) {
    const encrypted = rootPassword ? encryptSecret(rootPassword) : null;
    const result = await query(
      `INSERT INTO freepbx_servers (label, host, port, root_username, root_password_encrypted, web_url, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [label, host, port, rootUsername, encrypted, webUrl || null, notes || null, createdBy || null]
    );
    return mapRow(result.rows[0]);
  }

  static async update(id, updates = {}) {
    const allowed = ['label', 'host', 'port', 'root_username', 'root_password', 'web_url', 'notes'];
    const fields = [];
    const values = [];
    let idx = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (!allowed.includes(key)) return;
      if (key === 'root_password') {
        const encrypted = value ? encryptSecret(value) : null;
        fields.push(`root_password_encrypted = $${idx}`);
        values.push(encrypted);
      } else {
        const column =
          key === 'root_username' ? 'root_username' :
          key === 'web_url' ? 'web_url' :
          key;
        fields.push(`${column} = $${idx}`);
        values.push(value);
      }
      idx += 1;
    });

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);
    const sql = `
      UPDATE freepbx_servers
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${idx}
      RETURNING *`;
    const result = await query(sql, values);
    if (result.rows.length === 0) {
      throw new NotFoundError('FreePBX server');
    }
    return mapRow(result.rows[0]);
  }

  static async delete(id) {
    const result = await query('DELETE FROM freepbx_servers WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      throw new NotFoundError('FreePBX server');
    }
    return mapRow(result.rows[0]);
  }

  static async findAll() {
    const result = await query(
      'SELECT * FROM freepbx_servers ORDER BY label ASC'
    );
    return result.rows.map(mapRow);
  }

  static async findAllWithSecrets() {
    const result = await query(
      'SELECT * FROM freepbx_servers ORDER BY label ASC'
    );
    return result.rows.map(row => ({
      ...mapRow(row),
      rootPassword: row.root_password_encrypted ? decryptSecret(row.root_password_encrypted) : null,
    }));
  }

  static async findById(id) {
    const result = await query('SELECT * FROM freepbx_servers WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new NotFoundError('FreePBX server');
    }
    return mapRow(result.rows[0]);
  }

  static async findWithSecret(id) {
    const result = await query('SELECT * FROM freepbx_servers WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new NotFoundError('FreePBX server');
    }
    const row = result.rows[0];
    return {
      ...mapRow(row),
      rootPassword: row.root_password_encrypted ? decryptSecret(row.root_password_encrypted) : null,
    };
  }

  static async findManyWithSecret(ids = []) {
    if (!ids || ids.length === 0) return [];
    const result = await query(
      'SELECT * FROM freepbx_servers WHERE id = ANY($1)',
      [ids]
    );
    return result.rows.map((row) => ({
      ...mapRow(row),
      rootPassword: row.root_password_encrypted ? decryptSecret(row.root_password_encrypted) : null,
    }));
  }

  static async updateMetrics(id, metrics) {
    const openPortsJson = metrics?.openPorts ? JSON.stringify(metrics.openPorts) : null;
    const result = await query(
      `UPDATE freepbx_servers
       SET cpu = $1, memory = $2, disk = $3, asterisk_uptime = $4, 
           firewall_status = $5, fail2ban_status = $6, open_ports = $7, metrics_updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        metrics.cpu,
        metrics.memory,
        metrics.disk,
        metrics.asteriskUptime,
        metrics.firewallStatus,
        metrics.fail2banStatus,
        openPortsJson,
        id
      ]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('FreePBX server');
    }
    return mapRow(result.rows[0]);
  }

  static async updateEndpoints(id, endpoints) {
    const result = await query(
      `UPDATE freepbx_servers
       SET endpoints_data = $1, endpoints_updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(endpoints), id]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('FreePBX server');
    }
    return mapRow(result.rows[0]);
  }
}


