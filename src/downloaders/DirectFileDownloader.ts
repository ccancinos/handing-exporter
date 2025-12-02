/**
 * Direct File Downloader
 *
 * Handles direct file downloads (images, videos, PDFs, etc.)
 * from URLs that point directly to a file resource
 */

import { Downloader, DownloadContext, DownloadResult } from '../types.js';
import { downloadMedia, downloadExternalLink } from '../downloader.js';
import { sanitizeFilename, parseTimestamp } from '../utils.js';
import { extname } from 'path';

export class DirectFileDownloader implements Downloader {
  canHandle(url: string): boolean {
    // Handle any URL that's not a gallery/album
    // This will be the fallback downloader
    return !this.isGalleryLink(url);
  }

  getPriority(): number {
    // Lowest priority - fallback handler
    return 0;
  }

  private isGalleryLink(url: string): boolean {
    return url.includes('photos.app.goo.gl') ||
           url.includes('photos.google.com/share') ||
           url.includes('drive.google.com/drive/folders');
  }

  async download(url: string, context: DownloadContext): Promise<DownloadResult[]> {
    const { outputDir, post } = context;

    // Generate filename from URL or context
    const filename = this.generateFilename(url, context);
    const filePath = `${outputDir}/${filename}`;

    // Try download
    const result = await downloadMedia(url, filePath, {
      maxRetries: 3,
      timeout: 30000
    });

    if (result.status === 'success') {
      return [{
        status: 'success',
        url,
        localPath: filePath,
        filename,
        size: result.size
      }];
    } else {
      return [{
        status: 'failed',
        url,
        error: result.error
      }];
    }
  }

  private generateFilename(url: string, context: DownloadContext): string {
    const { post, mediaType, index } = context;

    // Parse timestamp from post (Spanish format: "DD de MMMM YYYY, HH:MM")
    const date = parseTimestamp(post.timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    const timestamp = `${month}-${day}-${hour}-${minute}`;

    // Get extension from URL
    let ext = extname(url).split('?')[0]; // Remove query params
    if (!ext) {
      ext = mediaType === 'video' ? '.mp4' : '.jpg';
    }

    // Build filename
    const type = mediaType || 'file';
    const num = index !== undefined ? index + 1 : 1;

    return `${timestamp}-${type}-${num}${ext}`;
  }
}
