#!/usr/bin/env node

/**
 * Test Single Post - Debug script to process one post with visible browser
 *
 * Usage: npm run test-post <POST_URL>
 * Example: npm run test-post https://newmodel.handing.co/posts/3797322
 */

import chalk from 'chalk';
import { loadConfig } from './config.js';
import { initializeScraper, closeScraper, authenticate, enrichSinglePost } from './scraper.js';
import { DownloaderFactory } from './downloaders/index.js';
import {
  createPostDirectories,
  generateMediaFilename,
  generatePostFilename,
  getPostFilePath,
  getMediaFilePath,
  getExternalFilePath,
  generateExternalFileFilename
} from './file-organizer.js';
import { downloadMedia, downloadExternalLink } from './downloader.js';
import { generatePostMarkdown, writeMarkdownFile } from './markdown-writer.js';

async function testSinglePost() {
  const postUrl = process.argv[2];

  if (!postUrl) {
    console.error(chalk.red('❌ Error: Please provide a post URL'));
    console.log(chalk.gray('Usage: npm run test-post <POST_URL>'));
    console.log(chalk.gray('Example: npm run test-post https://newmodel.handing.co/posts/3797322'));
    process.exit(1);
  }

  console.log(chalk.blue.bold('\n🧪 Testing Single Post\n'));
  console.log(chalk.gray(`Post URL: ${postUrl}\n`));

  try {
    // Load configuration
    const config = await loadConfig();

    // Force non-headless mode for debugging
    config.scraping.headless = false;
    console.log(chalk.yellow('🔍 Running with VISIBLE browser for debugging\n'));

    // Initialize browser
    const { browser, page } = await initializeScraper(config);

    // Authenticate
    console.log(chalk.blue('🔐 Authenticating...\n'));
    await authenticate(page, config.email, config.password);

    // Initialize downloader factory
    const downloaderFactory = new DownloaderFactory(page);

    // Create a basic post object from URL
    const postId = postUrl.split('/').pop() || 'test';
    const basicPost = {
      id: postId,
      url: postUrl,
      title: 'Test Post',
      author: 'Unknown',
      timestamp: new Date().toISOString(),
      groupName: 'Test',
      content: '',
      images: [],
      comments: [],
      likes: 0
    };

    console.log(chalk.blue('\n📝 Step 1: Extracting full post details...\n'));
    const enrichedPost = await enrichSinglePost(page, basicPost, config);

    console.log(chalk.green('✓ Post enriched:'));
    console.log(chalk.gray(`  Title: ${enrichedPost.title || '(no title)'}`));
    console.log(chalk.gray(`  Content: ${enrichedPost.content?.length || 0} chars`));
    console.log(chalk.gray(`  Images: ${enrichedPost.images?.length || 0}`));
    console.log(chalk.gray(`  External links: ${enrichedPost.externalLinks?.length || 0}`));
    console.log(chalk.gray(`  Comments: ${enrichedPost.comments?.length || 0}\n`));

    // Create directories
    console.log(chalk.blue('📁 Step 2: Creating directories...\n'));
    await createPostDirectories(config.outputDir, enrichedPost);

    // Download images
    const imageFilenames = [];
    const galleryImages = [];

    if (enrichedPost.images && enrichedPost.images.length > 0) {
      console.log(chalk.blue(`📥 Step 3: Downloading ${enrichedPost.images.length} images...\n`));
      for (let i = 0; i < enrichedPost.images.length; i++) {
        const imageUrl = enrichedPost.images[i];
        const filename = generateMediaFilename(enrichedPost, imageUrl, 'image', i);
        const filePath = getMediaFilePath(config.outputDir, enrichedPost, filename, 'Images');

        console.log(chalk.gray(`  [${i + 1}/${enrichedPost.images.length}] ${imageUrl.substring(0, 80)}...`));
        const result = await downloadMedia(imageUrl, filePath);
        if (result.status === 'success') {
          imageFilenames.push(filename);
          console.log(chalk.green(`    ✓ Saved: ${filename}`));
        } else {
          console.log(chalk.red(`    ✗ Failed: ${result.error}`));
        }
      }
    }

    // Download external links / galleries
    const downloadedExternalFiles = [];
    const failedExternalLinks = [];

    if (enrichedPost.externalLinks && enrichedPost.externalLinks.length > 0) {
      console.log(chalk.blue(`\n🔗 Step 4: Processing ${enrichedPost.externalLinks.length} external links...\n`));

      for (let i = 0; i < enrichedPost.externalLinks.length; i++) {
        const link = enrichedPost.externalLinks[i];

        console.log(chalk.cyan(`\n  [${i + 1}/${enrichedPost.externalLinks.length}] ${link.name || link.url}`));
        console.log(chalk.gray(`  URL: ${link.url}`));

        // Check if it's a gallery
        const downloader = downloaderFactory.getDownloader(link.url);
        const isGallery = downloader && downloader.getPriority && downloader.getPriority() > 0;

        console.log(chalk.gray(`  Downloader: ${downloader ? downloader.constructor.name : 'none'}`));
        console.log(chalk.gray(`  Is gallery: ${isGallery}`));

        let downloadSuccessful = false;

        // Try gallery downloader
        if (isGallery) {
          console.log(chalk.yellow('\n  📸 Attempting gallery download (browser will navigate to gallery)...'));
          console.log(chalk.yellow('  👀 Watch the browser to see what happens!\n'));

          const imagesDir = getMediaFilePath(config.outputDir, enrichedPost, '', 'Images').replace(/\/?$/, '');

          try {
            const results = await downloader.download(link.url, {
              outputDir: imagesDir,
              post: enrichedPost,
              fileIndex: i,
              page
            });

            let successCount = 0;
            const currentGalleryImages = [];

            for (const result of results) {
              if (result.status === 'success') {
                currentGalleryImages.push(result.filename);
                successCount++;
                console.log(chalk.green(`    ✓ Downloaded: ${result.filename}`));
              } else {
                console.log(chalk.red(`    ✗ Failed: ${result.error}`));
              }
            }

            if (successCount > 0) {
              galleryImages.push({
                sourceUrl: link.url,
                sourceName: link.name,
                images: currentGalleryImages
              });
              console.log(chalk.green(`\n  ✓ Gallery download complete: ${successCount} images`));
              downloadSuccessful = true;
            } else {
              console.log(chalk.yellow('\n  ⚠ Gallery download failed (0 images)'));
            }
          } catch (error: any) {
            console.log(chalk.red(`\n  ✗ Gallery error: ${error.message}`));
          }
        }

        // Fallback to direct download
        if (!downloadSuccessful) {
          console.log(chalk.gray('\n  → Trying direct download...'));

          const tempFilename = generateExternalFileFilename(enrichedPost, link, i, 'tmp');
          const tempFilePath = getExternalFilePath(config.outputDir, enrichedPost, tempFilename);

          const result = await downloadExternalLink(link.url, tempFilePath, { timeout: 40000 });

          if (result.status === 'success') {
            const finalFilename = generateExternalFileFilename(enrichedPost, link, i, result.extension);
            const finalFilePath = getExternalFilePath(config.outputDir, enrichedPost, finalFilename);

            if (finalFilename !== tempFilename) {
              const fs = await import('fs/promises');
              await fs.rename(tempFilePath, finalFilePath);
            }

            downloadedExternalFiles.push({
              name: link.name,
              url: link.url,
              filename: finalFilename
            });

            console.log(chalk.green(`  ✓ Direct download: ${finalFilename}`));
            downloadSuccessful = true;
          } else {
            console.log(chalk.red(`  ✗ Direct download failed: ${result.error}`));
          }
        }

        if (!downloadSuccessful) {
          failedExternalLinks.push(link);
          console.log(chalk.red('  ✗ All download methods failed'));
        }
      }
    }

    // Generate markdown
    console.log(chalk.blue('\n📝 Step 5: Generating markdown...\n'));
    const markdown = generatePostMarkdown(enrichedPost, {
      images: imageFilenames,
      videos: [],
      downloadedExternalFiles,
      galleryImages
    });

    const postFilename = generatePostFilename(enrichedPost) + '.md';
    const postFilePath = getPostFilePath(config.outputDir, enrichedPost, postFilename);
    await writeMarkdownFile(postFilePath, markdown);

    console.log(chalk.green(`✓ Markdown saved: ${postFilePath}\n`));

    // Summary
    console.log(chalk.green.bold('\n✅ Test Complete!\n'));
    console.log(chalk.gray('Summary:'));
    console.log(chalk.gray(`  Post images: ${imageFilenames.length}`));
    console.log(chalk.gray(`  Gallery images: ${galleryImages.reduce((sum, g) => sum + g.images.length, 0)}`));
    console.log(chalk.gray(`  Downloaded files: ${downloadedExternalFiles.length}`));
    console.log(chalk.gray(`  Failed links: ${failedExternalLinks.length}`));
    console.log(chalk.gray(`\n  Output: ${postFilePath}\n`));

    // Close browser
    await closeScraper(browser);

  } catch (error: any) {
    console.error(chalk.red.bold('\n❌ Error:\n'));
    console.error(chalk.red(error.message));
    console.error(error.stack);
    process.exit(1);
  }
}

testSinglePost();
