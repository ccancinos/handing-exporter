/**
 * Google Drive Folder Downloader
 *
 * Handles downloading files from Google Drive folder links
 * Folders typically contain images/videos and are saved to Images directory
 * Downloads files directly using file IDs without visiting individual file pages
 */

import { Downloader, DownloadContext, DownloadResult } from '../types.js';
import { Page } from 'playwright';
import { sleep, parseTimestamp } from '../utils.js';
import { getMediaFilePath } from '../file-organizer.js';

export class GoogleDriveFolderDownloader implements Downloader {
  private page: Page | null = null;

  constructor(page?: Page) {
    this.page = page || null;
  }

  setPage(page: Page) {
    this.page = page;
  }

  canHandle(url: string): boolean {
    return url.includes('drive.google.com/drive/folders') ||
           url.includes('drive.google.com/drive/u/');
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
        error: 'No Playwright page provided to GoogleDriveFolderDownloader'
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

      // Download each file directly using file ID (no need to visit individual pages)
      const results: DownloadResult[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Downloading file ${i + 1}/${files.length}: ${file.name}...`);

        // Extract file ID from URL
        const fileIdMatch = file.url.match(/\/d\/([^\/\?]+)/);
        if (!fileIdMatch) {
          console.log(`  ✗ Could not extract file ID from URL: ${file.url}`);
          results.push({
            status: 'failed',
            url: file.url,
            error: 'Could not extract file ID from URL'
          });
          continue;
        }
        const fileId = fileIdMatch[1];

        // Generate filename with timestamp
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '-').substring(0, 100);
        const date = parseTimestamp(context.post.timestamp);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const timestamp = `${month}-${day}-${hour}-${minute}`;
        const filename = `${timestamp}-drive-${i + 1}-${sanitizedName}`;

        // Use getMediaFilePath to auto-route based on file extension
        const baseDir = context.baseDir || context.outputDir;
        const filePath = getMediaFilePath(baseDir, context.post, filename);

        // Construct direct download URL
        const directDownloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;

        try {
          // Use Playwright's authenticated request context
          const response = await this.page!.request.get(directDownloadUrl);

          if (response.ok()) {
            // Save the file
            const fs = await import('fs/promises');
            const buffer = await response.body();
            await fs.writeFile(filePath, buffer);

            // Get file size
            const stats = await fs.stat(filePath);
            const fileSize = stats.size;

            console.log(`  ✓ Downloaded: ${filename} (${this.formatBytes(fileSize)})`);

            results.push({
              status: 'success',
              url: file.url,
              localPath: filePath,
              filename,
              size: fileSize,
              sourceName: file.name
            });
          } else {
            throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
          }
        } catch (error: any) {
          console.log(`  ✗ Failed to download ${file.name}: ${error.message}`);
          results.push({
            status: 'failed',
            url: file.url,
            error: error.message
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

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
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
}
