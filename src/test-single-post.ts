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
  generateExternalFileFilename,
  createAvatarsDirectory,
  generateAvatarFilename,
  getAvatarFilePath,
  getRelativeAvatarPath
} from './file-organizer.js';
import { downloadMedia, downloadExternalLink, downloadAvatar, downloadMediaBatch } from './downloader.js';
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
    console.log(chalk.gray(`  Author: ${enrichedPost.author}`));
    console.log(chalk.gray(`  Author role: ${enrichedPost.authorRole || '(none)'}`));
    console.log(chalk.gray(`  Author avatar: ${enrichedPost.authorAvatar ? 'yes' : 'no'}`));
    console.log(chalk.gray(`  Content: ${enrichedPost.content?.length || 0} chars`));
    console.log(chalk.gray(`  Images: ${enrichedPost.images?.length || 0}`));
    console.log(chalk.gray(`  External links: ${enrichedPost.externalLinks?.length || 0}`));
    console.log(chalk.gray(`  Comments: ${enrichedPost.comments?.length || 0}\n`));

    // Step 1.5: Download avatars
    let postAuthorAvatarFilename = null;
    const commentAuthorsMap = new Map<string, string>();

    // Collect all avatar URLs
    if (enrichedPost.authorAvatar) {
      commentAuthorsMap.set(enrichedPost.author, enrichedPost.authorAvatar);
    }

    // Collect comment avatars
    if (enrichedPost.comments) {
      for (const comment of enrichedPost.comments) {
        if (comment.authorAvatar && comment.author) {
          commentAuthorsMap.set(comment.author, comment.authorAvatar);
        }
        if (comment.replies) {
          for (const reply of comment.replies) {
            if (reply.authorAvatar && reply.author) {
              commentAuthorsMap.set(reply.author, reply.authorAvatar);
            }
          }
        }
      }
    }

    if (commentAuthorsMap.size > 0) {
      console.log(chalk.blue(`🖼️  Step 1.5: Downloading ${commentAuthorsMap.size} avatar(s)...\n`));

      const year = new Date().getFullYear().toString();
      await createAvatarsDirectory(config.outputDir, year, enrichedPost.groupName);

      for (const [author, avatarUrl] of commentAuthorsMap.entries()) {
        const avatarFilename = generateAvatarFilename(author, avatarUrl);
        const avatarPath = getAvatarFilePath(config.outputDir, enrichedPost.groupName, year, avatarFilename);

        console.log(chalk.gray(`  ${author}...`));
        const result = await downloadAvatar(avatarUrl, avatarPath);

        if (result.success) {
          console.log(chalk.green(`    ✓ Saved: ${avatarFilename}`));

          // Track post author's avatar filename for markdown generation
          if (author === enrichedPost.author) {
            postAuthorAvatarFilename = avatarFilename;
          }
        } else {
          console.log(chalk.red(`    ✗ Failed: ${result.error}`));
        }
      }
      console.log();
    }

    // Create directories
    console.log(chalk.blue('📁 Step 2: Creating directories...\n'));
    await createPostDirectories(config.outputDir, enrichedPost);

    // Download images
    const imageFilenames = [];
    const galleryImages = [];

    if (enrichedPost.images && enrichedPost.images.length > 0) {
      console.log(chalk.blue(`📥 Step 3: Downloading ${enrichedPost.images.length} images/videos in parallel...\n`));

      // Prepare batch download items
      const mediaBatchItems = enrichedPost.images.map((url, i) => {
        const filename = generateMediaFilename(enrichedPost, url, 'image', i);
        const filePath = getMediaFilePath(config.outputDir, enrichedPost, filename);
        return { url, filePath, filename };
      });

      // Download in parallel
      const mediaResults = await downloadMediaBatch(mediaBatchItems, { concurrency: 5 });

      // Process results
      mediaResults.forEach((result, i) => {
        if (result.status === 'success') {
          imageFilenames.push(mediaBatchItems[i].filename);
          console.log(chalk.green(`  ✓ [${i + 1}/${enrichedPost.images.length}] Saved: ${mediaBatchItems[i].filename}`));
        } else {
          console.log(chalk.red(`  ✗ [${i + 1}/${enrichedPost.images.length}] Failed: ${result.error}`));
        }
      });
    }

    // Download external links / galleries
    const downloadedExternalFiles = [];
    const failedExternalLinks = [];

    if (enrichedPost.externalLinks && enrichedPost.externalLinks.length > 0) {
      console.log(chalk.blue(`\n🔗 Step 4: Processing ${enrichedPost.externalLinks.length} external links...\n`));

      for (let i = 0; i < enrichedPost.externalLinks.length; i++) {
        const link = enrichedPost.externalLinks[i];

        // Skip non-downloadable URL schemes (mailto, tel, etc.)
        if (link.url.match(/^(mailto|tel|sms|skype):/i)) {
          console.log(chalk.gray(`\n  ⚠ Skipping non-downloadable URL scheme: ${link.url.split(':')[0]}://`));
          continue;
        }

        console.log(chalk.cyan(`\n  [${i + 1}/${enrichedPost.externalLinks.length}] ${link.name || link.url}`));
        console.log(chalk.gray(`  URL: ${link.url}`));

        // Check if we have a specialized downloader
        const downloader = downloaderFactory.getDownloader(link.url);
        const hasSpecializedDownloader = downloader && downloader.getPriority && downloader.getPriority() > 0;
        const downloaderName = downloader ? downloader.constructor.name : 'none';

        console.log(chalk.gray(`  Downloader: ${downloaderName}`));

        // Determine if this is a folder/gallery (goes to Images) or individual file (goes to External_Files)
        const isFolderDownload = downloaderName === 'GoogleDriveFolderDownloader' ||
                                 downloaderName === 'GooglePhotosDownloader';
        const isFileDownload = downloaderName === 'GoogleDriveFileDownloader';

        let downloadSuccessful = false;

        // Try specialized downloader
        if (hasSpecializedDownloader) {
          if (isFolderDownload) {
            console.log(chalk.yellow('\n  📸 Attempting gallery/folder download (browser will navigate)...'));
            console.log(chalk.yellow('  👀 Watch the browser to see what happens!\n'));
          } else if (isFileDownload) {
            console.log(chalk.yellow('\n  📄 Attempting file download from Google Drive...\n'));
          }

          // Get base directory path (without specific media type folder)
          // Downloaders will determine correct subdirectory (Images/Videos/External_Files) per file
          const baseMediaPath = getMediaFilePath(config.outputDir, enrichedPost, '', 'Images')
            .replace(/\/Images\/?$/, '');  // Remove /Images suffix to get base path

          try {
            const results = await downloader.download(link.url, {
              outputDir: baseMediaPath,  // Base path, downloader determines specific folder
              baseDir: config.outputDir,  // For getMediaFilePath calls
              post: enrichedPost,
              fileIndex: i,
              page
            });

            let successCount = 0;
            const currentGalleryImages = [];

            for (const result of results) {
              if (result.status === 'success') {
                successCount++;
                console.log(chalk.green(`    ✓ Downloaded: ${result.filename}`));

                // Add to appropriate category based on downloader type
                if (isFolderDownload) {
                  currentGalleryImages.push(result.filename);
                } else if (isFileDownload) {
                  downloadedExternalFiles.push({
                    name: link.name,
                    url: link.url,
                    filename: result.filename
                  });
                }
              } else {
                console.log(chalk.red(`    ✗ Failed: ${result.error}`));
              }
            }

            if (successCount > 0) {
              if (isFolderDownload) {
                galleryImages.push({
                  sourceUrl: link.url,
                  sourceName: link.name,
                  images: currentGalleryImages
                });
                console.log(chalk.green(`\n  ✓ Gallery/folder download complete: ${successCount} files`));
              } else {
                console.log(chalk.green(`\n  ✓ File download complete`));
              }
              downloadSuccessful = true;
            } else {
              console.log(chalk.yellow('\n  ⚠ Download failed (0 files)'));
            }
          } catch (error: any) {
            console.log(chalk.red(`\n  ✗ Download error: ${error.message}`));
          }
        }

        // Check if no downloader can handle this URL (filtered out as non-downloadable)
        if (!downloader) {
          console.log(chalk.yellow('\n  ⚠ Non-downloadable URL (web page, form, etc.) - skipping'));
          failedExternalLinks.push(link);
          continue;
        }

        // Try direct file download (DirectFileDownloader with priority 0)
        if (!downloadSuccessful && downloader.getPriority() === 0) {
          console.log(chalk.gray('\n  → Trying direct download...'));

          try {
            const results = await downloader.download(link.url, {
              outputDir: config.outputDir,
              baseDir: config.outputDir,
              post: enrichedPost,
              fileIndex: i,
              linkName: link.name,
              page
            });

            if (results.length > 0 && results[0].status === 'success') {
              const result = results[0];
              downloadedExternalFiles.push({
                name: link.name,
                url: link.url,
                filename: result.filename
              });

              console.log(chalk.green(`  ✓ Direct download: ${result.filename}`));
              downloadSuccessful = true;
            } else if (results.length > 0) {
              console.log(chalk.red(`  ✗ Direct download failed: ${results[0].error}`));
            }
          } catch (error: any) {
            console.log(chalk.red(`  ✗ Direct download error: ${error.message}`));
          }
        }

        // Mark as failed if all methods failed
        if (!downloadSuccessful) {
          console.log(chalk.red(`  ✗ All download methods failed`));
          failedExternalLinks.push(link);
        }
      }
    }

    // Generate markdown
    console.log(chalk.blue('\n📝 Step 5: Generating markdown...\n'));
    const markdown = generatePostMarkdown(enrichedPost, {
      images: imageFilenames,
      videos: [],
      downloadedExternalFiles,
      galleryImages,
      avatarFilename: postAuthorAvatarFilename
    });

    const postFilename = generatePostFilename(enrichedPost) + '.md';
    const postFilePath = getPostFilePath(config.outputDir, enrichedPost, postFilename);
    await writeMarkdownFile(postFilePath, markdown);

    console.log(chalk.green(`✓ Markdown saved: ${postFilePath}\n`));

    // Summary
    console.log(chalk.green.bold('\n✅ Test Complete!\n'));
    console.log(chalk.gray('Summary:'));
    console.log(chalk.gray(`  Avatars: ${commentAuthorsMap.size}`));
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
