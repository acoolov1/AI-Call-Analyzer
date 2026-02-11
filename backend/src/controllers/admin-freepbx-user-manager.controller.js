import { body, param, validationResult } from 'express-validator';
import { FreepbxServer } from '../models/FreepbxServer.js';
import { FreepbxUserManagerService } from '../services/freepbx-user-manager.service.js';
import { logger } from '../utils/logger.js';

const handleValidation = (req) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const message = errors.array().map((e) => e.msg).join(', ');
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
};

export class AdminFreepbxUserManagerController {
  static validateCreateServer() {
    return [
      body('label').isString().isLength({ min: 2 }).withMessage('Label is required'),
      body('host').isString().isLength({ min: 3 }).withMessage('Host is required'),
      body('port').optional().isInt({ min: 1, max: 65535 }).withMessage('Port must be valid'),
      body('rootUsername').optional().isString().isLength({ min: 1 }).withMessage('Root username must be valid'),
      body('rootPassword').optional().isString().isLength({ min: 1 }).withMessage('Root password must be valid'),
      body('webUrl').optional({ values: 'falsy' }).isString().isURL({ require_protocol: true }).withMessage('Web URL must be a valid URL with protocol (http:// or https://)'),
    ];
  }

  static validateUpdateServer() {
    return [
      param('id').isUUID().withMessage('Invalid server id'),
      body('label').optional().isString().isLength({ min: 2 }),
      body('host').optional().isString().isLength({ min: 3 }),
      body('port').optional().isInt({ min: 1, max: 65535 }),
      body('rootUsername').optional().isString().isLength({ min: 1 }),
      body('rootPassword').optional().isString().isLength({ min: 1 }),
      body('webUrl').optional({ values: 'falsy' }).isString().isURL({ require_protocol: true }).withMessage('Web URL must be a valid URL with protocol (http:// or https://)'),
      body('notes').optional().isString(),
    ];
  }

  static validateUserOps() {
    return [
      param('id').isUUID().withMessage('Invalid server id'),
      body('username').isString().isLength({ min: 1 }).withMessage('Username is required'),
      body('password').optional().isString().isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
    ];
  }

  static validateBulkCreate() {
    return [
      body('pbxIds')
        .isArray({ min: 1 }).withMessage('pbxIds must be an array with at least one item')
        .custom((value) => {
          if (!Array.isArray(value)) return false;
          return value.every((id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        }).withMessage('All pbxIds must be valid UUIDs'),
      body('username').isString().isLength({ min: 1 }).withMessage('Username is required'),
      body('password').optional().isString().isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
    ];
  }

  static async listServers(req, res, next) {
    try {
      const servers = await FreepbxServer.findAll();
      res.json({ servers });
    } catch (error) {
      next(error);
    }
  }

  static async createServer(req, res, next) {
    try {
      handleValidation(req);
      const { label, host, port, rootUsername, rootPassword, webUrl, notes } = req.body;
      logger.info({ label, host, port, rootUsername, hasPassword: !!rootPassword, webUrl }, 'Creating FreePBX server');
      const server = await FreepbxServer.create({
        label,
        host,
        port,
        rootUsername,
        rootPassword,
        webUrl,
        notes,
        createdBy: req.user?.id,
      });
      logger.info({ serverId: server.id, port: server.port }, 'FreePBX server created');
      res.status(201).json({ server });
    } catch (error) {
      next(error);
    }
  }

  static async updateServer(req, res, next) {
    try {
      handleValidation(req);
      const { id } = req.params;
      const updates = {};
      const allowed = ['label', 'host', 'port', 'rootUsername', 'rootPassword', 'webUrl', 'notes'];
      allowed.forEach((key) => {
        if (req.body[key] !== undefined) {
          updates[key === 'rootUsername' ? 'root_username' : key === 'rootPassword' ? 'root_password' : key === 'webUrl' ? 'web_url' : key] = req.body[key];
        }
      });
      const server = await FreepbxServer.update(id, updates);
      res.json({ server });
    } catch (error) {
      next(error);
    }
  }

  static async deleteServer(req, res, next) {
    try {
      handleValidation(req);
      const { id } = req.params;
      await FreepbxServer.delete(id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static async testConnection(req, res, next) {
    try {
      handleValidation(req);
      const { id } = req.params;
      const server = await FreepbxServer.findWithSecret(id);
      const result = await FreepbxUserManagerService.testConnection(server);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async listUsers(req, res, next) {
    try {
      handleValidation(req);
      const { id } = req.params;
      const server = await FreepbxServer.findWithSecret(id);
      const result = await FreepbxUserManagerService.listUsers(server);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async listExtensions(req, res, next) {
    try {
      handleValidation(req);
      const { id } = req.params;
      const server = await FreepbxServer.findWithSecret(id);
      const result = await FreepbxUserManagerService.listExtensions(server);
      
      // Preserve last-known source IP(s) from cached endpoints_data
      const hasNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
      const normalizeIpList = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
        if (typeof value === 'string') return [value.trim()].filter(Boolean);
        return [];
      };
      const normalizeRegistrations = (value) => {
        if (!value) return [];
        if (!Array.isArray(value)) return [];
        return value
          .map((r) => ({
            ip: r?.ip ? String(r.ip).trim() : '',
            status: r?.status ? String(r.status).trim() : 'Unknown',
          }))
          .filter((r) => r.ip);
      };
      const prev = server?.endpointsData || {};
      const prevExtByNumber = new Map((prev.extensions || []).map((e) => [e.number, e]));
      const prevTrunkByNumber = new Map((prev.trunks || []).map((e) => [e.number, e]));
      
      const mergedExtensions = (result.extensions || []).map((ext) => {
        const prior = prevExtByNumber.get(ext.number);
        const currentRegs = normalizeRegistrations(ext.registrations);
        const priorRegs = normalizeRegistrations(prior?.registrations);
        const registrations = currentRegs.length > 0 ? currentRegs : priorRegs;

        const currentIps = normalizeIpList(ext.sourceIps || ext.sourceIp);
        const priorIps = normalizeIpList(prior?.sourceIps || prior?.sourceIp);
        const sourceIps = registrations.length > 0 ? registrations.map((r) => r.ip) : (currentIps.length > 0 ? currentIps : priorIps);
        const sourceIp = sourceIps.length > 0 ? sourceIps[0] : null;
        return { ...ext, sourceIp, sourceIps, registrations };
      });
      
      const mergedTrunks = (result.trunks || []).map((trunk) => {
        const prior = prevTrunkByNumber.get(trunk.number);
        const currentRegs = normalizeRegistrations(trunk.registrations);
        const priorRegs = normalizeRegistrations(prior?.registrations);
        const registrations = currentRegs.length > 0 ? currentRegs : priorRegs;

        const currentIps = normalizeIpList(trunk.sourceIps || trunk.sourceIp);
        const priorIps = normalizeIpList(prior?.sourceIps || prior?.sourceIp);
        const sourceIps = registrations.length > 0 ? registrations.map((r) => r.ip) : (currentIps.length > 0 ? currentIps : priorIps);
        const sourceIp = sourceIps.length > 0 ? sourceIps[0] : null;
        return { ...trunk, sourceIp, sourceIps, registrations };
      });
      
      const mergedResult = { ...result, extensions: mergedExtensions, trunks: mergedTrunks };
      
      // Save endpoints to database
      await FreepbxServer.updateEndpoints(id, {
        extensions: mergedExtensions,
        trunks: mergedTrunks
      });
      
      res.json(mergedResult);
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req, res, next) {
    try {
      handleValidation(req);
      const { id } = req.params;
      const { username, password } = req.body;
      const server = await FreepbxServer.findWithSecret(id);
      const result = await FreepbxUserManagerService.createUser(server, { username, password });
      res.json({ success: true, password: result.password });
    } catch (error) {
      next(error);
    }
  }

  static async deleteUser(req, res, next) {
    try {
      handleValidation(req);
      const { id, username } = req.params;
      if (!username) {
        const err = new Error('Username is required');
        err.status = 400;
        throw err;
      }
      const server = await FreepbxServer.findWithSecret(id);
      await FreepbxUserManagerService.deleteUser(server, { username });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static async bulkCreateUser(req, res, next) {
    try {
      logger.debug({ body: req.body }, 'Bulk create request body');
      handleValidation(req);
      const { pbxIds, username, password } = req.body;
      logger.debug({ pbxIds, username, hasPassword: !!password }, 'Bulk create params');
      const servers = await FreepbxServer.findManyWithSecret(pbxIds);
       if (!servers || servers.length === 0) {
        const err = new Error('No matching PBX servers found for provided ids.');
        err.status = 404;
        throw err;
      }
      const result = await FreepbxUserManagerService.bulkCreate(servers, { username, password });
      res.json(result);
    } catch (error) {
      logger.error({ error: error.message }, 'Bulk create user failed');
      next(error);
    }
  }

  static validateBulkDelete() {
    return [
      body('pbxIds')
        .isArray({ min: 1 }).withMessage('pbxIds must be an array with at least one item')
        .custom((value) => {
          if (!Array.isArray(value)) return false;
          return value.every((id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        }).withMessage('All pbxIds must be valid UUIDs'),
      body('username').isString().isLength({ min: 1 }).withMessage('Username is required'),
    ];
  }

  static async bulkDeleteUser(req, res, next) {
    try {
      handleValidation(req);
      const { pbxIds, username } = req.body;
      logger.debug({ pbxIds, username }, 'Bulk delete params');
      const servers = await FreepbxServer.findManyWithSecret(pbxIds);
       if (!servers || servers.length === 0) {
        const err = new Error('No matching PBX servers found for provided ids.');
        err.status = 404;
        throw err;
      }
      const result = await FreepbxUserManagerService.bulkDelete(servers, { username });
      res.json(result);
    } catch (error) {
      logger.error({ error: error.message }, 'Bulk delete user failed');
      next(error);
    }
  }

  static async updateUserPassword(req, res, next) {
    try {
      handleValidation(req);
      const { id, username } = req.params;
      const { password } = req.body;
      if (!username || !password) {
        const err = new Error('Username and password are required');
        err.status = 400;
        throw err;
      }
      const server = await FreepbxServer.findWithSecret(id);
      await FreepbxUserManagerService.updateUserPassword(server, { username, password });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static async getSystemMetrics(req, res, next) {
    try {
      handleValidation(req);
      const { id } = req.params;
      const server = await FreepbxServer.findWithSecret(id);
      const metrics = await FreepbxUserManagerService.getSystemMetrics(server);
      
      // Save metrics to database
      await FreepbxServer.updateMetrics(id, metrics);
      
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  }
}


