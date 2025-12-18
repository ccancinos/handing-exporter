/**
 * Google Drive File Downloader
 *
 * Handles downloading individual files from Google Drive file links
 * Files are saved to External_Files directory
 */

import { Downloader, DownloadContext, DownloadResult } from '../types.js';
import { Page } from 'playwright';
import { sleep, parseTimestamp } from '../utils.js';
import { getMediaFilePath } from '../file-organizer.js';

export class GoogleDriveFileDownloader implements Downloader {
  private page: Page | null = null;

  constructor(page?: Page) {
    this.page = page || null;
  }

  setPage(page: Page) {
    this.page = page;
  }

  canHandle(url: string): boolean {
    return url.includes('drive.google.com/file/d/');
  }

  getPriority(): number {
    // Higher priority than direct file downloader
    return 10;
  }

  async download(url: string, context: DownloadContext): Promise<DownloadResult[]> {
    if (!this.page) {
      return [{
        status: 'failed',
        url,
        error: 'No Playwright page provided to GoogleDriveFileDownloader'
      }];
    }

    try {
      console.log(`Downloading Google Drive file: ${url}`);

      // Extract file ID from URL
      const fileIdMatch = url.match(/\/d\/([^\/\?]+)/);
      if (!fileIdMatch) {
        return [{
          status: 'failed',
          url,
          error: 'Could not extract file ID from URL'
        }];
      }
      const fileId = fileIdMatch[1];

      // Navigate to the file page to get metadata
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await sleep(2000);

      // Try to extract the actual filename and content type from the page
      let actualFilename = '';
      let contentType = '';
      try {
        const metadata = await this.page.evaluate(() => {
          // Try to get filename
          let filename = '';
          const titleEl = document.querySelector('meta[property="og:title"]');
          if (titleEl) {
            filename = titleEl.getAttribute('content') || '';
          }

          if (!filename) {
            const titleTag = document.querySelector('title');
            if (titleTag?.textContent) {
              // Remove " - Google Drive" suffix
              filename = titleTag.textContent.replace(/ - Google .*$/i, '').trim();
            }
          }

          // Try to get content type
          let type = '';
          const typeEl = document.querySelector('meta[itemprop="name"][content*="."]');
          if (typeEl) {
            const content = typeEl.getAttribute('content') || '';
            if (content.includes('.')) {
              const ext = content.split('.').pop();
              type = ext || '';
            }
          }

          // Check if it's a PDF
          const bodyHtml = document.body.innerHTML;
          if (bodyHtml.includes('"docs-dm":"application/pdf"') || bodyHtml.includes('application/pdf')) {
            type = 'pdf';
          }

          return { filename, type };
        });

        actualFilename = metadata.filename;
        contentType = metadata.type;
      } catch (e) {
        console.log('  Could not extract metadata from page');
      }

      // Construct direct download URL
      console.log('  Constructing direct download URL...');
      const directDownloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;

      // Generate the proper filename with smart extension handling
      let filename: string;
      const date = parseTimestamp(context.post.timestamp);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      const timestamp = `${month}-${day}-${hour}-${minute}`;

      if (actualFilename) {
        // Strip any existing extension from the filename to avoid doubles
        let baseFilename = actualFilename;
        const lastDotIndex = actualFilename.lastIndexOf('.');
        if (lastDotIndex > 0) {
          const possibleExt = actualFilename.substring(lastDotIndex + 1).toLowerCase();
          // Only strip if it looks like a real extension (2-5 chars, alphanumeric)
          if (possibleExt.length >= 2 && possibleExt.length <= 5 && /^[a-z0-9]+$/.test(possibleExt)) {
            baseFilename = actualFilename.substring(0, lastDotIndex);
            // If we didn't detect a content type, use the extension from filename
            if (!contentType) {
              contentType = possibleExt;
            }
          }
        }

        const sanitizedName = baseFilename.replace(/[^a-zA-Z0-9.-]/g, '-').substring(0, 100);

        // Always ensure we have an extension
        const extension = contentType || 'pdf'; // Default to PDF for Google Drive files
        filename = `${timestamp}-${sanitizedName}.${extension}`;
      } else {
        // No filename extracted - use file ID with extension
        const extension = contentType || 'pdf'; // Default to PDF
        filename = `${timestamp}-drive-file-${fileId}.${extension}`;
      }

      // Use getMediaFilePath to auto-route based on file extension
      const baseDir = context.baseDir || context.outputDir;
      const filePath = getMediaFilePath(baseDir, context.post, filename);

      console.log(`  Downloading: ${actualFilename || fileId}`);
      console.log(`  Target path: ${filePath}`);

      // Use Playwright's authenticated request context to download the file
      // This ensures we have the necessary cookies for Google Drive access
      try {
        const response = await this.page.request.get(directDownloadUrl);

        if (response.ok()) {
          // Save the file
          const fs = await import('fs/promises');
          const buffer = await response.body();
          await fs.writeFile(filePath, buffer);

          // Get file size
          const stats = await fs.stat(filePath);
          const fileSize = stats.size;

          console.log(`  ✓ Downloaded to: ${filePath} (${this.formatBytes(fileSize)})`);

          return [{
            status: 'success',
            url,
            localPath: filePath,
            filename,
            size: fileSize,
            sourceName: actualFilename || fileId
          }];
        } else {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }
      } catch (error: any) {
        // If direct download failed, it might be a large file that requires virus scan bypass
        console.log(`  ⚠️  Direct download failed: ${error.message}`);
        console.log(`  Trying alternative method for potentially large file...`);

        // Set up popup listener BEFORE triggering download
        const popupPromise = this.page.context().waitForEvent('page', { timeout: 10000 });

        // Try to trigger download with keyboard shortcut
        console.log('  Trying keyboard shortcut (Meta+D / Cmd+D)...');
        await this.page.keyboard.press('Meta+d');
        await sleep(1000);

        // Check if a new tab/popup opened (virus scan warning for large files)
        let newPage = null;
        try {
          console.log('  Waiting for potential new tab (virus scan warning)...');
          newPage = await popupPromise;
          await newPage.waitForLoadState('networkidle', { timeout: 10000 });

          // Check if it's the virus scan warning page
          const virusScanForm = await newPage.locator('#download-form').count();
          if (virusScanForm > 0) {
            console.log('  ✓ Detected virus scan warning page (large file >100MB)');

            // Set up download listener on the new page
            const newPageDownloadPromise = newPage.waitForEvent('download', { timeout: 90000 });

            // Click "Download anyway" button
            const downloadButton = newPage.locator('#uc-download-link[type="submit"]');
            console.log('  Clicking "Download anyway" button...');
            await downloadButton.click({ timeout: 5000 });

            // Wait for download from the new page
            const download = await newPageDownloadPromise;
            console.log(`  ✓ Download started: ${await download.suggestedFilename()}`);

            // Get suggested filename and update if better than our default
            const suggestedFilename = await download.suggestedFilename();
            if (suggestedFilename && !actualFilename) {
              // Strip extension from suggested filename to avoid doubles
              let baseName = suggestedFilename;
              let detectedExt = '';
              const lastDot = suggestedFilename.lastIndexOf('.');
              if (lastDot > 0) {
                const ext = suggestedFilename.substring(lastDot + 1).toLowerCase();
                if (ext.length >= 2 && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) {
                  baseName = suggestedFilename.substring(0, lastDot);
                  detectedExt = ext;
                }
              }

              const date = parseTimestamp(context.post.timestamp);
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const hour = String(date.getHours()).padStart(2, '0');
              const minute = String(date.getMinutes()).padStart(2, '0');
              const timestamp = `${month}-${day}-${hour}-${minute}`;
              const sanitized = baseName.replace(/[^a-zA-Z0-9.-]/g, '-').substring(0, 100);

              const finalExt = detectedExt || contentType || 'pdf';
              filename = `${timestamp}-${sanitized}.${finalExt}`;
            }

            const finalPath = getMediaFilePath(baseDir, context.post, filename);

            // Save the download
            await download.saveAs(finalPath);

            // Get file size
            const fs = await import('fs/promises');
            const stats = await fs.stat(finalPath);
            const fileSize = stats.size;

            console.log(`  ✓ Downloaded to: ${finalPath} (${this.formatBytes(fileSize)})`);

            // Close the popup tab
            await newPage.close();

            return [{
              status: 'success',
              url,
              localPath: finalPath,
              filename,
              size: fileSize,
              sourceName: actualFilename || suggestedFilename || fileId
            }];
          } else {
            console.log('  New tab opened but no virus scan warning found');
            await newPage.close();
          }
        } catch (e) {
          // No popup or popup handling failed
          console.log('  ✗ Alternative method also failed');
        }

        return [{
          status: 'failed',
          url,
          error: error.message || 'Failed to download file using both direct download and browser automation'
        }];
      }

    } catch (error: any) {
      console.error(`  ✗ Failed to download Google Drive file: ${error.message}`);
      return [{
        status: 'failed',
        url,
        error: error.message
      }];
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  private generateFilename(context: DownloadContext, index: number, originalName: string): string {
    const { post } = context;

    // Parse timestamp from post (Spanish format: "DD de MMMM YYYY, HH:MM")
    const date = parseTimestamp(post.timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    const timestamp = `${month}-${day}-${hour}-${minute}`;

    // Sanitize original filename
    const sanitized = originalName.replace(/[^a-zA-Z0-9.-]/g, '-');

    return `${timestamp}-${sanitized}`;
  }
}
