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
  const mimeToExt = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls'
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
