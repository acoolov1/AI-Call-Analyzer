import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Detects PCI-like sequences in transcripts and optionally redacts audio via FFmpeg.
 * This uses lightweight heuristics (regex + keyword proximity) to avoid GPT cost.
 * Padding is applied around detected word ranges to absorb Whisper timestamp drift.
 */
export class PciRedactionService {
  static DEFAULT_PADDING = 0.5; // seconds before/after

  /**
   * Detect PCI spans from words with timestamps.
   * @param {string} transcriptText
   * @param {Array<{word: string, start: number, end: number}>} words
   * @param {number} paddingSeconds
   * @returns {{spans: Array<{start:number,end:number,reason:string,wordIndices:number[]}>}}
   */
  static detectSensitiveSpans(transcriptText, words = [], paddingSeconds = PciRedactionService.DEFAULT_PADDING) {
    if (!words || words.length === 0) {
      return { spans: [] };
    }

    const spans = [];
    const normalizeToken = (value) => String(value || '').replace(/[^\da-z]/gi, '').toLowerCase();
    const lowerToken = (value) => String(value || '').toLowerCase();

    const normalizedWords = words.map((w) => ({
      ...w,
      raw: String(w.word || ''),
      lowerRaw: lowerToken(w.word),
      normalized: normalizeToken(w.word),
    }));

    // Keywords that indicate payment info is about to be shared
    const cardKeywords = ['credit', 'card', 'visa', 'mastercard', 'amex', 'discover', 'debit', 'payment', 'number'];
    const cvvKeywords = ['cvv', 'cvc', 'security', 'code', 'verification'];
    const expiryKeywords = ['expir', 'expiration', 'expire', 'valid', 'exp'];
    // DOB keywords (keep as simple as card logic: keyword + digits nearby)
    const dobKeywords = ['dob', 'birthday', 'birthdate', 'dateofbirth'];

    const containsDigits = (token) => /\d/.test(token);
    const looksLikeEmail = (token) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(String(token || ''));
    const cleanAlphaNum = (token) => String(token || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

    const addSpanByIndices = (firstWordIdx, lastWordIdx, reason, customPaddingSeconds) => {
      const first = normalizedWords[firstWordIdx];
      const last = normalizedWords[lastWordIdx];
      const pad = Number.isFinite(customPaddingSeconds) ? customPaddingSeconds : paddingSeconds;
      spans.push({
        start: Math.max(0, (first.start ?? first.start_ms ?? 0) - pad),
        end: (last.end ?? last.end_ms ?? last.start ?? 0) + pad,
        reason,
        wordIndices: Array.from({ length: lastWordIdx - firstWordIdx + 1 }, (_, idx) => firstWordIdx + idx),
      });
    };

    // Look for card keywords followed by numbers within next 15 words
    for (let i = 0; i < normalizedWords.length; i++) {
      const word = normalizedWords[i];
      
      // Check if this word is a card-related keyword
      const isCardKeyword = cardKeywords.some((kw) => word.normalized.includes(kw));
      const isCvvKeyword = cvvKeywords.some((kw) => word.normalized.includes(kw));
      const isExpiryKeyword = expiryKeywords.some((kw) => word.normalized.includes(kw));
      const isDobKeyword =
        dobKeywords.some((kw) => word.normalized.includes(kw)) ||
        // phrase "date of birth" split into 3 tokens
        (word.normalized === 'date' &&
          normalizedWords[i + 1]?.normalized === 'of' &&
          normalizedWords[i + 2]?.normalized === 'birth') ||
        // phrase "birth date" split
        (word.normalized === 'birth' && normalizedWords[i + 1]?.normalized === 'date');

      if (isCardKeyword || isCvvKeyword || isExpiryKeyword || isDobKeyword) {
        // Look ahead for numbers in the next 15 words
        const lookAheadWindow = 15;
        const nextWords = normalizedWords.slice(i, i + lookAheadWindow);
        
        // Find all words with digits
        const digitWordIndices = [];
        for (let j = 0; j < nextWords.length; j++) {
          if (containsDigits(nextWords[j].normalized)) {
            digitWordIndices.push(i + j);
          }
        }

        // If we found digits after the keyword, redact from keyword to last digit word
        if (digitWordIndices.length > 0) {
          const lastWordIdx = Math.max(...digitWordIndices);
          const reason = isDobKeyword ? 'dob' : isCvvKeyword ? 'cvv' : isExpiryKeyword ? 'expiry' : 'card_number';

          // DOB audio muting: be less aggressive.
          // Only mute the digit-bearing tokens (the actual DOB value) and use tighter padding,
          // because Whisper word timestamps near the end of a call can drift and swallow trailing words.
          if (isDobKeyword) {
            const firstDigitIdx = Math.min(...digitWordIndices);
            addSpanByIndices(firstDigitIdx, lastWordIdx, reason, Math.min(paddingSeconds, 0.15));
          } else {
            const firstWordIdx = i;
            addSpanByIndices(firstWordIdx, lastWordIdx, reason);
          }
        }
      }
    }

    // Also catch standalone sequences of multiple digits (fallback for numbers without context)
    const windowSize = 10;
    for (let i = 0; i < normalizedWords.length; i++) {
      const windowWords = normalizedWords.slice(i, i + windowSize);
      const combined = windowWords.map((w) => w.normalized).join('');
      const digitsOnly = combined.replace(/\D/g, '');
      
      // If we find 12+ consecutive digits (full card number), redact it even without keyword
      if (digitsOnly.length >= 12 && digitsOnly.length <= 19) {
        addSpanByIndices(i, Math.min(i + windowWords.length - 1, normalizedWords.length - 1), 'card_number_sequence');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Additional PII redaction (passwords/PINs, addresses, emails, SSNs)
    // DOB is handled above in the same "keyword + digits nearby" loop (mirrors card logic).
    // ─────────────────────────────────────────────────────────────────────────────
    const passwordKeywords = ['password', 'passcode', 'pin', 'pincode'];
    const addressKeywords = ['address', 'streetaddress'];
    const streetSuffixes = [
      'st', 'street', 'rd', 'road', 'ave', 'avenue', 'blvd', 'boulevard', 'dr', 'drive',
      'ln', 'lane', 'ct', 'court', 'way', 'circle', 'cir', 'pkwy', 'parkway', 'trail', 'trl',
    ];

    // SSNs
    // We keep this conservative to avoid redacting random shorter digit sequences:
    // - explicit "ssn"/"social security" keyword + nearby digits
    // - formatted SSN tokens like 123-45-6789 (or with spaces)
    const ssnKeywords = ['ssn'];
    const isFormattedSsnToken = (raw) => /^\d{3}[-\s]?\d{2}[-\s]?\d{4}$/.test(String(raw || '').trim());

    // SSNs (formatted token: 123-45-6789)
    for (let i = 0; i < normalizedWords.length; i++) {
      if (isFormattedSsnToken(normalizedWords[i].raw)) {
        addSpanByIndices(i, i, 'ssn');
      }
    }

    // SSNs (keyword-driven: "ssn ..." or "social security ...")
    for (let i = 0; i < normalizedWords.length; i++) {
      const w = normalizedWords[i];
      const isSsnKeyword = ssnKeywords.some((kw) => w.normalized.includes(kw));
      const isSocialSecurityPhrase =
        w.normalized === 'social' &&
        (normalizedWords[i + 1]?.normalized === 'security' || normalizedWords[i + 1]?.normalized?.includes('security'));

      if (isSsnKeyword || isSocialSecurityPhrase) {
        const lookAheadWindow = 20;
        let lastIdx = -1;
        for (let j = i; j <= Math.min(i + lookAheadWindow, normalizedWords.length - 1); j++) {
          const ww = normalizedWords[j];
          if (containsDigits(ww.raw) || isFormattedSsnToken(ww.raw)) {
            lastIdx = j;
          }
        }
        if (lastIdx !== -1) {
          addSpanByIndices(i, lastIdx, 'ssn');
        }
      }
    }

    // Emails (direct tokens: john@example.com)
    for (let i = 0; i < normalizedWords.length; i++) {
      const w = normalizedWords[i];
      if (w.raw.includes('@') || looksLikeEmail(w.raw)) {
        addSpanByIndices(i, i, 'email');
      }
    }

    // Emails (spoken: "john at gmail dot com")
    // Heuristic: detect 'at' then 'dot' soon after, and redact a small window around it.
    for (let i = 0; i < normalizedWords.length; i++) {
      const w = normalizedWords[i];
      if (w.lowerRaw === 'at') {
        let dotIdx = -1;
        for (let j = i + 1; j <= Math.min(i + 8, normalizedWords.length - 1); j++) {
          if (normalizedWords[j].lowerRaw === 'dot') {
            dotIdx = j;
            break;
          }
        }
        if (dotIdx !== -1) {
          const startIdx = Math.max(0, i - 2);
          const endIdx = Math.min(normalizedWords.length - 1, dotIdx + 2);
          addSpanByIndices(startIdx, endIdx, 'email_spoken');
        }
      }
    }

    // Password / PIN (keyword + redact a conservative lookahead window)
    for (let i = 0; i < normalizedWords.length; i++) {
      const w = normalizedWords[i];
      const isPwKeyword = passwordKeywords.some((kw) => w.normalized.includes(kw));
      if (isPwKeyword) {
        addSpanByIndices(i, Math.min(i + 10, normalizedWords.length - 1), 'password_or_pin');
      }
    }

    // Addresses
    // A) Explicit "address" keyword (redact next ~25 words)
    for (let i = 0; i < normalizedWords.length; i++) {
      const w = normalizedWords[i];
      const isAddrKeyword = addressKeywords.some((kw) => w.normalized === kw || w.normalized.includes(kw));
      if (isAddrKeyword) {
        addSpanByIndices(i, Math.min(i + 25, normalizedWords.length - 1), 'address');
      }
    }

    // B) House-number + street suffix pattern (e.g., "123 Main Street")
    for (let i = 0; i < normalizedWords.length; i++) {
      const w = normalizedWords[i];
      if (!containsDigits(w.raw)) continue;
      // Require a nearby street suffix to reduce false positives.
      let suffixIdx = -1;
      for (let j = i + 1; j <= Math.min(i + 6, normalizedWords.length - 1); j++) {
        const suffixToken = cleanAlphaNum(normalizedWords[j].raw);
        if (streetSuffixes.includes(suffixToken)) {
          suffixIdx = j;
          break;
        }
      }
      if (suffixIdx !== -1) {
        addSpanByIndices(i, Math.min(suffixIdx + 6, normalizedWords.length - 1), 'address_pattern');
      }
    }

    // Merge overlapping spans
    const merged = [];
    const sorted = spans.sort((a, b) => a.start - b.start);
    for (const span of sorted) {
      if (merged.length === 0) {
        merged.push(span);
        continue;
      }
      const last = merged[merged.length - 1];
      if (span.start <= last.end) {
        last.end = Math.max(last.end, span.end);
        last.wordIndices = [...new Set([...(last.wordIndices || []), ...(span.wordIndices || [])])];
        last.reason = `${last.reason},${span.reason}`;
      } else {
        merged.push(span);
      }
    }

    return { spans: merged };
  }

  /**
   * Sanitizes transcript text by replacing detected PCI-like sequences with [REDACTED].
   * Uses keyword-based detection to catch partial numbers.
   * @param {string} text
   * @returns {string}
   */
  static sanitizeTranscriptText(text) {
    if (!text) return '';
    let sanitized = text;

    // Card-related keywords followed by numbers (up to next 20 words/tokens)
    const cardPattern = /(credit\s*card|card\s*number|visa|mastercard|amex|discover|debit|payment\s*card)(\s+\w+){0,20}?(\d[\d\s\-]*\d)/gi;
    sanitized = sanitized.replace(cardPattern, '$1 [REDACTED]');

    // CVV/CVC followed by numbers
    const cvvPattern = /(cvv|cvc|security\s*code|verification\s*code|card\s*code)(\s+\w+){0,10}?(\d[\d\s\-]*)/gi;
    sanitized = sanitized.replace(cvvPattern, '$1 [REDACTED]');

    // Expiry followed by numbers
    const expiryPattern = /(expir\w*|exp\s*date|valid\s*through)(\s+\w+){0,10}?(\d[\d\s\-\/]*)/gi;
    sanitized = sanitized.replace(expiryPattern, '$1 [REDACTED]');

    // Fallback: standalone sequences of 12+ digits (full card numbers)
    sanitized = sanitized.replace(/(\d[\d\s-]{10,}\d)/g, '[REDACTED]');

    // Emails (direct)
    sanitized = sanitized.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]');

    // Emails (spoken: "john at gmail dot com")
    sanitized = sanitized.replace(
      /\b([a-z0-9._%+-]+)\s+at\s+([a-z0-9.-]+)\s+dot\s+([a-z]{2,})(\s+dot\s+([a-z]{2,}))?\b/gi,
      '[REDACTED]'
    );

    // DOB (match credit-card behavior): keyword + anything + digits nearby -> redact.
    // Examples: "date of birth is 12-12-88", "birthday 01/02/1990", "dob: 1990-01-02", "birth date 1-2-90"
    // Use [^.\n]{0,150} to capture anything (including commas, "it's", etc.) up to a sentence boundary
    const dobDigitPattern = /\b(date(?:\s|-)+of(?:\s|-)+birth|dateofbirth|dob|birthday|birth(?:\s|-)?date|birthdate)\b[^.\n]{0,150}?(\d[\d\s\-\/]*\d)/gi;
    sanitized = sanitized.replace(dobDigitPattern, '$1 [REDACTED]');

    // Password / PIN / passcode (keyword-driven)
    sanitized = sanitized.replace(/\b(password|passcode|pin|pincode)\b(\s+\S+){0,10}/gi, '$1 [REDACTED]');

    // Addresses (explicit keyword)
    sanitized = sanitized.replace(/\b(street\s+address|address)\b(\s+\S+){0,25}/gi, '$1 [REDACTED]');

    // Addresses (house number + street suffix)
    sanitized = sanitized.replace(
      /\b\d{1,6}\s+[a-z0-9.\-]+\s+(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|way|cir|circle|pkwy|parkway|trl|trail)\b[^.\n]{0,60}/gi,
      '[REDACTED]'
    );

    // SSNs
    // - formatted: 123-45-6789 (or with spaces)
    sanitized = sanitized.replace(/\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, '[REDACTED]');
    // - keyword-driven (e.g., "social security number is 123 45 6789")
    sanitized = sanitized.replace(
      /\b(ssn|social\s+security(\s+number)?)\b[^.\n]{0,80}\b(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/gi,
      '$1 [REDACTED]'
    );

    return sanitized;
  }

  /**
   * Simple DOB redaction:
   * - Trigger phrases: "date of birth", "dob", "birthday"
   * - If any date-like token appears within the next 12 tokens, redact from keyword through last date-like token.
   * - date-like = any digits, month name, or ordinal (e.g., "5th" or "fifth")
   */
  static redactDobSimple(text) {
    if (!text) return '';

    const months = new Set([
      'january','february','march','april','may','june','july','august','september','october','november','december',
      'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec',
    ]);
    const spelledOrdinals = new Set([
      'first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth',
      'eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth',
      'twentieth','twentyfirst','twentysecond','twentythird','twentyfourth','twentyfifth','twentysixth',
      'twentyseventh','twentyeighth','twentyninth','thirtieth','thirtyfirst',
    ]);

    const cleanAlphaNum = (token) => String(token || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const looksLikeOrdinal = (token) => {
      const cleaned = cleanAlphaNum(token);
      if (/^\d{1,2}(st|nd|rd|th)$/.test(cleaned)) return true;
      return spelledOrdinals.has(cleaned);
    };
    const looksDateLike = (token) => {
      if (/\d/.test(String(token || ''))) return true;
      const cleaned = cleanAlphaNum(token);
      return months.has(cleaned) || looksLikeOrdinal(token);
    };

    // Support common variants:
    // - "date of birth", "date-of-birth", "dateofbirth"
    // - "birth date", "birth-date", "birthdate"
    // - "dob", "birthday"
    const keywordRegex = /\b(date(?:\s|-)+of(?:\s|-)+birth|dateofbirth|dob|birthday|birth(?:\s|-)?date)\b/gi;
    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = keywordRegex.exec(text)) !== null) {
      const keywordStart = match.index;
      const keywordEnd = keywordRegex.lastIndex;
      const keywordText = match[0];

      // Append anything before keyword
      result += text.slice(lastIndex, keywordStart);

      // Tokenize after keyword
      const after = text.slice(keywordEnd);
      const tokenMatches = [];
      const tokenRe = /\S+/g;
      let t;
      while ((t = tokenRe.exec(after)) !== null) {
        tokenMatches.push({ token: t[0], start: t.index, end: tokenRe.lastIndex });
        if (tokenMatches.length >= 12) break;
      }

      let lastDateLikeEndInAfter = -1;
      for (let i = 0; i < tokenMatches.length; i++) {
        if (looksDateLike(tokenMatches[i].token)) {
          lastDateLikeEndInAfter = tokenMatches[i].end;
        }
      }

      if (lastDateLikeEndInAfter !== -1) {
        // Redact from keyword through the last date-like token
        result += `${keywordText} [REDACTED]`;
        lastIndex = keywordEnd + lastDateLikeEndInAfter;
        // Move regex cursor too (since we've consumed part of the string)
        keywordRegex.lastIndex = lastIndex;
      } else {
        // No date-like token found soon after; keep keyword as-is.
        result += keywordText;
        lastIndex = keywordEnd;
      }
    }

    result += text.slice(lastIndex);
    return result;
  }

  /**
   * Redacts audio by muting provided spans using FFmpeg.
   * @param {Buffer} audioBuffer
   * @param {Array<{start:number,end:number}>} spans
   * @returns {Promise<{buffer: Buffer, muted: boolean}>}
   */
  static async redactAudioWithFfmpeg(audioBuffer, spans = []) {
    if (!spans || spans.length === 0) {
      return { buffer: audioBuffer, muted: false };
    }

    const inputPath = path.join(os.tmpdir(), `pci-in-${Date.now()}.wav`);
    const outputPath = path.join(os.tmpdir(), `pci-out-${Date.now()}.wav`);

    try {
      fs.writeFileSync(inputPath, audioBuffer);

      const filters = spans
        .map((s) => {
          const start = Math.max(0, Number(s.start) || 0).toFixed(2);
          const end = Math.max(Number(s.end) || 0, Number(start)).toFixed(2);
          return `volume=enable='between(t,${start},${end})':volume=0`;
        })
        .join(',');

      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath];
      if (filters.length > 0) {
        args.push('-af', filters);
      }
      args.push('-c:a', 'pcm_s16le', outputPath);

      await execFileAsync('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 });

      const redactedBuffer = fs.readFileSync(outputPath);
      return { buffer: redactedBuffer, muted: true };
    } catch (error) {
      logger.error({ error: error.message }, 'FFmpeg redaction failed');
      throw new Error(`FFmpeg redaction failed: ${error.message}`);
    } finally {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (cleanupErr) {
        logger.warn({ error: cleanupErr.message }, 'Failed to cleanup temp redaction files');
      }
    }
  }
}


