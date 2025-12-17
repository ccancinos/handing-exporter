/**
 * Downloader Factory
 *
 * Automatically selects the appropriate downloader based on URL patterns
 * Uses priority system when multiple downloaders can handle the same URL
 */

import { Downloader } from '../types.js';
import { DirectFileDownloader } from './DirectFileDownloader.js';
import { GooglePhotosDownloader } from './GooglePhotosDownloader.js';
import { GoogleDriveFileDownloader } from './GoogleDriveFileDownloader.js';
import { GoogleDriveFolderDownloader } from './GoogleDriveFolderDownloader.js';
import { Page } from 'playwright';

export class DownloaderFactory {
  private downloaders: Downloader[] = [];

  constructor(page?: Page) {
    // Register all downloaders
    // Note: Order matters for priority when multiple can handle same URL
    this.registerDownloader(new GooglePhotosDownloader(page));
    this.registerDownloader(new GoogleDriveFolderDownloader(page));
    this.registerDownloader(new GoogleDriveFileDownloader(page));
    this.registerDownloader(new DirectFileDownloader());
  }

  /**
   * Register a downloader
   */
  registerDownloader(downloader: Downloader) {
    this.downloaders.push(downloader);
  }

  /**
   * Get the appropriate downloader for a URL
   * @param url - URL to download
   * @returns Downloader instance or null if none found
   */
  getDownloader(url: string): Downloader | null {
    // Find all downloaders that can handle this URL
    const candidates = this.downloaders.filter(d => d.canHandle(url));

    if (candidates.length === 0) {
      return null;
    }

    // If only one candidate, return it
    if (candidates.length === 1) {
      return candidates[0];
    }

    // Multiple candidates - use priority
    candidates.sort((a, b) => {
      const priorityA = a.getPriority?.() ?? 0;
      const priorityB = b.getPriority?.() ?? 0;
      return priorityB - priorityA; // Higher priority first
    });

    return candidates[0];
  }

  /**
   * Update Playwright page for gallery downloaders
   */
  setPage(page: Page) {
    for (const downloader of this.downloaders) {
      if ('setPage' in downloader && typeof downloader.setPage === 'function') {
        (downloader as any).setPage(page);
      }
    }
  }
}
