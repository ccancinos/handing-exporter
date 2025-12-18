/**
 * Media Download Module
 *
 * Handles downloading images and videos with retry logic
 */

import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import pLimit from 'p-limit';

export async function downloadMedia(url: string, filePath: string, options: any = {}) {
  const {
    maxRetries = 3,
    timeout = 30000
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Ensure directory exists
      await mkdir(dirname(filePath), { recursive: true });

      // Fetch the media
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Stream to file
      const fileStream = createWriteStream(filePath);
      await pipeline(response.body, fileStream);

      // Get file size
      const stats = await import('fs/promises').then(fs => fs.stat(filePath));

      return {
        status: 'success',
        size: stats.size,
        path: filePath
      };

    } catch (error: any) {
      lastError = error;
      console.error(`Download attempt ${attempt}/${maxRetries} failed for ${url}: ${error.message}`);

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // All retries failed
  return {
    status: 'failed',
    error: lastError.message,
    url
  };
}

export async function downloadMediaBatch(mediaItems: any[], options: any = {}) {
  const {
    concurrency = 3,
    ...downloadOptions
  } = options;

  const limit = pLimit(concurrency);

  const downloads = mediaItems.map(item =>
    limit(() => downloadMedia(item.url, item.filePath, downloadOptions))
  );

  return Promise.all(downloads);
}

/**
 * Download an external link file (no retries, simple attempt)
 * @param {string} url - External link URL
 * @param {string} filePath - Destination file path
 * @param {Object} options - Download options
 * @returns {Promise<Object>} Download result with status, contentType, and extension
 */
export async function downloadExternalLink(url: string, filePath: string, options: any = {}) {
  const {
    timeout = 40000 // 40 seconds for external links
  } = options;

  try {
    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Fetch the external link
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow' // Follow redirects
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get content type
    const contentType = response.headers.get('content-type') || '';

    // Stream to file
    const fileStream = createWriteStream(filePath);
    await pipeline(response.body, fileStream);

    // Get file size
    const stats = await import('fs/promises').then(fs => fs.stat(filePath));

    // Determine file extension from content type
    const extension = getExtensionFromContentType(contentType);

    return {
      status: 'success',
      size: stats.size,
      path: filePath,
      contentType,
      extension
    };

  } catch (error: any) {
    // Single attempt only, no retries
    return {
      status: 'failed',
      error: error.message,
      url
    };
  }
}

function getExtensionFromContentType(contentType: string): string {
  const mimeToExt: Record<string, string> = {
    // Documents
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.ms-word': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',

    // Images
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',

    // Videos
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'video/mpeg': 'mpeg',
    'video/x-matroska': 'mkv',

    // Archives
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
    'application/gzip': 'gz',

    // Text/HTML (for cases where HTML is the actual content we want to save)
    'text/html': 'html',
    'application/xhtml+xml': 'html',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/xml': 'xml',
    'text/xml': 'xml',

    // Other common types
    'application/octet-stream': 'bin'
  };

  // Extract base type without parameters
  const baseType = contentType.split(';')[0].trim().toLowerCase();

  return mimeToExt[baseType] || 'bin'; // Default to .bin if unknown
}

export function isExternalLink(url: string): boolean {
  const externalPatterns = [
    'photos.app.goo.gl',
    'photos.google.com',
    'drive.google.com',
    'youtube.com',
    'youtu.be'
  ];

  return externalPatterns.some(pattern => url.includes(pattern));
}

export function categorizeMedia(mediaUrls: any[]) {
  const downloadable = [];
  const external = [];

  for (const media of mediaUrls) {
    if (isExternalLink(media.url)) {
      external.push(media);
    } else {
      downloadable.push(media);
    }
  }

  return { downloadable, external };
}

/**
 * Download single avatar with retry logic
 * @param {string} url - Avatar URL
 * @param {string} filePath - Destination file path
 * @param {number} retries - Number of retries
 * @returns {Promise<Object>} Result with success status and optional error
 */
export async function downloadAvatar(
  url: string,
  filePath: string,
  retries: number = 3
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Ensure directory exists
      await mkdir(dirname(filePath), { recursive: true });

      // Smaller timeout for avatars (usually small files)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Stream to file
      const fileStream = createWriteStream(filePath);
      await pipeline(response.body, fileStream);

      return { success: true };

    } catch (error: any) {
      if (attempt === retries) {
        return { success: false, error: error.message };
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

/**
 * Download multiple avatars in batch with deduplication
 * @param {Array} avatars - Array of avatar objects with author, url, and filePath
 * @param {number} concurrency - Number of concurrent downloads
 * @returns {Promise<Map>} Map of author to download result
 */
export async function downloadAvatarsBatch(
  avatars: Array<{ author: string; url: string; filePath: string }>,
  concurrency: number = 5
): Promise<Map<string, { success: boolean; filename: string; error?: string }>> {
  const limit = pLimit(concurrency);
  const results = new Map<string, { success: boolean; filename: string; error?: string }>();

  // Deduplicate by author name
  const uniqueAvatars = new Map<string, typeof avatars[0]>();
  for (const avatar of avatars) {
    if (!uniqueAvatars.has(avatar.author)) {
      uniqueAvatars.set(avatar.author, avatar);
    }
  }

  console.log(`  → Downloading ${uniqueAvatars.size} unique avatars...`);

  const promises = Array.from(uniqueAvatars.values()).map((avatar) =>
    limit(async () => {
      const result = await downloadAvatar(avatar.url, avatar.filePath);
      const filename = avatar.filePath.split('/').pop() || 'unknown.jpg';
      results.set(avatar.author, {
        success: result.success,
        filename: filename,
        error: result.error
      });
      return result;
    })
  );

  await Promise.all(promises);

  return results;
}
