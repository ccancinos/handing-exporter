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

      // Start recursive download from root folder
      const results = await this.downloadFolderRecursively(url, '', context, 0);

      if (results.length === 0) {
        return [{
          status: 'failed',
          url,
          error: 'No files found in folder. May require authentication or folder is empty.'
        }];
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

  /**
   * Recursively download files from a folder and its subfolders
   * @param folderUrl URL of the folder to process
   * @param folderPath Relative path from root (for preserving structure)
   * @param context Download context
   * @param depth Current recursion depth (for safety)
   * @returns Array of download results
   */
  private async downloadFolderRecursively(
    folderUrl: string,
    folderPath: string,
    context: DownloadContext,
    depth: number
  ): Promise<DownloadResult[]> {
    const MAX_DEPTH = 10; // Prevent infinite recursion
    if (depth >= MAX_DEPTH) {
      console.log(`  ⚠️  Max depth (${MAX_DEPTH}) reached, skipping deeper folders`);
      return [];
    }

    const indent = '  '.repeat(depth + 1);
    console.log(`${indent}📁 Processing folder: ${folderPath || 'root'}${depth > 0 ? ` (depth ${depth})` : ''}`);

    // Navigate to the folder
    await this.page!.goto(folderUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for files to load
    await sleep(3000);

    // Scroll to load all items
    await this.scrollToLoadAll(this.page!);

    // Extract both files and subfolders
    const items = await this.extractItems(this.page!);

    console.log(`${indent}Found ${items.files.length} files and ${items.folders.length} subfolders`);

    const allResults: DownloadResult[] = [];
    let fileCounter = 1;

    // Download files in current folder
    for (const file of items.files) {
      console.log(`${indent}Downloading file ${fileCounter}/${items.files.length}: ${file.name}...`);
      fileCounter++;

      // Extract file ID from URL
      const fileIdMatch = file.url.match(/\/d\/([^\/\?]+)/);
      if (!fileIdMatch) {
        console.log(`${indent}✗ Could not extract file ID from URL: ${file.url}`);
        allResults.push({
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
      const filename = `${timestamp}-drive-${sanitizedName}`;

      // Construct file path preserving folder structure
      const baseDir = context.baseDir || context.outputDir;
      let filePath: string;

      if (folderPath) {
        // Create path with folder structure: Images/[folder-path]/filename
        const fs = await import('fs/promises');
        const path = await import('path');
        const imagesBaseDir = getMediaFilePath(baseDir, context.post, '', 'Images').replace(/\/?$/, '');
        const folderDir = path.join(imagesBaseDir, folderPath);

        // Ensure folder exists
        await fs.mkdir(folderDir, { recursive: true });

        filePath = path.join(folderDir, filename);
      } else {
        // Root level - use standard path
        filePath = getMediaFilePath(baseDir, context.post, filename);
      }

      // Construct direct download URL
      const directDownloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;

      try {
        // Use Playwright's authenticated request context with increased timeout
        const response = await this.page!.request.get(directDownloadUrl, { timeout: 120000 });

        if (response.ok()) {
          // Save the file
          const fs = await import('fs/promises');
          const buffer = await response.body();
          await fs.writeFile(filePath, buffer);

          // Get file size
          const stats = await fs.stat(filePath);
          const fileSize = stats.size;

          console.log(`${indent}✓ Downloaded: ${filename} (${this.formatBytes(fileSize)})`);

          allResults.push({
            status: 'success',
            url: file.url,
            localPath: filePath,
            filename: folderPath ? `${folderPath}/${filename}` : filename,
            size: fileSize,
            sourceName: file.name
          });
        } else {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }
      } catch (error: any) {
        console.log(`${indent}✗ Failed to download ${file.name}: ${error.message}`);
        allResults.push({
          status: 'failed',
          url: file.url,
          error: error.message
        });
      }
    }

    // Recursively process subfolders
    for (const folder of items.folders) {
      const subFolderPath = folderPath ? `${folderPath}/${folder.name}` : folder.name;
      console.log(`${indent}📂 Entering subfolder: ${folder.name}`);

      try {
        const subResults = await this.downloadFolderRecursively(
          folder.url,
          subFolderPath,
          context,
          depth + 1
        );
        allResults.push(...subResults);
      } catch (error: any) {
        console.log(`${indent}✗ Failed to process subfolder ${folder.name}: ${error.message}`);
      }
    }

    return allResults;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Progressively scroll and collect unique item IDs until no new items appear
   * Similar to Google Photos downloader approach - uses mouse wheel events
   */
  private async scrollToLoadAll(page: Page) {
    console.log('🔄 Starting progressive scroll to load all items...');

    // Try to find and hover over the scrollable container
    // Google Drive typically uses [role="main"] as the scrollable area
    const scrollableSelector = '[role="main"]';
    try {
      await page.waitForSelector(scrollableSelector, { timeout: 5000 });
      console.log(`  🔍 Found scrollable container: ${scrollableSelector}`);
      await page.hover(scrollableSelector);
      await sleep(500);
    } catch (error) {
      console.log(`  ⚠️ Could not find scrollable container. Scrolling may be unreliable.`);
    }

    const allItemIds = new Set<string>();
    let scrollAttempts = 0;
    const maxScrollAttempts = 1000;
    const scrollDelay = 2000; // 2 seconds between scrolls
    let noNewItemsCount = 0;
    const requiredConsecutiveNoNew = 25; // Require 25 scrolls with no new items before stopping

    while (scrollAttempts < maxScrollAttempts) {
      const sizeBefore = allItemIds.size;

      // Extract all current item IDs from the page
      const itemIdsInView = await page.evaluate(() => {
        const ids: string[] = [];
        const itemRows = document.querySelectorAll('[data-id][role="row"]');

        itemRows.forEach((el: any) => {
          const itemId = el.dataset?.id || el.getAttribute('data-id');
          // Apply same validation as extractItems()
          if (itemId &&
              itemId.length >= 10 &&
              itemId.length <= 50 &&
              !itemId.startsWith('_') &&
              !itemId.startsWith('-') &&
              !itemId.includes(' ') &&
              /^[a-zA-Z0-9_-]{10,50}$/.test(itemId)) {
            ids.push(itemId);
          }
        });

        return ids;
      });

      // Add newly found IDs to the set
      itemIdsInView.forEach(id => allItemIds.add(id));

      const newCount = allItemIds.size - sizeBefore;

      if (newCount > 0) {
        console.log(`  [Scroll ${scrollAttempts + 1}] +${newCount} new items → Total: ${allItemIds.size} unique`);
        noNewItemsCount = 0;
      } else {
        noNewItemsCount++;
        console.log(`  [Scroll ${scrollAttempts + 1}] No new items found (${noNewItemsCount}/${requiredConsecutiveNoNew})`);

        if (noNewItemsCount >= requiredConsecutiveNoNew) {
          console.log(`\n  ✅ No new items for ${noNewItemsCount} scrolls - reached end!`);
          break;
        }
      }

      // Use mouse wheel to scroll (more reliable for lazy loading)
      // Try multiple scroll methods to ensure compatibility
      await page.mouse.wheel(0, 1000); // Mouse wheel scroll

      // Also try direct scrollTop as backup
      await page.evaluate(() => {
        const scrollable = document.querySelector('[role="main"]') || document.body;
        scrollable.scrollTop = scrollable.scrollHeight;
      });

      await sleep(scrollDelay);
      scrollAttempts++;
    }

    console.log(`\n✅ Scrolling complete. Found ${allItemIds.size} total unique items after ${scrollAttempts} scrolls.`);
  }

  /**
   * Extract both files and folders from the current page
   * Returns separated lists of files and folders
   */
  private async extractItems(page: Page): Promise<{
    files: Array<{ url: string; name: string }>;
    folders: Array<{ url: string; name: string }>;
    debugInfo: string[];
  }> {
    // Extract folder ID from URL to filter it out
    const currentUrl = page.url();
    const folderIdMatch = currentUrl.match(/folders\/([^/?]+)/);
    const folderIdToExclude = folderIdMatch ? folderIdMatch[1] : null;

    const items = await page.evaluate((currentFolderId) => {
      const files: Array<{ url: string; name: string }> = [];
      const folders: Array<{ url: string; name: string }> = [];
      const seenIds = new Set<string>(); // Deduplication
      const debugInfo: string[] = []; // Collect debug info to return

      // Google Drive uses [data-id] on items with [role="row"] for list view
      const itemRows = document.querySelectorAll('[data-id][role="row"]');

      itemRows.forEach((el: any) => {
        const itemId = el.dataset?.id || el.getAttribute('data-id');

        // Validation
        if (!itemId) return;
        if (itemId.length < 10) return; // Too short
        if (itemId === currentFolderId) return; // Don't include current folder itself
        if (itemId.startsWith('_') || itemId.startsWith('-')) return; // System elements
        if (itemId.includes(' ')) return; // Invalid character
        if (!/^[a-zA-Z0-9_-]{10,50}$/.test(itemId)) return; // Pattern validation
        if (seenIds.has(itemId)) return; // Already seen

        // Extract name from various possible locations
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

        // Use item ID as fallback only if we couldn't find a name
        if (!name) {
          name = `item-${itemId}`;
        }

        // IMPROVED FOLDER DETECTION
        // Strategy 1: Check for folder-specific attributes and elements
        const hasDataTarget = el.getAttribute('data-target') === 'folder';
        const hasDataType = el.getAttribute('data-type') === 'folder';

        // Check aria-label on the row AND all child elements (Google Drive puts it on child divs)
        let ariaLabelHasFolder = false;
        const rowAriaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        if (rowAriaLabel.includes('folder') || rowAriaLabel.includes('carpeta')) {
          ariaLabelHasFolder = true;
        } else {
          // Check all descendants with aria-label
          const elementsWithAriaLabel = el.querySelectorAll('[aria-label]');
          for (let i = 0; i < elementsWithAriaLabel.length; i++) {
            const childAriaLabel = (elementsWithAriaLabel[i].getAttribute('aria-label') || '').toLowerCase();
            if (childAriaLabel.includes('folder') || childAriaLabel.includes('carpeta')) {
              ariaLabelHasFolder = true;
              break;
            }
          }
        }

        // Strategy 2: Check for folder icon SVG
        // Google Drive folder icon typically has specific SVG path or uses Material Icons
        const hasFolderIcon = !!(
          el.querySelector('svg[data-icon-name="Folder"]') ||
          el.querySelector('svg.folder-icon') ||
          el.querySelector('[data-icon="folder"]') ||
          // Material Icons folder classes
          el.querySelector('svg path[d*="M10 4H4c-1"]') || // Common folder icon path
          el.querySelector('[class*="folder"]') ||
          el.querySelector('img[src*="folder"]')
        );

        // Strategy 3: Check CSS classes
        const hasClassFolder = el.className.toLowerCase().includes('folder');

        // Strategy 4: Check ALL links in the row (more aggressive search)
        const allLinks = el.querySelectorAll('a');
        let linkGoesToFolder = false;
        let foundHref = '';
        for (let i = 0; i < allLinks.length; i++) {
          const href = allLinks[i].getAttribute('href') || '';
          if (href.includes('drive.google.com') || href.includes('/folders/') || href.includes('/file/')) {
            foundHref = href;
            if (href.includes('/folders/')) {
              linkGoesToFolder = true;
              break;
            }
          }
        }

        // Strategy 5: Check for MIME type attributes (folders have application/vnd.google-apps.folder)
        const mimeType = el.getAttribute('data-mime-type') ||
                        el.getAttribute('data-type') ||
                        el.querySelector('[data-mime-type]')?.getAttribute('data-mime-type');
        const hasFolderMimeType = mimeType && mimeType.includes('folder');

        // Strategy 6: Check the actual href in the row - folders link to /folders/, files to /file/d/
        const rowHref = el.getAttribute('href') ||
                       foundHref ||
                       '';
        const hrefIndicatesFolder = rowHref.includes('/folders/');

        // Strategy 7: Check if the item ID appears in a folders URL pattern
        // Google Drive folder IDs are used in folder URLs
        const folderUrlPattern = allLinks.length > 0 && Array.from(allLinks).some((link: any) => {
          const href = link.getAttribute('href') || '';
          return href.includes(`/folders/${itemId}`);
        });

        // Combine all strategies
        const isFolder = hasDataTarget ||
                        hasDataType ||
                        ariaLabelHasFolder ||
                        hasFolderIcon ||
                        hasClassFolder ||
                        linkGoesToFolder ||
                        hasFolderMimeType ||
                        hrefIndicatesFolder ||
                        folderUrlPattern;

        // Debug logging for ALL items (need to see both to understand the pattern)
        debugInfo.push(`\nItem ${seenIds.size + 1}: "${name}" (ID: ${itemId})`);
        debugInfo.push(`  - hasDataTarget: ${hasDataTarget}`);
        debugInfo.push(`  - hasDataType: ${hasDataType}`);
        debugInfo.push(`  - ariaLabelHasFolder: ${ariaLabelHasFolder}`);
        debugInfo.push(`  - hasFolderIcon: ${hasFolderIcon}`);
        debugInfo.push(`  - linkGoesToFolder: ${linkGoesToFolder}`);
        debugInfo.push(`  - hasFolderMimeType: ${hasFolderMimeType} (mime: ${mimeType})`);
        debugInfo.push(`  - hrefIndicatesFolder: ${hrefIndicatesFolder} (href: ${rowHref})`);
        debugInfo.push(`  - folderUrlPattern: ${folderUrlPattern}`);
        debugInfo.push(`  - foundHref from links: ${foundHref}`);
        debugInfo.push(`  - allLinks.length: ${allLinks.length}`);
        debugInfo.push(`  - FINAL: ${isFolder ? 'FOLDER' : 'FILE'}`);

        seenIds.add(itemId);

        if (isFolder) {
          const url = `https://drive.google.com/drive/folders/${itemId}`;
          folders.push({ url, name });
        } else {
          const url = `https://drive.google.com/file/d/${itemId}/view`;
          files.push({ url, name });
        }
      });

      return { files, folders, debugInfo };
    }, folderIdToExclude);

    // Log debug info
    if (items.debugInfo && items.debugInfo.length > 0) {
      console.log('\n=== DEBUG: Item Detection ===');
      items.debugInfo.forEach(line => console.log(line));
      console.log('=== END DEBUG ===\n');
    }

    return items;
  }
}
