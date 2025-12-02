/**
 * Google Photos Downloader
 *
 * Handles downloading images from Google Photos album links
 * Uses Playwright to extract image URLs from the JavaScript-rendered page
 */

import { Downloader, DownloadContext, DownloadResult } from '../types.js';
import { Page } from 'playwright';
import { downloadMedia } from '../downloader.js';
import { sleep, parseTimestamp } from '../utils.js';
import { extname } from 'path';

export class GooglePhotosDownloader implements Downloader {
  private page: Page | null = null;

  constructor(page?: Page) {
    this.page = page || null;
  }

  setPage(page: Page) {
    this.page = page;
  }

  canHandle(url: string): boolean {
    return url.includes('photos.app.goo.gl') ||
           url.includes('photos.google.com/share');
  }

  getPriority(): number {
    // Higher priority than direct file downloader
    return 10;
  }

  async download(url: string, context: DownloadContext): Promise<DownloadResult[]> {
    if (!this.page) {
      return [{ status: 'failed', url, error: 'No Playwright page provided' }];
    }

    try {
      console.log(`Extracting media from Google Photos album: ${url}`);
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await sleep(3000);

      console.log('🔄 Starting progressive scroll to load all media...');
      const scrollableSelector = '[jsrenderer="x3Fdbb"]';

      try {
        await this.page.waitForSelector(scrollableSelector, { timeout: 10000 });
        console.log(`  🔍 Found scrollable container: ${scrollableSelector}`);
        await this.page.hover(scrollableSelector);
      } catch (error) {
        console.log(`  ⚠️ Could not find scrollable container. Scrolling may be unreliable.`);
      }

      const allMedia = new Map<string, 'image' | 'video'>();
      let scrollAttempts = 0;
      const maxScrollAttempts = 1000;
      const scrollDelay = 2000;
      let noNewMediaCount = 0;
      const requiredConsecutiveNoNew = 25;

      while (scrollAttempts < maxScrollAttempts) {
        const sizeBefore = allMedia.size;

        const mediaInView = await this.page.evaluate(() => {
          const media: {url: string, type: 'image' | 'video'}[] = [];
          document.querySelectorAll('.rtIMgb').forEach(itemEl => {
            const linkEl = itemEl.querySelector('a.p137Zd');
            const styleEl = itemEl.querySelector('div[style*="background-image"]');
            
            if (linkEl && styleEl) {
              const ariaLabel = linkEl.getAttribute('aria-label') || '';
              const style = (styleEl as HTMLElement).style.backgroundImage;
              const match = style.match(/url\(['"]?(.*?)['"]?\)/);

              if (match && match[1] && match[1].includes('googleusercontent.com')) {
                const url = match[1];
                const type = ariaLabel.toLowerCase().includes('video') ? 'video' : 'image';
                media.push({ url, type });
              }
            }
          });
          return media;
        });

        mediaInView.forEach(m => {
          if (!allMedia.has(m.url)) {
            allMedia.set(m.url, m.type);
          }
        });

        const newCount = allMedia.size - sizeBefore;

        if (newCount > 0) {
          console.log(`  [Scroll ${scrollAttempts + 1}] +${newCount} new media → Total: ${allMedia.size} unique`);
          noNewMediaCount = 0;
        } else {
          noNewMediaCount++;
          console.log(`  [Scroll ${scrollAttempts + 1}] No new media found (${noNewMediaCount}/${requiredConsecutiveNoNew})`);
          if (noNewMediaCount >= requiredConsecutiveNoNew) {
            console.log(`\n  ✅ No new media for ${noNewMediaCount} scrolls - reached end!`);
            break;
          }
        }
        
        await this.page.mouse.wheel(0, 1000); // Gentle scroll
        await sleep(scrollDelay);
        scrollAttempts++;
      }
      console.log(`\n✅ Scrolling complete. Found ${allMedia.size} total media items.`);
      
      const mediaUrls = Array.from(allMedia.entries()).map(([u, type]) => {
        const baseUrl = u.split('=')[0];
        return { 
          url: baseUrl + (type === 'video' ? '=dv' : '=d'), 
          type
        };
      });
      
      console.log(`Found ${mediaUrls.length} unique media items after processing.`);
      
      if (mediaUrls.length === 0) {
        const html = await this.page.content();
        const debugFile = `debug-google-photos-no-media-${Date.now()}.html`;
        const fs = await import('fs/promises');
        await fs.writeFile(debugFile, html);
        console.log(`  📄 Saved empty page HTML to: ${debugFile}`);
        return [{ status: 'failed', url, error: 'No media found in album after scrolling.' }];
      }

      const results: DownloadResult[] = [];
      for (let i = 0; i < mediaUrls.length; i++) {
        const media = mediaUrls[i];
        const filename = this.generateFilename(context, i, media.type);
        const filePath = `${context.outputDir}/${filename}`;

        console.log(`Downloading ${media.type} ${i + 1}/${mediaUrls.length}...`);
        const result = await downloadMedia(media.url, filePath, { maxRetries: 3, timeout: 45000 });

        if (result.status === 'success') {
          results.push({ status: 'success', url: media.url, localPath: filePath, filename, size: result.size, sourceAlbum: url });
        } else {
          results.push({ status: 'failed', url: media.url, error: result.error, sourceAlbum: url });
        }
      }
      return results;

    } catch (error: any) {
      console.error(`Failed to extract from Google Photos album: ${error.message}`);
      return [{ status: 'failed', url, error: error.message }];
    }
  }
  
  private generateFilename(context: DownloadContext, index: number, mediaType: 'image' | 'video' = 'image'): string {
    const { post } = context;
    const date = parseTimestamp(post.timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const timestamp = `${month}-${day}-${hour}-${minute}`;
    const extension = mediaType === 'video' ? '.mp4' : '.jpg';
    return `${timestamp}-album-${mediaType}-${index + 1}${extension}`;
  }
}
