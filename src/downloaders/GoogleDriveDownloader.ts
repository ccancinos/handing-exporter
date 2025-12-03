/**
 * Google Drive Downloader
 *
 * Handles downloading files from Google Drive folder links
 * Uses Playwright to extract file URLs from the JavaScript-rendered page
 */

import { Downloader, DownloadContext, DownloadResult } from '../types.js';
import { Page } from 'playwright';
import { downloadMedia } from '../downloader.js';
import { sleep, parseTimestamp } from '../utils.js';

export class GoogleDriveDownloader implements Downloader {
  private page: Page | null = null;

  constructor(page?: Page) {
    this.page = page || null;
  }

  setPage(page: Page) {
    this.page = page;
  }

  canHandle(url: string): boolean {
    return url.includes('drive.google.com/drive/folders');
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
        error: 'No Playwright page provided to GoogleDriveDownloader'
      }];
    }

    try {
      console.log(`Extracting files from Google Drive folder: ${url}`);

      // Navigate to the folder
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

      // Wait for files to load
      await sleep(3000);

      // Scroll to load all files
      await this.scrollToLoadAll(this.page);

      // Extract file URLs and names
      const files = await this.extractFiles(this.page);

      console.log(`Found ${files.length} files in Google Drive folder`);

      if (files.length === 0) {
        return [{
          status: 'failed',
          url,
          error: 'No files found in folder. May require authentication.'
        }];
      }

      // Download each file
      const results: DownloadResult[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filename = this.generateFilename(context, i, file.name);
        const filePath = `${context.outputDir}/${filename}`;

        console.log(`Downloading file ${i + 1}/${files.length}: ${file.name}...`);

        // Convert Drive viewer URL to download URL
        const downloadUrl = this.getDirectDownloadUrl(file.url);

        const result = await downloadMedia(downloadUrl, filePath, {
          maxRetries: 3,
          timeout: 30000
        });

        if (result.status === 'success') {
          results.push({
            status: 'success',
            url: file.url,
            localPath: filePath,
            filename,
            size: result.size,
            sourceName: file.name,
            sourceFolder: url
          });
        } else {
          results.push({
            status: 'failed',
            url: file.url,
            error: result.error,
            sourceName: file.name,
            sourceFolder: url
          });
        }
      }

      return results;

    } catch (error: any) {
      console.error(`Failed to extract from Google Drive folder: ${error.message}`);
      return [{
        status: 'failed',
        url,
        error: error.message
      }];
    }
  }

  private async scrollToLoadAll(page: Page) {
    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 20;

    while (scrollAttempts < maxScrollAttempts) {
      // Scroll to bottom
      await page.evaluate(() => {
        const scrollable = document.querySelector('[role="main"]') || document.body;
        scrollable.scrollTop = scrollable.scrollHeight;
      });
      await sleep(1500);

      // Check if height changed
      const currentHeight = await page.evaluate(() => {
        const scrollable = document.querySelector('[role="main"]') || document.body;
        return scrollable.scrollHeight;
      });

      if (currentHeight === previousHeight) {
        break;
      }

      previousHeight = currentHeight;
      scrollAttempts++;
    }

    console.log(`Scrolled ${scrollAttempts} times to load all files`);
  }

  private async extractFiles(page: Page): Promise<Array<{ url: string; name: string }>> {
    // Extract folder ID from URL to filter it out
    const currentUrl = page.url();
    const folderIdMatch = currentUrl.match(/folders\/([^/?]+)/);
    const folderIdToExclude = folderIdMatch ? folderIdMatch[1] : null;

    const files = await page.evaluate((folderId) => {
      const results: Array<{ url: string; name: string }> = [];
      const seenIds = new Set<string>(); // Deduplication

      // STRATEGY 1: Try specific file item selectors (more reliable)
      // Google Drive typically uses [data-id] on file rows in list view
      const fileRows = document.querySelectorAll('[data-id][role="row"], [data-id][data-tooltip], [data-id].Q5txwe');

      fileRows.forEach((el: any) => {
        const fileId = el.dataset?.id || el.getAttribute('data-id');

        // Inline validation (no helper function to avoid __name issue)
        if (!fileId) return;
        if (fileId.length < 10) return; // Too short
        if (fileId === folderId) return; // Don't include folder itself
        if (fileId.startsWith('_') || fileId.startsWith('-')) return; // System elements
        if (fileId.includes(' ')) return; // Invalid character
        if (!/^[a-zA-Z0-9_-]{10,50}$/.test(fileId)) return; // Pattern validation
        if (seenIds.has(fileId)) return; // Already seen

        // Try to extract name from various possible locations
        let name = '';

        // Try data-tooltip attribute (common in grid view)
        const tooltipName = el.getAttribute('data-tooltip');
        if (tooltipName && !tooltipName.includes('http')) {
          name = tooltipName;
        }

        // Try aria-label (accessible name)
        if (!name) {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && !ariaLabel.includes('http')) {
            name = ariaLabel;
          }
        }

        // Try text content of specific child elements
        if (!name) {
          const nameEl = el.querySelector('[data-tooltip], .Q5txwe, [role="gridcell"] span');
          const textContent = nameEl?.textContent?.trim();
          if (textContent && textContent.length < 200 && !textContent.includes('http')) {
            name = textContent;
          }
        }

        // Use file ID as fallback only if we couldn't find a name
        if (!name) {
          name = `file-${fileId}`;
        }

        seenIds.add(fileId);
        const url = `https://drive.google.com/file/d/${fileId}/view`;
        results.push({ url, name });
      });

      // STRATEGY 2: Fallback - generic [data-id] selector with strict filtering
      if (results.length === 0) {
        console.log('Fallback: Using generic [data-id] selector');
        const allElements = document.querySelectorAll('[data-id]');

        allElements.forEach((el: any) => {
          const fileId = el.dataset?.id || el.getAttribute('data-id');

          // Inline validation (no helper function to avoid __name issue)
          if (!fileId) return;
          if (fileId.length < 10) return; // Too short
          if (fileId === folderId) return; // Don't include folder itself
          if (fileId.startsWith('_') || fileId.startsWith('-')) return; // System elements
          if (fileId.includes(' ')) return; // Invalid character
          if (!/^[a-zA-Z0-9_-]{10,50}$/.test(fileId)) return; // Pattern validation
          if (seenIds.has(fileId)) return; // Already seen

          // Try to get name
          const nameEl = el.querySelector('[data-tooltip]') || el;
          const name = nameEl.getAttribute('data-tooltip') ||
                      nameEl.getAttribute('aria-label') ||
                      nameEl.textContent?.trim() ||
                      `file-${fileId}`;

          // Filter out names that look like system elements
          if (name.length > 200 || name.includes('http')) return;

          seenIds.add(fileId);
          const url = `https://drive.google.com/file/d/${fileId}/view`;
          results.push({ url, name });
        });
      }

      console.log(`Extracted ${results.length} unique files after deduplication (raw elements: ${document.querySelectorAll('[data-id]').length})`);
      return results;
    }, folderIdToExclude);

    return files;
  }

  private getDirectDownloadUrl(driveUrl: string): string {
    // Convert viewer URL to direct download URL
    const match = driveUrl.match(/\/d\/([^\/]+)\//);
    if (match) {
      const fileId = match[1];
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    return driveUrl;
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

    return `${timestamp}-drive-${index + 1}-${sanitized}`;
  }
}
