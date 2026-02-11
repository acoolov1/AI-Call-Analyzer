import express from 'express';
import { body, param } from 'express-validator';
import { AdminUsersController } from '../controllers/admin-users.controller.js';
import { AdminSystemController } from '../controllers/admin-system.controller.js';
import { AdminFreepbxUserManagerController } from '../controllers/admin-freepbx-user-manager.controller.js';
import { requireFreepbxAccess, requireFreepbxWrite, requireSuperAdmin } from '../middleware/admin.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// All admin routes require authentication
router.use(authenticate);

// User management routes
router.get('/users', requireSuperAdmin, AdminUsersController.listUsers);
router.get('/users/:userId', requireSuperAdmin, AdminUsersController.getUser);
router.post('/users', requireSuperAdmin, AdminUsersController.createUser);
router.patch('/users/:userId/role', requireSuperAdmin, AdminUsersController.updateUserRole);
router.patch('/users/:userId/access', requireSuperAdmin, AdminUsersController.updateUserAccess);
router.delete('/users/:userId', requireSuperAdmin, AdminUsersController.deleteUser);
router.get('/users/:userId/calls', requireSuperAdmin, AdminUsersController.getUserCalls);

// System monitoring routes
router.get('/system', requireSuperAdmin, AdminSystemController.getSystemMetrics);
router.get('/system/history', requireSuperAdmin, AdminSystemController.getSystemMetricsHistory);

// FreePBX user manager routes
router.get('/freepbx-servers', requireFreepbxAccess, AdminFreepbxUserManagerController.listServers);
router.post(
  '/freepbx-servers',
  requireFreepbxWrite,
  AdminFreepbxUserManagerController.validateCreateServer(),
  AdminFreepbxUserManagerController.createServer
);
router.patch(
  '/freepbx-servers/:id',
  requireFreepbxWrite,
  AdminFreepbxUserManagerController.validateUpdateServer(),
  AdminFreepbxUserManagerController.updateServer
);
router.delete(
  '/freepbx-servers/:id',
  requireFreepbxWrite,
  [param('id').isUUID().withMessage('Invalid server id')],
  AdminFreepbxUserManagerController.deleteServer
);
router.post(
  '/freepbx-servers/:id/test',
  requireFreepbxAccess,
  [param('id').isUUID().withMessage('Invalid server id')],
  AdminFreepbxUserManagerController.testConnection
);
router.get(
  '/freepbx-servers/:id/users',
  requireFreepbxAccess,
  [param('id').isUUID().withMessage('Invalid server id')],
  AdminFreepbxUserManagerController.listUsers
);
router.get(
  '/freepbx-servers/:id/extensions',
  requireFreepbxAccess,
  [param('id').isUUID().withMessage('Invalid server id')],
  AdminFreepbxUserManagerController.listExtensions
);
router.get(
  '/freepbx-servers/:id/metrics',
  requireFreepbxAccess,
  [param('id').isUUID().withMessage('Invalid server id')],
  AdminFreepbxUserManagerController.getSystemMetrics
);
router.post(
  '/freepbx-servers/bulk/users',
  requireFreepbxWrite,
  AdminFreepbxUserManagerController.validateBulkCreate(),
  AdminFreepbxUserManagerController.bulkCreateUser
);
router.delete(
  '/freepbx-servers/bulk/users',
  requireFreepbxWrite,
  AdminFreepbxUserManagerController.validateBulkDelete(),
  AdminFreepbxUserManagerController.bulkDeleteUser
);
router.post(
  '/freepbx-servers/:id/users',
  requireFreepbxWrite,
  AdminFreepbxUserManagerController.validateUserOps(),
  AdminFreepbxUserManagerController.createUser
);
router.delete(
  '/freepbx-servers/:id/users/:username',
  requireFreepbxWrite,
  [param('id').isUUID().withMessage('Invalid server id'), param('username').isString()],
  AdminFreepbxUserManagerController.deleteUser
);
router.patch(
  '/freepbx-servers/:id/users/:username/password',
  requireFreepbxWrite,
  [
    param('id').isUUID().withMessage('Invalid server id'),
    param('username').isString(),
    body('password').isString().isLength({ min: 12 }).withMessage('Password must be at least 12 characters')
  ],
  AdminFreepbxUserManagerController.updateUserPassword
);

export default router;

