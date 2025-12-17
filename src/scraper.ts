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
 * Extract all posts from group timeline with pagination
 * @param {Page} page - Playwright page instance
 * @param {Object} config - Configuration object
 * @param {string} groupUrl - Base group URL
 * @returns {Promise<Array>} Array of all post objects from all pages
 */
export async function extractAllPosts(page, config, groupUrl) {
  const allPosts = [];
  let pageNumber = 1;
  let continueLooping = true;

  console.log('  → Starting pagination...');

  while (continueLooping) {
    console.log(`  → Extracting page ${pageNumber}...`);

    // Extract posts from current page
    const posts = await extractPostsFromTimeline(page, config);
    allPosts.push(...posts);

    console.log(`     Found ${posts.length} posts on page ${pageNumber}`);

    // Check if there are more pages
    const morePages = await hasMorePages(page);

    if (morePages) {
      pageNumber++;

      // Construct the next page URL by adding ?page=N parameter
      const nextPageUrl = `${groupUrl}?page=${pageNumber}`;
      console.log(`  → Navigating to page ${pageNumber}... ${nextPageUrl}`);

      await page.goto(nextPageUrl, {
        waitUntil: 'networkidle'
      });

      // Try to wait for timeline to load
      try {
        await page.waitForSelector('div.vertical-timeline-block', {
          timeout: 15000
        });

        // Small delay to ensure content is fully loaded
        await page.waitForTimeout(config.scraping.scrollDelay || 1000);
      } catch (error) {
        // Timeline blocks not found - check if page is empty
        const isEmpty = await page.$eval('body', (body) => {
          return body.textContent.includes('Aún sin novedades') ||
                 body.textContent.includes('sin novedades');
        }).catch(() => false);

        if (isEmpty) {
          console.log('  ✓ Reached empty page, pagination complete');
          continueLooping = false;
        } else {
          // Unexpected error - re-throw
          throw error;
        }
      }
    } else {
      continueLooping = false;
      console.log('  ✓ No more pages, pagination complete');
    }
  }

  console.log(`  ✓ Total posts extracted: ${allPosts.length} from ${pageNumber} page(s)`);
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
