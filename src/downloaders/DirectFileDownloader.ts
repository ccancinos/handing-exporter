/**
 * Direct File Downloader
 *
 * Handles direct file downloads (PDFs, images, videos, etc.)
 * from URLs that point directly to a file resource.
 * Filters out non-downloadable URLs (web pages, forms, etc.)
 */

import { Downloader, DownloadContext, DownloadResult } from '../types.js';
import { downloadExternalLink } from '../downloader.js';
import { sanitizeFilename, parseTimestamp } from '../utils.js';
import { getMediaFilePath } from '../file-organizer.js';

export class DirectFileDownloader implements Downloader {
  canHandle(url: string): boolean {
    // Reject gallery links (handled by specialized downloaders)
    if (this.isGalleryLink(url)) {
      return false;
    }

    // Reject non-downloadable URLs (web pages, forms, etc.)
    if (this.isNonDownloadableUrl(url)) {
      return false;
    }

    // Accept everything else as potential direct file downloads
    return true;
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

  /**
   * Check if URL points to a non-downloadable resource (web page, form, etc.)
   */
  private isNonDownloadableUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();

    // Email links (mailto:)
    if (lowerUrl.startsWith('mailto:')) {
      return true;
    }

    // Video streaming platforms (not direct file links)
    if (lowerUrl.includes('youtube.com/watch') ||
        lowerUrl.includes('youtube.com/live') ||
        lowerUrl.includes('youtu.be/')) {
      return true;
    }

    // Interactive web applications
    if (lowerUrl.includes('padlet.com/') ||
        lowerUrl.includes('forms.google.com/') ||
        lowerUrl.includes('docs.google.com/forms/')) {
      return true;
    }

    // Meeting/conferencing links
    if (lowerUrl.includes('zoom.us/') ||
        lowerUrl.includes('meet.google.com/')) {
      return true;
    }

    // Map services
    if (lowerUrl.includes('google.com/maps')) {
      return true;
    }

    // App stores (extended to catch more domains)
    if (lowerUrl.includes('play.google.com') ||
        lowerUrl.includes('apps.apple.com') ||
        lowerUrl.includes('itunes.apple.com') ||
        lowerUrl.includes('apps.microsoft.com') ||
        lowerUrl.includes('chrome.google.com/webstore')) {
      return true;
    }

    // E-commerce / Product pages
    if (lowerUrl.match(/amazon\.[a-z.]+\/.*\/dp\//) ||
        lowerUrl.includes('mercadolibre.com') ||
        lowerUrl.includes('ebay.com/itm/')) {
      return true;
    }

    // Social media posts
    if (lowerUrl.includes('facebook.com') ||
        lowerUrl.includes('instagram.com/p/') ||
        lowerUrl.includes('twitter.com') ||
        lowerUrl.includes('linkedin.com/posts/')) {
      return true;
    }

    // Link shorteners and redirectors (usually point to web pages)
    if (lowerUrl.includes('linktr.ee/') ||
        lowerUrl.includes('bit.ly/') ||
        lowerUrl.includes('forms.gle/')) {
      return true;
    }

    // Generic website indicators (root domains without file extensions)
    // Skip if URL ends with common web extensions or has no path
    if (lowerUrl.match(/\.(com|ar|edu|org|net)(\/)?$/)) {
      return true;
    }

    return false;
  }

  async download(url: string, context: DownloadContext): Promise<DownloadResult[]> {
    const { post, fileIndex } = context;
    const baseDir = context.baseDir || context.outputDir;

    // Extract link name from context if available
    const linkName = (context as any).linkName || '';

    try {
      // Step 1: Download to temp file to detect Content-Type
      const tempFilename = this.generateFilename(post, linkName, fileIndex, 'tmp');
      const tempFilePath = getMediaFilePath(baseDir, post, tempFilename);

      console.log(`  Attempting direct file download: ${url}`);
      const result = await downloadExternalLink(url, tempFilePath, { timeout: 40000 });

      if (result.status === 'failed') {
        return [{
          status: 'failed',
          url,
          error: result.error
        }];
      }

      // Step 2: Rename file with proper extension from Content-Type
      const finalFilename = this.generateFilename(post, linkName, fileIndex, result.extension);
      const finalFilePath = getMediaFilePath(baseDir, post, finalFilename);

      // Rename if extension changed
      if (finalFilename !== tempFilename) {
        const fs = await import('fs/promises');
        await fs.rename(tempFilePath, finalFilePath);
      }

      // Smart HTML detection: Check if HTML file is actually an error/web page
      if (result.extension === 'html') {
        const isUnwantedHtml = await this.isUnwantedHtmlPage(finalFilePath);
        if (isUnwantedHtml) {
          console.log(`  ⚠ HTML appears to be an error page or web application, not a downloadable file`);
          // Delete the unwanted HTML file
          const fs = await import('fs/promises');
          await fs.unlink(finalFilePath).catch(() => {});

          return [{
            status: 'failed',
            url,
            error: 'Downloaded HTML appears to be a web page/error page, not a file attachment'
          }];
        }
      }

      console.log(`  ✓ Downloaded: ${finalFilename} (${result.extension})`);

      return [{
        status: 'success',
        url,
        localPath: finalFilePath,
        filename: finalFilename,
        size: result.size,
        sourceName: linkName
      }];

    } catch (error: any) {
      return [{
        status: 'failed',
        url,
        error: error.message
      }];
    }
  }

  /**
   * Check if an HTML file is an unwanted web page/error page
   * Returns true if the HTML should not be saved
   */
  private async isUnwantedHtmlPage(filePath: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');

      // Small files (< 50KB) are more likely to be error pages
      if (content.length < 50000) {
        const lowerContent = content.toLowerCase();

        // Common error page indicators
        const errorIndicators = [
          '404 not found',
          '403 forbidden',
          'access denied',
          'page not found',
          'error occurred',
          'something went wrong',
          'unauthorized access',
          'permission denied',
          'file not found',
          'content not available'
        ];

        // Web application indicators (not downloadable content)
        const webAppIndicators = [
          'apple.com/itunes',
          'apps.apple.com',
          'play.google.com',
          'app store',
          'google play',
          'download the app',
          'get it on',
          'available on the',
          'react-root',  // React applications
          'ng-app',      // Angular applications
          'vue-app',     // Vue applications
          'data-reactroot' // React root
        ];

        // Check for error indicators
        for (const indicator of errorIndicators) {
          if (lowerContent.includes(indicator)) {
            return true;
          }
        }

        // Check for web app indicators
        for (const indicator of webAppIndicators) {
          if (lowerContent.includes(indicator)) {
            return true;
          }
        }

        // Check if it's mostly navigation/marketing (very little actual content)
        const hasMinimalContent =
          (content.match(/<p>/g)?.length || 0) < 3 &&
          (content.match(/<article>/g)?.length || 0) === 0 &&
          (content.match(/<nav>/g)?.length || 0) > 0;

        if (hasMinimalContent) {
          return true;
        }
      }

      return false;
    } catch (error) {
      // If we can't read the file, assume it's okay to keep
      return false;
    }
  }

  /**
   * Generate filename for external file
   * Matches the pattern from generateExternalFileFilename()
   */
  private generateFilename(post: any, linkName: string, index: number, extension: string): string {
    const date = parseTimestamp(post.timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    const timestamp = `${month}-${day}-${hour}-${minute}`;

    // Use the link name if available, otherwise use index
    if (linkName && linkName.trim()) {
      const sanitizedName = sanitizeFilename(linkName);
      return `${timestamp}-${sanitizedName}.${extension}`;
    }

    return `${timestamp}-external-${index + 1}.${extension}`;
  }
}
