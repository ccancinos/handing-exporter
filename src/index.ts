#!/usr/bin/env node

/**
 * Handing Backup - Main Entry Point
 *
 * Orchestrates the entire backup process:
 * 1. Load configuration
 * 2. Authenticate with Handing
 * 3. Navigate through groups
 * 4. Extract posts and media
 * 5. Download and organize content
 * 6. Generate markdown files
 */

import chalk from 'chalk';
import { writeFile } from 'fs/promises';
import { loadConfig } from './config.js';
import { loadManifest, saveManifest, updatePost, isPostComplete, getManifestStats } from './manifest.js';
import {
  initializeScraper,
  closeScraper,
  authenticate,
  navigateToGroup,
  extractAllPosts,
  enrichSinglePost
} from './scraper.js';
import {
  createPostDirectories,
  generateMediaFilename,
  generatePostFilename,
  getPostFilePath,
  getMediaFilePath,
  getExternalLinksFilePath,
  getExternalFilePath,
  generateExternalFileFilename
} from './file-organizer.js';
import { downloadMedia, downloadExternalLink } from './downloader.js';
import { DownloaderFactory } from './downloaders/index.js';
import {
  generatePostMarkdown,
  generateExternalLinksMarkdown,
  writeMarkdownFile
} from './markdown-writer.js';

async function main() {
  console.log(chalk.blue.bold('\n🚀 Handing Backup Tool\n'));

  try {
    // Load configuration
    console.log(chalk.gray('Loading configuration...'));
    const config = await loadConfig();

    console.log(chalk.gray(`Found ${config.groups.length} group(s) to backup:\n`));
    for (const group of config.groups) {
      console.log(chalk.gray(`  - ${group.name}`));
    }
    console.log();

    // Initialize Playwright browser
    console.log(chalk.gray('Initializing browser...'));
    const { browser, page } = await initializeScraper(config);

    // Authenticate
    console.log(chalk.blue('\n🔐 Authenticating...\n'));
    await authenticate(page, config.email, config.password);

    // Initialize downloader factory for gallery downloads
    const downloaderFactory = new DownloaderFactory(page);
    console.log(chalk.gray('Gallery downloaders initialized'));

    // Process each group
    for (const group of config.groups) {
      console.log(chalk.blue.bold(`\n📂 Processing group: ${group.name}`));
      console.log(chalk.gray(`   URL: ${group.url}\n`));

      // Load manifest for this group
      const manifest = await loadManifest(group.name);
      console.log(chalk.gray(`   Loaded manifest (${manifest.metadata.total_posts} posts tracked)`));

      // Navigate to group timeline
      await navigateToGroup(page, group);

      // Extract all posts with pagination (Phase 1 + 2)
      const posts = await extractAllPosts(page, config, group.url);

      // Add groupName to each post
      posts.forEach(post => {
        post.groupName = group.name;
      });

      // Log extracted posts from timeline
      console.log(chalk.green(`\n   📊 Phase 1 & 2 Complete:`));
      console.log(chalk.gray(`   Total posts from timeline: ${posts.length}`));

      // Show manifest stats
      const stats = getManifestStats(manifest);
      console.log(chalk.gray(`   Already processed: ${stats.complete} posts`));
      console.log(chalk.gray(`   Failed (will retry): ${stats.failed} posts`));
      console.log(chalk.gray(`   Remaining: ${posts.length - stats.complete} posts\n`));

      // Phase 3-4 COMBINED: Streaming orchestration (enrich + download + generate immediately)
      console.log(chalk.blue(`\n   📝 Phase 3-4: Processing Posts (Streaming)...\n`));

      let processedCount = 0;
      let skippedCount = 0;
      let downloadedImages = 0;
      let downloadedVideos = 0;
      let failedDownloads = 0;
      const failedPosts = [];

      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];

        // Resume logic: Skip already completed posts (but verify file exists)
        if (isPostComplete(manifest, post.id)) {
          // Verify the markdown file actually exists
          const manifestPost = manifest.posts[post.id];
          if (manifestPost.markdown_path) {
            const fs = await import('fs/promises');
            try {
              await fs.access(manifestPost.markdown_path);
              // File exists, safe to skip
              skippedCount++;
              console.log(chalk.gray(`   [${i + 1}/${posts.length}] ✓ Skipping completed: ${post.title || post.id}`));
              continue;
            } catch (err) {
              // File doesn't exist, need to re-process
              console.log(chalk.yellow(`   [${i + 1}/${posts.length}] ⚠ Manifest says complete but file missing, re-processing...`));
            }
          }
        }

        processedCount++;
        console.log(chalk.blue(`\n   📝 [${i + 1}/${posts.length}] Processing: ${post.title || post.id}`));

        try {
          // STEP 1: Enrich post with full details
          console.log(chalk.gray(`      → Extracting full post details...`));
          const enrichedPost = await enrichSinglePost(page, post, config);
          console.log(chalk.green(`      ✓ Extracted content (${enrichedPost.content?.length || 0} chars)`));
          console.log(chalk.gray(`      ✓ Found ${enrichedPost.comments?.length || 0} comments`));
          console.log(chalk.gray(`      ✓ Found ${enrichedPost.externalLinks?.length || 0} external links`));

          // STEP 2: Download media and generate markdown
          console.log(chalk.gray(`      → Creating directories...`));
          await createPostDirectories(config.outputDir, enrichedPost);

          // Download images (separate arrays for post images vs gallery images)
          const imageFilenames = [];
          const galleryImages = []; // Track gallery images separately with source info
          if (enrichedPost.images && enrichedPost.images.length > 0) {
            console.log(chalk.gray(`      → Downloading ${enrichedPost.images.length} images...`));
          }
          for (let j = 0; j < enrichedPost.images.length; j++) {
            const imageUrl = enrichedPost.images[j];
            const filename = generateMediaFilename(enrichedPost, imageUrl, 'image', j);
            const filePath = getMediaFilePath(config.outputDir, enrichedPost, filename, 'Images');

            const result = await downloadMedia(imageUrl, filePath);
            if (result.status === 'success') {
              imageFilenames.push(filename);
              downloadedImages++;
            } else {
              console.error(chalk.red(`     ✗ Failed to download image ${i + 1}: ${result.error}`));
              failedDownloads++;
            }
          }

          // Download videos (extract video URLs from images array)
          const videoFilenames = [];
          const videoUrls = enrichedPost.images.filter(url =>
            typeof url === 'string' && url.match(/\.(mp4|mov|avi|webm|m4v)(\?|$)/i)
          );

          if (videoUrls.length > 0) {
            console.log(chalk.gray(`      → Downloading ${videoUrls.length} videos...`));
          }
          for (let j = 0; j < videoUrls.length; j++) {
            const videoUrl = videoUrls[j];
            const filename = generateMediaFilename(enrichedPost, videoUrl, 'video', j);
            const filePath = getMediaFilePath(config.outputDir, enrichedPost, filename, 'Videos');

            const result = await downloadMedia(videoUrl, filePath);
            if (result.status === 'success') {
              videoFilenames.push(filename);
              downloadedVideos++;
            } else {
              console.error(chalk.red(`     ✗ Failed to download video ${i + 1}: ${result.error}`));
              failedDownloads++;
            }
          }

          // Download external links (including galleries) with deduplication
          const downloadedExternalFiles = [];
          const failedExternalLinks = [];
          const processedUrls = new Set(); // Track URLs we've already processed (safety net)

          if (enrichedPost.externalLinks && enrichedPost.externalLinks.length > 0) {
            console.log(chalk.gray(`      → Downloading ${enrichedPost.externalLinks.length} external links/galleries...`));

            for (let j = 0; j < enrichedPost.externalLinks.length; j++) {
              const link = enrichedPost.externalLinks[j];

              // Skip if we've already processed this URL (deduplication safety net)
              if (processedUrls.has(link.url)) {
                console.log(chalk.gray(`     → Skipping duplicate URL: ${link.name}`));
                continue;
              }
              processedUrls.add(link.url);

              try {
                // Check if this is a gallery link and galleries are enabled
                const downloader = downloaderFactory.getDownloader(link.url);
                const isGallery = downloader && downloader.getPriority && downloader.getPriority() > 0;
                const galleriesEnabled = config.downloaders?.enableGalleries !== false;
                let downloadSuccessful = false;

                // DEBUG: Log downloader detection
                console.log(chalk.gray(`     → Analyzing link: ${link.url}`));
                console.log(chalk.gray(`       Downloader: ${downloader ? downloader.constructor.name : 'null'}`));
                console.log(chalk.gray(`       Is gallery: ${isGallery}`));
                console.log(chalk.gray(`       Galleries enabled: ${galleriesEnabled}`));

                // STRATEGY 1: Try gallery downloader if detected
                if (isGallery && galleriesEnabled) {
                  console.log(chalk.cyan(`         → Gallery detected: ${link.name}`));
                  const imagesDir = getMediaFilePath(config.outputDir, enrichedPost, '', 'Images').replace(/\/?$/, '');

                  try {
                    const results = await downloader.download(link.url, {
                      outputDir: imagesDir,
                      post: enrichedPost,
                      fileIndex: j,
                      page
                    });

                    // Process gallery results - add to separate galleryImages array
                    let successCount = 0;
                    const currentGalleryImages = [];
                    for (const result of results) {
                      if (result.status === 'success') {
                        downloadedImages++;
                        currentGalleryImages.push(result.filename);
                        successCount++;
                        console.log(chalk.green(`       ✓ Downloaded from gallery: ${result.filename}`));
                      } else {
                        console.log(chalk.yellow(`       ⚠ Failed: ${result.error}`));
                      }
                    }

                    if (successCount > 0) {
                      // Add gallery with its source URL and images
                      galleryImages.push({
                        sourceUrl: link.url,
                        sourceName: link.name,
                        images: currentGalleryImages
                      });
                      console.log(chalk.green(`     ✓ Gallery downloaded: ${successCount} images from ${link.name}`));
                      downloadSuccessful = true;
                    } else {
                      console.log(chalk.yellow(`     ⚠ Gallery extraction failed, will try direct download as fallback...`));
                    }
                  } catch (galleryError) {
                    console.log(chalk.yellow(`     ⚠ Gallery downloader error: ${galleryError.message}`));
                    console.log(chalk.gray(`     → Attempting fallback to direct file download...`));
                  }
                }

                // STRATEGY 2: Try direct file download (as primary or fallback)
                if (!downloadSuccessful) {
                  const tempFilename = generateExternalFileFilename(enrichedPost, link, j, 'tmp');
                  const tempFilePath = getExternalFilePath(config.outputDir, enrichedPost, tempFilename);

                  const result = await downloadExternalLink(link.url, tempFilePath, { timeout: 40000 });

                  if (result.status === 'success') {
                    const finalFilename = generateExternalFileFilename(enrichedPost, link, j, result.extension);
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

                    const method = isGallery ? 'fallback direct download' : 'direct download';
                    console.log(chalk.green(`     ✓ Downloaded via ${method}: ${link.name} (${result.extension})`));
                    downloadSuccessful = true;
                  } else {
                    console.log(chalk.yellow(`     ⚠ Direct download failed: ${link.name} - ${result.error}`));
                  }
                }

                // FINAL: Mark as failed if all strategies failed
                if (!downloadSuccessful) {
                  failedExternalLinks.push(link);
                  console.log(chalk.red(`     ✗ All download strategies failed for: ${link.name}`));
                }

              } catch (error) {
                failedExternalLinks.push(link);
                console.log(chalk.red(`     ✗ Unexpected error downloading: ${link.name} - ${error.message}`));
              }
            }
          }

          // STEP 3: Generate markdown files
          console.log(chalk.gray(`      → Generating markdown...`));
          const postMarkdownWithExternal = generatePostMarkdown(enrichedPost, {
            images: imageFilenames,
            videos: videoFilenames,
            downloadedExternalFiles,
            galleryImages
          });

          const postFilename = generatePostFilename(enrichedPost) + '.md';
          const postFilePath = getPostFilePath(config.outputDir, enrichedPost, postFilename);
          await writeMarkdownFile(postFilePath, postMarkdownWithExternal);
          console.log(chalk.green(`      ✓ Markdown saved: ${postFilename}`));

          // Generate external links file only for failed downloads
          if (failedExternalLinks.length > 0) {
            const linksMarkdown = generateExternalLinksMarkdown(enrichedPost, failedExternalLinks);
            const linksFilename = `${postFilename.replace('.md', '')}-links.md`;
            const linksFilePath = getExternalLinksFilePath(config.outputDir, enrichedPost, linksFilename);
            await writeMarkdownFile(linksFilePath, linksMarkdown);
            console.log(chalk.yellow(`      ⚠ Failed links file: ${linksFilename}`));
          }

          // STEP 4: Update manifest immediately (streaming!)
          updatePost(manifest, enrichedPost.id, {
            title: enrichedPost.title,
            url: enrichedPost.url,
            markdown_path: postFilePath,
            images_count: imageFilenames.length + galleryImages.reduce((sum, g) => sum + g.images.length, 0),
            videos_count: videoFilenames.length,
            external_links_count: enrichedPost.externalLinks?.length || 0,
            status: 'complete'
          });
          await saveManifest(group.name, manifest);

          console.log(chalk.green(`\n   ✅ [${i + 1}/${posts.length}] Completed: ${enrichedPost.title || enrichedPost.id}\n`));

        } catch (error: any) {
          console.error(chalk.red(`\n   ❌ [${i + 1}/${posts.length}] Failed: ${post.title || post.id}`));
          console.error(chalk.red(`      Error: ${error.message}\n`));

          // Mark as failed in manifest
          updatePost(manifest, post.id, {
            title: post.title,
            url: post.url,
            status: 'failed',
            error: error.message
          });
          await saveManifest(group.name, manifest);

          // Capture debug info
          failedPosts.push({
            postId: post.id,
            postUrl: post.url,
            error: error.message,
            errorStack: error.stack,
            postData: post
          });

          // Continue to next post (don't crash)
          continue;
        }
      }

      // Summary
      console.log(chalk.green(`\n   📊 Phase 3-4 Complete:`));
      console.log(chalk.gray(`   Total posts: ${posts.length}`));
      console.log(chalk.gray(`   Skipped (already complete): ${skippedCount}`));
      console.log(chalk.gray(`   Processed: ${processedCount}`));
      console.log(chalk.gray(`   Failed: ${failedPosts.length}`));
      console.log(chalk.gray(`   Downloaded: ${downloadedImages} images, ${downloadedVideos} videos`));

      // Save debug file if there were failures
      if (failedPosts.length > 0) {
        const debugFile = `debug-failed-posts-${group.name}-${Date.now()}.json`;
        await writeFile(debugFile, JSON.stringify(failedPosts, null, 2));
        console.log(chalk.yellow(`\n   ⚠️  ${failedPosts.length} posts failed - debug info: ${debugFile}`));
      }
      console.log();
    }

    // Cleanup
    await closeScraper(browser);

    console.log(chalk.green.bold('\n✅ Backup completed successfully!\n'));

  } catch (error) {
    console.error(chalk.red.bold('\n❌ Error during backup:'));
    console.error(chalk.red(error.message));
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
