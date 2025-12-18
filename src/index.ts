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
import { loadManifest, saveManifest, updatePost, isPostComplete, getManifestStats, hasAvatar, updateAvatar } from './manifest.js';
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
  generateExternalFileFilename,
  createAvatarsDirectory,
  getAvatarFilePath,
  generateAvatarFilename
} from './file-organizer.js';
import { downloadMedia, downloadExternalLink, downloadAvatarsBatch, downloadMediaBatch } from './downloader.js';
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

      // Phase 2.5: Collect and download post author avatars from timeline
      console.log(chalk.blue(`\n   🖼️  Phase 2.5: Avatar Collection & Download\n`));

      // Collect post author avatars from timeline (we have these already)
      const authorsMap = new Map<string, string>(); // author -> avatarUrl
      const year = new Date().getFullYear().toString();

      for (const post of posts) {
        if (post.authorAvatar && post.author) {
          authorsMap.set(post.author, post.authorAvatar);
        }
      }

      console.log(chalk.gray(`   Found ${authorsMap.size} unique post authors with avatars`));

      // Filter out already downloaded avatars
      const avatarsToDownload = [];
      for (const [author, avatarUrl] of authorsMap.entries()) {
        if (!hasAvatar(manifest, author)) {
          const filename = generateAvatarFilename(author, avatarUrl);
          const filePath = getAvatarFilePath(config.outputDir, group.name, year, filename);
          avatarsToDownload.push({ author, url: avatarUrl, filePath });
        }
      }

      if (avatarsToDownload.length > 0) {
        console.log(chalk.gray(`   Downloading ${avatarsToDownload.length} new post author avatars...`));

        // Create Avatars directory
        await createAvatarsDirectory(config.outputDir, year, group.name);

        // Download avatars in batch
        const avatarResults = await downloadAvatarsBatch(avatarsToDownload, 5);

        // Update manifest with results
        for (const [author, result] of avatarResults.entries()) {
          updateAvatar(manifest, author, {
            url: authorsMap.get(author)!,
            filename: result.filename,
            status: result.success ? 'complete' : 'failed',
            error: result.error
          });
        }

        const successCount = Array.from(avatarResults.values()).filter(r => r.success).length;
        console.log(chalk.green(`   ✓ Downloaded ${successCount}/${avatarsToDownload.length} post author avatars`));
      } else {
        console.log(chalk.gray(`   All post author avatars already downloaded`));
      }

      // Track comment avatars for later batch download
      const commentAuthorsMap = new Map<string, string>(); // author -> avatarUrl

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

          // Collect comment avatars for batch download later
          if (enrichedPost.comments) {
            for (const comment of enrichedPost.comments) {
              if (comment.authorAvatar && comment.author) {
                commentAuthorsMap.set(comment.author, comment.authorAvatar);
              }
              // Also collect reply avatars
              if (comment.replies) {
                for (const reply of comment.replies) {
                  if (reply.authorAvatar && reply.author) {
                    commentAuthorsMap.set(reply.author, reply.authorAvatar);
                  }
                }
              }
            }
          }

          // STEP 2: Download media and generate markdown
          console.log(chalk.gray(`      → Creating directories...`));
          await createPostDirectories(config.outputDir, enrichedPost);

          // Download images (separate arrays for post images vs gallery images)
          // Filter out videos - they'll be handled in the video section below
          const imageFilenames = [];
          const galleryImages = []; // Track gallery images separately with source info
          const imageUrls = enrichedPost.images ? enrichedPost.images.filter(url =>
            typeof url === 'string' && !url.match(/\.(mp4|mov|avi|webm|m4v)(\?|$)/i)
          ) : [];

          if (imageUrls.length > 0) {
            console.log(chalk.gray(`      → Downloading ${imageUrls.length} images in parallel...`));

            // Prepare batch download items
            const imageBatchItems = imageUrls.map((url, j) => {
              const filename = generateMediaFilename(enrichedPost, url, 'image', j);
              const filePath = getMediaFilePath(config.outputDir, enrichedPost, filename, 'Images');
              return { url, filePath, filename };
            });

            // Download in parallel
            const imageResults = await downloadMediaBatch(imageBatchItems, { concurrency: 5 });

            // Process results
            imageResults.forEach((result, j) => {
              if (result.status === 'success') {
                imageFilenames.push(imageBatchItems[j].filename);
                downloadedImages++;
              } else {
                console.error(chalk.red(`     ✗ Failed to download image ${j + 1}: ${result.error}`));
                failedDownloads++;
              }
            });
          }

          // Download videos (extract video URLs from images array)
          const videoFilenames = [];
          const videoUrls = enrichedPost.images ? enrichedPost.images.filter(url =>
            typeof url === 'string' && url.match(/\.(mp4|mov|avi|webm|m4v)(\?|$)/i)
          ) : [];

          if (videoUrls.length > 0) {
            console.log(chalk.gray(`      → Downloading ${videoUrls.length} videos in parallel...`));

            // Prepare batch download items
            const videoBatchItems = videoUrls.map((url, j) => {
              const filename = generateMediaFilename(enrichedPost, url, 'video', j);
              const filePath = getMediaFilePath(config.outputDir, enrichedPost, filename, 'Videos');
              return { url, filePath, filename };
            });

            // Download in parallel
            const videoResults = await downloadMediaBatch(videoBatchItems, { concurrency: 5 });

            // Process results
            videoResults.forEach((result, j) => {
              if (result.status === 'success') {
                videoFilenames.push(videoBatchItems[j].filename);
                downloadedVideos++;
              } else {
                console.error(chalk.red(`     ✗ Failed to download video ${j + 1}: ${result.error}`));
                failedDownloads++;
              }
            });
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

                // Check if no downloader can handle this URL (filtered out as non-downloadable)
                if (!downloader) {
                  console.log(chalk.yellow(`     ⚠ Non-downloadable URL (web page, form, etc.): ${link.name}`));
                  failedExternalLinks.push(link);
                  continue;
                }

                // STRATEGY 1: Try gallery downloader if detected
                if (isGallery && galleriesEnabled) {
                  console.log(chalk.cyan(`         → Gallery detected: ${link.name}`));
                  const imagesDir = getMediaFilePath(config.outputDir, enrichedPost, '', 'Images').replace(/\/?$/, '');

                  try {
                    const results = await downloader.download(link.url, {
                      outputDir: imagesDir,
                      baseDir: config.outputDir,  // For getMediaFilePath calls
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
                if (!downloadSuccessful && downloader && downloader.getPriority() === 0) {
                  console.log(chalk.gray(`     → Attempting direct file download: ${link.name}`));

                  try {
                    const results = await downloader.download(link.url, {
                      outputDir: config.outputDir,
                      baseDir: config.outputDir,
                      post: enrichedPost,
                      fileIndex: j,
                      linkName: link.name,  // Pass link name for filename generation
                      page
                    });

                    // Process direct download result
                    if (results.length > 0 && results[0].status === 'success') {
                      const result = results[0];
                      downloadedExternalFiles.push({
                        name: link.name,
                        url: link.url,
                        filename: result.filename
                      });

                      const method = isGallery ? 'fallback direct download' : 'direct download';
                      console.log(chalk.green(`     ✓ Downloaded via ${method}: ${link.name}`));
                      downloadSuccessful = true;
                    } else if (results.length > 0) {
                      console.log(chalk.yellow(`     ⚠ Direct download failed: ${link.name} - ${results[0].error}`));
                    }
                  } catch (directError) {
                    console.log(chalk.yellow(`     ⚠ Direct download error: ${directError.message}`));
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

          // Get avatar filename for post author
          const avatarFilename = enrichedPost.authorAvatar
            ? generateAvatarFilename(enrichedPost.author, enrichedPost.authorAvatar)
            : null;

          const postMarkdownWithExternal = generatePostMarkdown(enrichedPost, {
            images: imageFilenames,
            videos: videoFilenames,
            downloadedExternalFiles,
            galleryImages,
            avatarFilename
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

      // Phase 4.5: Download comment avatars collected during processing
      if (commentAuthorsMap.size > 0) {
        console.log(chalk.blue(`\n   🖼️  Phase 4.5: Comment Avatar Download\n`));
        console.log(chalk.gray(`   Found ${commentAuthorsMap.size} unique comment authors with avatars`));

        // Filter out already downloaded avatars (including post authors we already downloaded)
        const commentAvatarsToDownload = [];
        for (const [author, avatarUrl] of commentAuthorsMap.entries()) {
          if (!hasAvatar(manifest, author)) {
            const filename = generateAvatarFilename(author, avatarUrl);
            const filePath = getAvatarFilePath(config.outputDir, group.name, year, filename);
            commentAvatarsToDownload.push({ author, url: avatarUrl, filePath });
          }
        }

        if (commentAvatarsToDownload.length > 0) {
          console.log(chalk.gray(`   Downloading ${commentAvatarsToDownload.length} new comment author avatars...`));

          // Download avatars in batch
          const commentAvatarResults = await downloadAvatarsBatch(commentAvatarsToDownload, 5);

          // Update manifest with results
          for (const [author, result] of commentAvatarResults.entries()) {
            updateAvatar(manifest, author, {
              url: commentAuthorsMap.get(author)!,
              filename: result.filename,
              status: result.success ? 'complete' : 'failed',
              error: result.error
            });
          }

          const commentSuccessCount = Array.from(commentAvatarResults.values()).filter(r => r.success).length;
          console.log(chalk.green(`   ✓ Downloaded ${commentSuccessCount}/${commentAvatarsToDownload.length} comment author avatars`));
        } else {
          console.log(chalk.gray(`   All comment author avatars already downloaded`));
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
