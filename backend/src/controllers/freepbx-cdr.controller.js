import { FreePbxCdrService } from '../services/freepbx-cdr.service.js';
import { runFreePbxCdrSync, getFreePbxCdrSyncStatus } from '../jobs/freepbx-cdr-sync.job.js';
import { User } from '../models/User.js';
import { FreepbxExtensionDirectory } from '../models/FreepbxExtensionDirectory.js';
import { logger } from '../utils/logger.js';
import { Call } from '../models/Call.js';
import { CALL_SOURCE } from '../utils/constants.js';
import { ForbiddenError, BadRequestError } from '../utils/errors.js';

export class FreePbxCdrController {
  /**
   * Helper to get target user ID (supports admin access)
   */
  static getTargetUserId(req) {
    const requestedUserId = req.query.userId;
    
    if (!requestedUserId) {
      return req.user.id;
    }
    
    if (!req.user.isAdmin) {
      throw new ForbiddenError('Only admins can access other users\' settings');
    }
    
    logger.info({ adminId: req.user.id, targetUserId: requestedUserId }, 'Admin accessing FreePBX CDR settings');
    return requestedUserId;
  }

  static async testConnection(req, res, next) {
    try {
      const userId = FreePbxCdrController.getTargetUserId(req);
      const freepbxSettings = await User.getFreePbxSettingsRaw(userId);

      if (!FreePbxCdrService.isEnabled(freepbxSettings)) {
        return res.status(400).json({
          error: 'FreePBX CDR integration is not configured. Please provide MySQL credentials.',
        });
      }

      const result = await FreePbxCdrService.testConnection(freepbxSettings);
      
      logger.info({ userId, result }, 'FreePBX CDR connection test successful');
      
      res.json({
        success: true,
        message: 'Successfully connected to FreePBX CDR database',
        ...result,
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'FreePBX CDR connection test failed');
      next(error);
    }
  }

  static async syncNow(req, res, next) {
    try {
      const userId = FreePbxCdrController.getTargetUserId(req);
      
      logger.info({ userId, user: req.user?.email }, 'Manual FreePBX CDR sync triggered');
      
      // Trigger sync asynchronously
      runFreePbxCdrSync({ reason: 'manual', userId }).catch((error) => {
        logger.error({ error: error.message, userId }, 'FreePBX CDR sync failed');
      });

      res.json({
        success: true,
        message: 'FreePBX CDR sync started',
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Failed to start FreePBX CDR sync');
      next(error);
    }
  }

  static async getStatus(req, res, next) {
    try {
      const userId = FreePbxCdrController.getTargetUserId(req);
      const freepbxSettings = await User.getFreePbxSettingsRaw(userId);
      const syncStatus = getFreePbxCdrSyncStatus();

      // Get this user's specific sync history
      const userLastRuns = syncStatus.lastRuns[userId] || [];

      res.json({
        freepbxCdrSettings: {
          enabled: FreePbxCdrService.isEnabled(freepbxSettings),
          mysqlHost: freepbxSettings?.mysql_host || freepbxSettings?.host || null,
          mysqlDatabase: freepbxSettings?.mysql_database || 'asteriskcdrdb',
        },
        lastRun: userLastRuns[0] || null,
        lastRuns: userLastRuns,
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Failed to get FreePBX CDR status');
      next(error);
    }
  }

  static async getCdrCalls(req, res, next) {
    try {
      const userId = FreePbxCdrController.getTargetUserId(req);
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
      const { startDate, endDate, direction, booking, sentiment, notAnswered, search } = req.query;

      const parseDate = (value, fieldName) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestError(`Invalid ${fieldName} parameter`);
        }
        return parsed;
      };

      const range = {
        startDate: startDate ? parseDate(startDate, 'startDate') : undefined,
        endDate: endDate ? parseDate(endDate, 'endDate') : undefined,
      };

      if (range.startDate && range.endDate && range.startDate > range.endDate) {
        throw new BadRequestError('startDate must be before endDate');
      }

      const allowedDirections = new Set(['inbound', 'outbound']);
      const allowedBooking = new Set(['Booked', 'Not Booked', 'Rescheduled', 'Canceled', 'unknown']);
      const allowedSentiment = new Set(['positive', 'neutral', 'negative', 'unknown']);

      const normalizedDirection =
        direction && allowedDirections.has(String(direction).toLowerCase()) ? String(direction).toLowerCase() : undefined;
      const normalizedBooking =
        booking && allowedBooking.has(String(booking)) ? String(booking) : undefined;
      const normalizedSentiment =
        sentiment && allowedSentiment.has(String(sentiment).toLowerCase()) ? String(sentiment).toLowerCase() : undefined;
      const normalizedNotAnswered =
        String(notAnswered || '').toLowerCase() === 'true' || String(notAnswered || '') === '1';
      const normalizedSearch = String(search || '').trim() || undefined;
      if (normalizedSearch && normalizedSearch.length > 120) {
        throw new BadRequestError('Search query is too long');
      }

      if (direction && !normalizedDirection) {
        throw new BadRequestError('Invalid direction parameter');
      }
      if (booking && !normalizedBooking) {
        throw new BadRequestError('Invalid booking parameter');
      }
      if (sentiment && !normalizedSentiment) {
        throw new BadRequestError('Invalid sentiment parameter');
      }

      const freepbxSettings = await User.getFreePbxSettingsRaw(userId);
      let includeInbound = freepbxSettings?.call_history_include_inbound !== false;
      let includeOutbound = freepbxSettings?.call_history_include_outbound !== false;
      let includeInternal = freepbxSettings?.call_history_include_internal !== false;
      const excludedInboundExtensions = Array.isArray(freepbxSettings?.call_history_excluded_inbound_extensions)
        ? freepbxSettings.call_history_excluded_inbound_extensions
        : [];
      const excludedOutboundExtensions = Array.isArray(freepbxSettings?.call_history_excluded_outbound_extensions)
        ? freepbxSettings.call_history_excluded_outbound_extensions
        : [];
      const excludedInternalExtensions = Array.isArray(freepbxSettings?.call_history_excluded_internal_extensions)
        ? freepbxSettings.call_history_excluded_internal_extensions
        : [];

      // Backfill include flags if missing (older records), based on directory + excluded lists.
      const hasInboundFlag = typeof freepbxSettings?.call_history_include_inbound === 'boolean';
      const hasOutboundFlag = typeof freepbxSettings?.call_history_include_outbound === 'boolean';
      const hasInternalFlag = typeof freepbxSettings?.call_history_include_internal === 'boolean';
      if (!hasInboundFlag || !hasOutboundFlag || !hasInternalFlag) {
        try {
          const directory = await FreepbxExtensionDirectory.getByUserId(userId);
          const extNumbers = (Array.isArray(directory?.extensions) ? directory.extensions : [])
            .map((e) => String(e?.number || '').trim())
            .filter(Boolean);

          const normalize = (value) =>
            Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : [];

          const excludedInboundSet = new Set(normalize(excludedInboundExtensions));
          const excludedOutboundSet = new Set(normalize(excludedOutboundExtensions));
          const excludedInternalSet = new Set(normalize(excludedInternalExtensions));

          const inboundExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedInboundSet.has(n));
          const outboundExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedOutboundSet.has(n));
          const internalExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedInternalSet.has(n));

          includeInbound = hasInboundFlag ? freepbxSettings.call_history_include_inbound : !inboundExcludedAll;
          includeOutbound = hasOutboundFlag ? freepbxSettings.call_history_include_outbound : !outboundExcludedAll;
          includeInternal = hasInternalFlag ? freepbxSettings.call_history_include_internal : !internalExcludedAll;

          await User.mergeFreePbxSettings(userId, {
            call_history_include_inbound: includeInbound,
            call_history_include_outbound: includeOutbound,
            call_history_include_internal: includeInternal,
          });
        } catch (e) {
          // ignore; fall back to defaults
        }
      }

      // Fetch calls from database that have source = 'freepbx-cdr' with filters
      const calls = await Call.findCdrCallsByUserIdWithFilters(userId, {
        limit,
        offset: (page - 1) * limit,
        startDate: range.startDate ? range.startDate.toISOString() : undefined,
        endDate: range.endDate ? range.endDate.toISOString() : undefined,
        direction: normalizedDirection,
        includeInbound,
        includeOutbound,
        includeInternal,
        excludedInboundExtensions,
        excludedOutboundExtensions,
        excludedInternalExtensions,
        booking: normalizedBooking,
        sentiment: normalizedSentiment,
        notAnswered: normalizedNotAnswered,
        search: normalizedSearch,
      });

      // Defense-in-depth: ensure any displayed transcript/analysis is redacted even if older
      // records were stored before redaction logic existed or if a pipeline skipped it.
      const { PciRedactionService } = await import('../services/pci-redaction.service.js');
      const redactedCalls = calls.map((c) => ({
        ...c,
        transcript: PciRedactionService.sanitizeTranscriptText(c.transcript || ''),
        analysis: PciRedactionService.sanitizeTranscriptText(c.analysis || ''),
      }));

      // Get total count for pagination
      const total = await Call.countCdrCallsByUserIdWithFilters(userId, {
        startDate: range.startDate ? range.startDate.toISOString() : undefined,
        endDate: range.endDate ? range.endDate.toISOString() : undefined,
        direction: normalizedDirection,
        includeInbound,
        includeOutbound,
        includeInternal,
        excludedInboundExtensions,
        excludedOutboundExtensions,
        excludedInternalExtensions,
        booking: normalizedBooking,
        sentiment: normalizedSentiment,
        notAnswered: normalizedNotAnswered,
        search: normalizedSearch,
      });

      res.json({
        calls: redactedCalls,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Failed to get CDR calls');
      next(error);
    }
  }

  static async getCdrCallIds(req, res, next) {
    try {
      const userId = FreePbxCdrController.getTargetUserId(req);
      const { startDate, endDate, direction, booking, sentiment, notAnswered, search } = req.query;

      const parseDate = (value, fieldName) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestError(`Invalid ${fieldName} parameter`);
        }
        return parsed;
      };

      const range = {
        startDate: startDate ? parseDate(startDate, 'startDate') : undefined,
        endDate: endDate ? parseDate(endDate, 'endDate') : undefined,
      };

      if (range.startDate && range.endDate && range.startDate > range.endDate) {
        throw new BadRequestError('startDate must be before endDate');
      }

      const allowedDirections = new Set(['inbound', 'outbound']);
      const allowedBooking = new Set(['Booked', 'Not Booked', 'Rescheduled', 'Canceled', 'unknown']);
      const allowedSentiment = new Set(['positive', 'neutral', 'negative', 'unknown']);

      const normalizedDirection =
        direction && allowedDirections.has(String(direction).toLowerCase()) ? String(direction).toLowerCase() : undefined;
      const normalizedBooking =
        booking && allowedBooking.has(String(booking)) ? String(booking) : undefined;
      const normalizedSentiment =
        sentiment && allowedSentiment.has(String(sentiment).toLowerCase()) ? String(sentiment).toLowerCase() : undefined;
      const normalizedNotAnswered =
        String(notAnswered || '').toLowerCase() === 'true' || String(notAnswered || '') === '1';
      const normalizedSearch = String(search || '').trim() || undefined;
      if (normalizedSearch && normalizedSearch.length > 120) {
        throw new BadRequestError('Search query is too long');
      }

      if (direction && !normalizedDirection) {
        throw new BadRequestError('Invalid direction parameter');
      }
      if (booking && !normalizedBooking) {
        throw new BadRequestError('Invalid booking parameter');
      }
      if (sentiment && !normalizedSentiment) {
        throw new BadRequestError('Invalid sentiment parameter');
      }

      const freepbxSettings = await User.getFreePbxSettingsRaw(userId);
      let includeInbound = freepbxSettings?.call_history_include_inbound !== false;
      let includeOutbound = freepbxSettings?.call_history_include_outbound !== false;
      let includeInternal = freepbxSettings?.call_history_include_internal !== false;
      const excludedInboundExtensions = Array.isArray(freepbxSettings?.call_history_excluded_inbound_extensions)
        ? freepbxSettings.call_history_excluded_inbound_extensions
        : [];
      const excludedOutboundExtensions = Array.isArray(freepbxSettings?.call_history_excluded_outbound_extensions)
        ? freepbxSettings.call_history_excluded_outbound_extensions
        : [];
      const excludedInternalExtensions = Array.isArray(freepbxSettings?.call_history_excluded_internal_extensions)
        ? freepbxSettings.call_history_excluded_internal_extensions
        : [];

      const hasInboundFlag = typeof freepbxSettings?.call_history_include_inbound === 'boolean';
      const hasOutboundFlag = typeof freepbxSettings?.call_history_include_outbound === 'boolean';
      const hasInternalFlag = typeof freepbxSettings?.call_history_include_internal === 'boolean';
      if (!hasInboundFlag || !hasOutboundFlag || !hasInternalFlag) {
        try {
          const directory = await FreepbxExtensionDirectory.getByUserId(userId);
          const extNumbers = (Array.isArray(directory?.extensions) ? directory.extensions : [])
            .map((e) => String(e?.number || '').trim())
            .filter(Boolean);

          const normalize = (value) =>
            Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : [];

          const excludedInboundSet = new Set(normalize(excludedInboundExtensions));
          const excludedOutboundSet = new Set(normalize(excludedOutboundExtensions));
          const excludedInternalSet = new Set(normalize(excludedInternalExtensions));

          const inboundExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedInboundSet.has(n));
          const outboundExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedOutboundSet.has(n));
          const internalExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedInternalSet.has(n));

          includeInbound = hasInboundFlag ? freepbxSettings.call_history_include_inbound : !inboundExcludedAll;
          includeOutbound = hasOutboundFlag ? freepbxSettings.call_history_include_outbound : !outboundExcludedAll;
          includeInternal = hasInternalFlag ? freepbxSettings.call_history_include_internal : !internalExcludedAll;

          await User.mergeFreePbxSettings(userId, {
            call_history_include_inbound: includeInbound,
            call_history_include_outbound: includeOutbound,
            call_history_include_internal: includeInternal,
          });
        } catch (e) {
          // ignore
        }
      }

      // Fetch only IDs - filtered to match what the table shows across all pages
      const callIds = await Call.findCdrCallIdsByUserIdWithFilters(userId, {
        startDate: range.startDate ? range.startDate.toISOString() : undefined,
        endDate: range.endDate ? range.endDate.toISOString() : undefined,
        direction: normalizedDirection,
        includeInbound,
        includeOutbound,
        includeInternal,
        excludedInboundExtensions,
        excludedOutboundExtensions,
        excludedInternalExtensions,
        booking: normalizedBooking,
        sentiment: normalizedSentiment,
        notAnswered: normalizedNotAnswered,
        search: normalizedSearch,
      });

      res.json({
        callIds,
        total: callIds.length,
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Failed to get CDR call IDs');
      next(error);
    }
  }
}

