/**
 * Utility Functions
 *
 * Common helper functions used across the application
 */

import { Post } from './types.js';

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim()                         // Remove leading/trailing spaces
    .substring(0, 200);             // Limit length
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function createId(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

export function parseTimestamp(timestampStr: string): Date {
  if (!timestampStr || timestampStr.trim() === '') {
    // Return current date if timestamp is missing
    return new Date();
  }

  // Spanish month names to numbers
  const spanishMonths: Record<string, number> = {
    'enero': 0,
    'febrero': 1,
    'marzo': 2,
    'abril': 3,
    'mayo': 4,
    'junio': 5,
    'julio': 6,
    'agosto': 7,
    'septiembre': 8,
    'octubre': 9,
    'noviembre': 10,
    'diciembre': 11
  };

  // Parse format: "27 de noviembre 2025, 09:11"
  const regex = /(\d{1,2})\s+de\s+(\w+)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/i;
  const match = timestampStr.match(regex);

  if (match) {
    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const year = parseInt(match[3], 10);
    const hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);

    const month = spanishMonths[monthName];

    if (month !== undefined) {
      return new Date(year, month, day, hours, minutes);
    }
  }

  // Fallback: try standard JavaScript date parsing
  const fallbackDate = new Date(timestampStr);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }

  // Last resort: return current date
  console.warn(`Failed to parse timestamp: ${timestampStr}`);
  return new Date();
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: any = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    factor = 2
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries - 1) {
        const delay = Math.min(initialDelay * Math.pow(factor, attempt), maxDelay);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function groupPostsByMonth(posts: Post[]): Map<string, Post[]> {
  const grouped = new Map();

  for (const post of posts) {
    const date = parseTimestamp(post.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const key = `${year}-${month}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(post);
  }

  return grouped;
}
