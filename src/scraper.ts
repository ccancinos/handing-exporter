/**
 * Web Scraping Module
 *
 * Handles browser automation, authentication, and content extraction
 */

import { chromium } from 'playwright';

/**
 * Initialize Playwright browser and page
 * @param {Object} config - Configuration object
 * @returns {Promise<{browser: Browser, page: Page, context: BrowserContext}>}
 */
export async function initializeScraper(config) {
  const browser = await chromium.launch({
    channel: 'chrome', // Use system-installed Chrome instead of Playwright's Chromium
    headless: config.scraping.headless,
    args: [
      '--disable-dev-shm-usage' // Helps with stability in limited memory environments
    ]
  });

  const context = await browser.newContext({
    userAgent: config.scraping.userAgent,
    acceptDownloads: true // Required for downloading media files
  });

  const page = await context.newPage();

  // Set a reasonable timeout (2 minutes) instead of default 30s
  await page.setDefaultNavigationTimeout(120000);

  return { browser, page, context };
}

/**
 * Close browser
 * @param {Browser} browser - Playwright browser instance
 */
export async function closeScraper(browser) {
  await browser.close();
}

/**
 * Authenticate with Handing.co
 * @param {Page} page - Playwright page instance
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<boolean>} Success status
 */
export async function authenticate(page, email, password) {
  try {
    console.log('  → Navigating to login page...');
    await page.goto('https://web.handing.co/users/sign_in', {
      waitUntil: 'networkidle'
    });

    // Wait for the form to be visible
    console.log('  → Waiting for login form...');
    await page.waitForSelector('#user_email', {
      timeout: 10000
    });

    // Fill in email field
    console.log('  → Filling email...');
    await page.fill('#user_email', email);

    // Fill in password field
    console.log('  → Filling password...');
    await page.fill('#user_password', password);

    // Submit form by pressing Enter on password field
    // (note: password field has class "do-submit-form-on-press-enter")
    console.log('  → Submitting form...');
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }),
      page.press('#user_password', 'Enter')
    ]);

    // Verify we're no longer on the login page
    if (page.url().includes('/users/sign_in')) {
      throw new Error('Still on login page - credentials may be incorrect');
    }

    console.log('  ✓ Authentication successful!');
    return true;

  } catch (error) {
    console.error('  ✗ Authentication failed:', error.message);

    // Take a screenshot for debugging
    await page.screenshot({ path: 'login-error.png' });
    console.log('  → Screenshot saved to login-error.png for debugging');

    throw new Error(`Authentication failed: ${error.message}`);
  }
}

/**
 * Get list of groups from sidebar
 * @param {Page} page - Playwright page instance
 * @returns {Promise<Array>} Array of group objects
 */
export async function getGroups(page) {
  // TODO: Implement group extraction
  // Will need to:
  // 1. Find "Mis grupos" section
  // 2. Extract group names and URLs
  // 3. Return structured data

  throw new Error('Group extraction not yet implemented');
}

/**
 * Navigate to a specific group
 * @param {Page} page - Playwright page instance
 * @param {Object} group - Group object with URL
 */
export async function navigateToGroup(page, group) {
  console.log(`  → Navigating to ${group.url}...`);
  await page.goto(group.url, {
    waitUntil: 'networkidle'
  });

  // Wait for timeline to load
  await page.waitForSelector('div.vertical-timeline-block', {
    timeout: 15000
  });

  console.log('  ✓ Timeline loaded');
}

/**
 * Extract posts from current timeline page (single page, no pagination)
 * @param {Page} page - Playwright page instance
 * @param {Object} config - Configuration object
 * @returns {Promise<Array>} Array of post objects
 */
export async function extractPostsFromTimeline(page, config) {
  console.log('  → Extracting posts from current page...');

  const posts = await page.$$eval('div.vertical-timeline-block', (blocks) => {
    return blocks.map(block => {
      try {
        // Find the post container with data-post-id
        const postElement = block.querySelector('div.js-post[data-post-id]');
        if (!postElement) return null;

        const postId = postElement.getAttribute('data-post-id');

        // Extract title (could be in h2 or h4)
        const titleLink = block.querySelector('a.post-title-link');
        const title = titleLink ? titleLink.textContent.trim() : '';
        const postUrl = titleLink ? titleLink.href : '';

        // Author info will be extracted from individual post page
        // (no need to extract from timeline since we always visit the full post)

        // Extract timestamp from title attribute (contains full date)
        const timestampElement = block.querySelector('small.created-at-timeline');
        const timestamp = timestampElement ? timestampElement.getAttribute('title') : '';

        // Extract truncated content
        const contentElement = block.querySelector('span.content');
        const content = contentElement ? contentElement.textContent.trim() : '';

        // Extract likes count
        const likesElement = block.querySelector('[data-likes]');
        const likes = likesElement ? parseInt(likesElement.getAttribute('data-likes') || '0', 10) : 0;

        // Extract comments count
        const commentsElement = block.querySelector('[data-comments-count]');
        const commentsCount = commentsElement ? parseInt(commentsElement.getAttribute('data-comments-count') || '0', 10) : 0;

        // Extract image URLs from slider
        // Images can be in img tags OR in div elements with data attributes
        const images = [];
        const slickSlides = block.querySelectorAll('.slick-slide');
        slickSlides.forEach(slide => {
          // Try div with data attributes first (carousel view)
          const imgDiv = slide.querySelector('.post-main-image-container-cover, div[data-large-url], div[data-original-url]');
          if (imgDiv) {
            const imageUrl = imgDiv.getAttribute('data-original-url') ||
                            imgDiv.getAttribute('data-large-url') ||
                            imgDiv.getAttribute('data-main-url');
            if (imageUrl && !imageUrl.includes('data:image') && !images.includes(imageUrl)) {
              images.push(imageUrl);
            }
          } else {
            // Fallback to img tag
            const img = slide.querySelector('img');
            if (img) {
              const imageUrl = img.getAttribute('data-main-url') ||
                              img.getAttribute('data-large-url') ||
                              img.getAttribute('data-original-url') ||
                              img.src;
              if (imageUrl && !imageUrl.includes('data:image') && !images.includes(imageUrl)) {
                images.push(imageUrl);
              }
            }
          }
        });

        return {
          id: postId,
          title,
          url: postUrl,
          author: 'Unknown', // Will be extracted from individual post page
          timestamp,
          content,
          likes,
          commentsCount,
          images,
          extractedFrom: 'timeline' // Mark that this is from timeline (truncated)
        };
      } catch (error) {
        console.error('Error extracting post:', error);
        return null;
      }
    }).filter(post => post !== null);
  });

  console.log(`  ✓ Extracted ${posts.length} posts from timeline`);
  return posts;
}

/**
 * Check if there are more pages available
 * @param {Page} page - Playwright page instance
 * @returns {Promise<boolean>} True if more pages exist
 */
export async function hasMorePages(page) {
  try {
    await page.waitForSelector('#see-more-posts-btn', { timeout: 2000 });
    return true;
  } catch (error) {
    // Button not found, no more pages
    return false;
  }
}

/**
 * Extract posts from a single timeline page
 * @param {BrowserContext} context - Playwright browser context for creating new pages
 * @param {string} groupUrl - Base group URL
 * @param {number} pageNumber - Page number to extract
 * @param {Object} config - Configuration object
 * @returns {Promise<Array>} Array of post objects from this page
 */
async function extractSinglePage(context, groupUrl, pageNumber, config) {
  const page = await context.newPage();

  try {
    // Construct page URL
    const pageUrl = pageNumber === 1 ? groupUrl : `${groupUrl}?page=${pageNumber}`;

    // Navigate to page
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for timeline blocks
    await page.waitForSelector('div.vertical-timeline-block', { timeout: 15000 });

    // Small delay for content to settle
    await page.waitForTimeout(config.scraping.scrollDelay || 1000);

    // Extract posts
    const posts = await extractPostsFromTimeline(page, config);

    return posts;
  } catch (error) {
    // Check if page is empty
    try {
      const isEmpty = await page.$eval('body', (body) => {
        return body.textContent.includes('Aún sin novedades') ||
               body.textContent.includes('sin novedades');
      }).catch(() => false);

      if (isEmpty) {
        return []; // Empty page, return empty array
      }
    } catch (e) {
      // Ignore check errors
    }

    console.error(`  ⚠ Error extracting page ${pageNumber}:`, error.message);
    return []; // Return empty on error
  } finally {
    await page.close();
  }
}

/**
 * Extract all posts from group timeline with pagination
 * @param {Page} page - Playwright page instance
 * @param {BrowserContext} context - Playwright browser context for parallel page extraction
 * @param {Object} config - Configuration object
 * @param {string} groupUrl - Base group URL
 * @returns {Promise<Array>} Array of all post objects from all pages
 */
export async function extractAllPosts(page, context, config, groupUrl) {
  console.log('  → Starting pagination with parallel extraction...');

  // Phase 1: Extract page 1 to check if pagination exists
  console.log('  → Extracting page 1...');
  const page1Posts = await extractPostsFromTimeline(page, config);
  console.log(`     Found ${page1Posts.length} posts on page 1`);

  const allPosts = [...page1Posts];

  // Check if there are more pages
  const hasPagination = await hasMorePages(page);

  if (!hasPagination) {
    console.log('  ✓ No more pages, pagination complete');
    console.log(`  ✓ Total posts extracted: ${allPosts.length} from 1 page`);
    return allPosts;
  }

  // Phase 2: Parallel extraction of remaining pages in batches
  console.log('  → Multiple pages detected, using parallel batch extraction...');

  const BATCH_SIZE = 10; // Process 10 pages concurrently
  const MAX_PAGES = 500; // Safety limit (stop if we exceed this)
  let currentPage = 2;
  let consecutiveEmptyBatches = 0;
  let totalPagesExtracted = 1;

  while (currentPage <= MAX_PAGES) {
    // Create batch of page numbers
    const batchPageNumbers = Array.from(
      { length: BATCH_SIZE },
      (_, i) => currentPage + i
    );

    console.log(`  → Extracting pages ${batchPageNumbers[0]}-${batchPageNumbers[batchPageNumbers.length - 1]} in parallel...`);

    // Extract all pages in batch concurrently
    const batchPromises = batchPageNumbers.map(pageNum =>
      extractSinglePage(context, groupUrl, pageNum, config)
    );

    const batchResults = await Promise.all(batchPromises);

    // Process results
    let postsFoundInBatch = 0;
    let emptyPagesInBatch = 0;

    batchResults.forEach((posts, idx) => {
      const pageNum = batchPageNumbers[idx];
      if (posts.length > 0) {
        allPosts.push(...posts);
        postsFoundInBatch += posts.length;
        totalPagesExtracted++;
        console.log(`     Page ${pageNum}: ${posts.length} posts`);
      } else {
        emptyPagesInBatch++;
      }
    });

    console.log(`     Batch total: ${postsFoundInBatch} posts from ${BATCH_SIZE - emptyPagesInBatch} pages`);

    // Stop if entire batch was empty
    if (emptyPagesInBatch === BATCH_SIZE) {
      consecutiveEmptyBatches++;
      if (consecutiveEmptyBatches >= 1) {
        console.log('  ✓ Reached end of timeline (empty batch detected)');
        break;
      }
    } else {
      consecutiveEmptyBatches = 0;
    }

    // Stop if we found any empty pages (likely near the end)
    if (emptyPagesInBatch > 0) {
      console.log('  ✓ Reached end of timeline (partial empty batch)');
      break;
    }

    currentPage += BATCH_SIZE;
  }

  console.log(`  ✓ Total posts extracted: ${allPosts.length} from ${totalPagesExtracted} page(s)`);
  return allPosts;
}

/**
 * Enrich a single post with full details by visiting its page
 * (Alias for extractFullPostDetails for clarity)
 * @param {Page} page - Playwright page instance
 * @param {Object} post - Post object with basic info from timeline
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Enriched post object with full details
 */
export async function enrichSinglePost(page, post, config) {
  return await extractFullPostDetails(page, post, config);
}

/**
 * Extract full post details by navigating to individual post page
 * @param {Page} page - Playwright page instance
 * @param {Object} post - Post object with basic info from timeline
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Enriched post object with full details
 */
export async function extractFullPostDetails(page, post, config) {
  try {
    console.log(`     → Extracting full details for post ${post.id}...`);

    // Navigate to the individual post page
    await page.goto(post.url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for the post content to load
    try {
      await page.waitForSelector('div.sanitized-post-content', {
        timeout: 10000
      });
    } catch (err) {
      console.error(`     ✗ ERROR: Selector 'div.sanitized-post-content' not found for post ${post.id}`);
      console.error(`     ✗ Post URL: ${post.url}`);
      console.error(`     ✗ This post will have truncated content!`);
      throw new Error(`Content selector not found after 10s timeout`);
    }

    // Extract all author information from individual post page (single source of truth)
    // From the .media structure: <a class="user-name"><b>Author Name</b></a>
    const authorName = await page.$eval('a.user-name b, a.user-name',
      (el: any) => el.textContent.trim()
    ).catch(() => 'Unknown');

    // Avatar: <a class="forum-avatar"><img class="img-circle" src="..."></a>
    const authorAvatar = await page.$eval('a.forum-avatar img.img-circle',
      (img: any) => img.getAttribute('src')
    ).catch(() => undefined);

    // Role: <small>Maestra Celadora y Maestra de Inglés</small>
    const authorRole = await page.$eval('.media-body .media-text .comment-text small',
      (small: any) => small.textContent.trim()
    ).catch(() => undefined);

    // Extract full content with HTML formatting (simplified to avoid tsx transpilation issues)
    const contentWithStyles = await page.evaluate(() => {
      const element = document.querySelector('div.sanitized-post-content');
      if (!element) {
        throw new Error('Content element not found');
      }

      // Just get the innerHTML directly - no complex processing
      return {
        html: element.innerHTML.trim(),
        css: ''
      };
    }).catch((err) => {
      console.error(`     ✗ WARNING: Failed to extract content for post ${post.id}: ${err.message}`);
      console.error(`     ✗ Falling back to plain text extraction...`);
      return { html: post.content, css: '' };
    });

    // Extract all media URLs
    // Images can be in carousel (.slick-slide) OR single image (a.post-img-container)
    let media = [];

    // Try carousel first
    const carouselImages = await page.$$eval('.slick-slide', (slides) => {
      const urls = [];
      slides.forEach(slide => {
        // Try to find image in div with data attributes (carousel view)
        const imgDiv = slide.querySelector('.post-main-image-container-cover, div[data-large-url], div[data-original-url]');
        if (imgDiv) {
          const imageUrl = imgDiv.getAttribute('data-original-url') ||
                          imgDiv.getAttribute('data-large-url') ||
                          imgDiv.getAttribute('data-main-url');
          if (imageUrl && !imageUrl.includes('data:image') && !urls.includes(imageUrl)) {
            urls.push(imageUrl);
          }
        } else {
          // Try to find img tag (timeline view fallback)
          const img = slide.querySelector('img');
          if (img) {
            const imageUrl = img.getAttribute('data-main-url') ||
                            img.getAttribute('data-large-url') ||
                            img.getAttribute('data-original-url') ||
                            img.src;
            if (imageUrl && !imageUrl.includes('data:image') && !urls.includes(imageUrl)) {
              urls.push(imageUrl);
            }
          }
        }
      });
      return urls;
    }).catch(() => []);

    media = carouselImages;

    // If no carousel images, try single image
    if (media.length === 0) {
      const singleImage = await page.$eval('a.post-img-container[data-large-url], a.post-img-container[data-original-url]', (link) => {
        return link.getAttribute('data-original-url') ||
               link.getAttribute('data-large-url');
      }).catch(() => null);

      if (singleImage) {
        media.push(singleImage);
      }
    }

    // Extract videos from video-preview sections
    const videos = await page.$$eval('div.video-preview video', (videoElements) => {
      const videoUrls = [];
      videoElements.forEach(video => {
        const source = video.querySelector('source');
        if (source) {
          const videoUrl = source.getAttribute('src');
          const posterUrl = video.getAttribute('poster');
          if (videoUrl) {
            videoUrls.push({
              url: videoUrl,
              thumbnail: posterUrl,
              type: 'video'
            });
          }
        }
      });
      return videoUrls;
    }).catch(() => []);

    // Add videos to media array
    videos.forEach(video => {
      if (!media.includes(video.url)) {
        media.push(video.url);
      }
    });

    // Extract external links from attachments section and content (with deduplication)
    const externalLinks = await page.evaluate(() => {
      const links = [];
      const urlToName = new Map(); // Track best name for each URL (deduplication)

      // PASS 1: Extract from attachments section
      const attachments = document.querySelectorAll('div.attachments a.attachment-file-name');
      attachments.forEach((link: any) => {
        const url = link.href;
        const name = link.textContent.trim();

        // Only store if we have meaningful text (not just whitespace or icons)
        if (url && name && name.length > 0) {
          // If we haven't seen this URL, or this name is better (longer/more descriptive)
          if (!urlToName.has(url) || name.length > (urlToName.get(url)?.length || 0)) {
            urlToName.set(url, name);
          }
        }
      });

      // PASS 2: Extract ALL external links from content
      // This catches links that are embedded in the post body (like Google Photos albums)
      const contentLinks = document.querySelectorAll('div.sanitized-post-content a[href]');
      contentLinks.forEach((link: any) => {
        const url = link.href;
        const name = link.textContent.trim() || link.href; // Use URL as name if no text

        // Only include if it's an external link (not handing.co)
        if (url && !url.includes('handing.co')) {
          // Update map if this is a new URL or has a better name
          if (!urlToName.has(url)) {
            urlToName.set(url, name);
          } else if (name.length > 0 && name !== url && name.length > urlToName.get(url).length) {
            // Prefer descriptive names over raw URLs
            urlToName.set(url, name);
          }
        }
      });

      // Convert map to array with source info
      const result = [];
      urlToName.forEach((name, url) => {
        // Determine source based on where we first found it
        const source = attachments.length > 0 &&
                       Array.from(attachments).some((a: any) => a.href === url)
                       ? 'attachment' : 'content';
        result.push({ url, name, source });
      });

      return result;
    }).catch(() => []);

    // Extract all comments with nested replies
    const comments = await extractComments(page).catch(() => []);

    // Return enriched post object with complete author information from individual post
    return {
      ...post,
      author: authorName,       // Complete author info from individual post page
      authorAvatar: authorAvatar,
      authorRole: authorRole,
      content: contentWithStyles.html,
      contentStyles: contentWithStyles.css,
      images: media.length > 0 ? media : post.images, // Use full-size URLs if available
      externalLinks,
      comments,
      commentsCount: comments.length, // Update with actual extracted count
      extractedFrom: 'full' // Mark that this has full details
    };

  } catch (error) {
    console.error(`     ✗ Failed to extract full details for post ${post.id}: ${error.message}`);
    // Return original post if extraction fails
    return post;
  }
}

/**
 * Extract comments from a post page (with nested replies)
 * @param {Page} page - Playwright page instance
 * @returns {Promise<Array>} Array of comment objects with nested replies
 */
export async function extractComments(page) {
  // Simplified extraction to avoid tsx transpilation issues
  const comments = await page.evaluate(() => {
    const commentElements = Array.from(document.querySelectorAll('div.comment'));
    const topLevelComments = [];

    // Process each comment element inline (no helper functions)
    for (const commentElement of commentElements) {
      // Check if this comment is not inside a comment-responses container
      const isTopLevel = !commentElement.closest('div.comment-responses');
      if (!isTopLevel) continue;

      // Extract author
      const authorElement = commentElement.querySelector('a.text-navy');
      const author = authorElement ? authorElement.textContent.trim() : 'Unknown';

      // Extract avatar (from actual DOM: a.forum-avatar img.img-circle.avatar-picture)
      const avatarImg = commentElement.querySelector('a.forum-avatar img.img-circle.avatar-picture, a.forum-avatar img.img-circle');
      const authorAvatar = avatarImg ? avatarImg.getAttribute('src') : undefined;

      // Extract author role (text node in .media-heading after author link, before <br>)
      const mediaHeading = commentElement.querySelector('.media-heading');
      let authorRole = undefined;
      if (mediaHeading) {
        // Get all text nodes, skip the author link text, get text between link and <br>
        const clone = mediaHeading.cloneNode(true) as HTMLElement;
        // Remove the author link
        const linkToRemove = clone.querySelector('a.text-navy');
        if (linkToRemove) linkToRemove.remove();
        // Remove the timestamp
        const timeToRemove = clone.querySelector('small.created-at');
        if (timeToRemove) timeToRemove.remove();
        // Remove clearfix
        const clearfixToRemove = clone.querySelector('.clearfix');
        if (clearfixToRemove) clearfixToRemove.remove();
        // Get remaining text (should be the role)
        const roleText = clone.textContent?.trim().replace(/\s+/g, ' ');
        if (roleText && roleText.length > 0) {
          authorRole = roleText;
        }
      }

      // Extract timestamp
      const timestampElement = commentElement.querySelector('small.created-at-timeline');
      const timestamp = timestampElement ? timestampElement.getAttribute('title') || timestampElement.textContent.trim() : '';

      // Extract comment text
      const textElement = commentElement.querySelector('.comment-text, .sanitized-post-content');
      const text = textElement ? textElement.textContent.trim() : '';

      // Extract likes
      const likesElement = commentElement.querySelector('[data-likes]');
      const likes = likesElement ? parseInt(likesElement.getAttribute('data-likes') || '0', 10) : 0;

      // Extract nested replies (inline processing)
      const replies = [];
      const repliesContainer = commentElement.querySelector('div.comment-responses');
      if (repliesContainer) {
        const replyElements = repliesContainer.querySelectorAll(':scope > div.comment');
        for (const replyElement of replyElements) {
          const replyAuthor = replyElement.querySelector('a.text-navy')?.textContent?.trim() || 'Unknown';
          const replyAvatarImg = replyElement.querySelector('a.forum-avatar img.img-circle.avatar-picture, a.forum-avatar img.img-circle');
          const replyAuthorAvatar = replyAvatarImg ? replyAvatarImg.getAttribute('src') : undefined;

          // Extract reply author role (same logic as comment)
          const replyMediaHeading = replyElement.querySelector('.media-heading');
          let replyAuthorRole = undefined;
          if (replyMediaHeading) {
            const clone = replyMediaHeading.cloneNode(true) as HTMLElement;
            const linkToRemove = clone.querySelector('a.text-navy');
            if (linkToRemove) linkToRemove.remove();
            const timeToRemove = clone.querySelector('small.created-at, small.created-at-timeline');
            if (timeToRemove) timeToRemove.remove();
            const clearfixToRemove = clone.querySelector('.clearfix');
            if (clearfixToRemove) clearfixToRemove.remove();
            const roleText = clone.textContent?.trim().replace(/\s+/g, ' ');
            if (roleText && roleText.length > 0) {
              replyAuthorRole = roleText;
            }
          }

          const replyTimestamp = replyElement.querySelector('small.created-at-timeline, small.created-at')?.getAttribute('title') ||
                                 replyElement.querySelector('small.created-at-timeline, small.created-at')?.textContent?.trim() || '';
          const replyText = replyElement.querySelector('.comment-text, .sanitized-post-content')?.textContent?.trim() || '';
          const replyLikes = parseInt(replyElement.querySelector('[data-likes]')?.getAttribute('data-likes') || '0', 10);

          replies.push({
            author: replyAuthor,
            authorAvatar: replyAuthorAvatar,
            authorRole: replyAuthorRole,
            timestamp: replyTimestamp,
            text: replyText,
            likes: replyLikes,
            replies: []
          });
        }
      }

      topLevelComments.push({
        author,
        authorAvatar,
        authorRole,
        timestamp,
        text,
        likes,
        replies
      });
    }

    return topLevelComments;
  });

  return comments;
}
