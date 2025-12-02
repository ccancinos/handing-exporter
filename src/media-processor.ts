/**
 * Media Processor
 *
 * High-level wrapper for downloading media using the new downloader factory
 * Integrates with existing codebase with minimal changes
 */

import { DownloaderFactory } from './downloaders/index.js';
import { Post, Config, DownloadResult } from './types.js';
import { Page } from 'playwright';

export class MediaProcessor {
  private downloaderFactory: DownloaderFactory;

  constructor(page: Page) {
    this.downloaderFactory = new DownloaderFactory(page);
  }

  /**
   * Download a single media file using the appropriate downloader
   */
  async downloadSingleMedia(
    url: string,
    post: Post,
    outputDir: string,
    mediaType: string,
    index: number
  ): Promise<DownloadResult[]> {
    const downloader = this.downloaderFactory.getDownloader(url);

    if (!downloader) {
      return [{
        status: 'failed',
        url,
        error: 'No downloader found for URL'
      }];
    }

    const context = {
      outputDir,
      post,
      fileIndex: index,
      mediaType,
      index
    };

    return downloader.download(url, context);
  }

  /**
   * Check if a URL is a gallery that will produce multiple files
   */
  isGalleryUrl(url: string): boolean {
    return url.includes('photos.app.goo.gl') ||
           url.includes('photos.google.com/share') ||
           url.includes('drive.google.com/drive/folders');
  }
}
