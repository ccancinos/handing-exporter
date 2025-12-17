/**
 * Markdown Generation Module
 *
 * Creates markdown files for posts and index pages
 */

import { writeFile } from 'fs/promises';
import { sanitizeFilename, parseTimestamp } from './utils.js';
import { getRelativeAvatarPath, generateAvatarFilename, getRelativeMediaPath } from './file-organizer.js';

/**
 * Generate markdown content for a post
 * @param {Object} post - Post data object
 * @param {Object} mediaInfo - Object with downloaded media filenames
 * @returns {string} Markdown content
 */
export function generatePostMarkdown(post: any, mediaInfo: any = {}) {
  const {
    id,
    title,
    url,
    timestamp,
    author,
    authorAvatar,
    authorRole,
    groupName,
    likes,
    content,
    contentStyles = '',
    externalLinks = [],
    comments = []
  } = post;

  const { images = [], videos = [], downloadedExternalFiles = [], galleryImages = [], avatarFilename = null } = mediaInfo;

  let markdown = '';

  // Front matter
  markdown += '---\n';
  markdown += `title: "${title || 'Untitled'}"\n`;
  markdown += `author: ${author}\n`;
  if (authorRole) {
    markdown += `author_role: "${authorRole}"\n`;
  }
  if (avatarFilename) {
    const avatarPath = getRelativeAvatarPath(avatarFilename);
    markdown += `author_avatar: ${avatarPath}\n`;
  }
  markdown += `date: ${timestamp}\n`;
  markdown += `group: ${groupName}\n`;
  markdown += `post_id: "${id}"\n`;
  markdown += `post_url: ${url}\n`;
  markdown += `likes: ${likes || 0}\n`;
  markdown += `comments_count: ${comments.length}\n`;
  markdown += `has_external_links: ${externalLinks.length > 0}\n`;
  markdown += '---\n\n';

  // Author avatar and title (after frontmatter, before title)
  if (avatarFilename) {
    const avatarPath = getRelativeAvatarPath(avatarFilename);
    markdown += `![${author}](${avatarPath})\n\n`;
  }

  // Author name and role
  markdown += `**${author}**`;
  if (authorRole) {
    markdown += `  \n*${authorRole}*`;
  }
  markdown += '\n\n';

  // Title
  if (title) {
    markdown += `# ${title}\n\n`;
  }

  // Inline styles for content (if any)
  if (contentStyles) {
    markdown += '<style>\n';
    markdown += contentStyles;
    markdown += '\n</style>\n\n';
  }

  // Main content
  if (content) {
    markdown += `${content}\n\n`;
  }

  // Media section
  if (images.length > 0 || videos.length > 0 || galleryImages.length > 0) {
    markdown += '## Media\n\n';

    // Post Images subsection (only if there are post images)
    if (images.length > 0) {
      markdown += '### Post Images\n\n';
      for (let i = 0; i < images.length; i++) {
        const relativePath = getRelativeMediaPath(images[i]);
        markdown += `![Image ${i + 1}](${relativePath})\n`;
      }
      markdown += '\n';
    }

    // Gallery Images subsection (organized by gallery)
    if (galleryImages.length > 0) {
      markdown += '### Gallery Images\n\n';

      for (const gallery of galleryImages) {
        markdown += `**From: [${gallery.sourceName}](${gallery.sourceUrl})**\n\n`;

        for (let i = 0; i < gallery.images.length; i++) {
          const relativePath = getRelativeMediaPath(gallery.images[i]);
          markdown += `![Gallery Image ${i + 1}](${relativePath})\n`;
        }
        markdown += '\n';
      }
    }

    // Videos subsection
    if (videos.length > 0) {
      markdown += '### Videos\n\n';
      for (let i = 0; i < videos.length; i++) {
        const relativePath = getRelativeMediaPath(videos[i]);
        markdown += `[Video ${i + 1}](${relativePath})\n\n`;
      }
    }
  }

  // Downloaded External Files section (local files)
  if (downloadedExternalFiles.length > 0) {
    markdown += `## Downloaded External Files (${downloadedExternalFiles.length})\n\n`;

    for (const file of downloadedExternalFiles) {
      const relativePath = getRelativeMediaPath(file.filename);
      const fileName = file.name || file.url;
      markdown += `- [${fileName}](${relativePath})\n`;
    }

    markdown += '\n';
  }

  // External Links section (original URLs)
  if (externalLinks.length > 0) {
    markdown += `## External Links (${externalLinks.length})\n\n`;

    for (const link of externalLinks) {
      const linkName = link.name || link.url;
      markdown += `- [${linkName}](${link.url})\n`;
    }

    markdown += '\n';
  }

  // Comments section
  if (comments.length > 0) {
    markdown += `## Comments (${comments.length})\n\n`;

    for (const comment of comments) {
      // Add avatar inline with comment author
      const commentAvatarPath = comment.authorAvatar
        ? getRelativeAvatarPath(generateAvatarFilename(comment.author, comment.authorAvatar))
        : null;

      if (commentAvatarPath) {
        markdown += `### ![Avatar](${commentAvatarPath}) ${comment.author}\n`;
      } else {
        markdown += `### ${comment.author}\n`;
      }

      // Add author role if available
      if (comment.authorRole) {
        markdown += `*${comment.authorRole}*\n\n`;
      }

      markdown += `*${comment.timestamp}*\n\n`;
      markdown += `${comment.text}\n\n`;

      if (comment.likes > 0) {
        markdown += `👍 ${comment.likes} likes\n\n`;
      }

      markdown += '---\n\n';

      // Handle nested replies
      if (comment.replies && comment.replies.length > 0) {
        for (const reply of comment.replies) {
          // Add avatar to reply
          const replyAvatarPath = reply.authorAvatar
            ? getRelativeAvatarPath(generateAvatarFilename(reply.author, reply.authorAvatar))
            : null;

          if (replyAvatarPath) {
            markdown += `**Reply by ![Avatar](${replyAvatarPath}) ${reply.author}**`;
          } else {
            markdown += `**Reply by ${reply.author}**`;
          }

          // Add reply author role if available
          if (reply.authorRole) {
            markdown += ` *(${reply.authorRole})*`;
          }

          markdown += ` *${reply.timestamp}*\n\n`;

          markdown += `> ${reply.text}\n\n`;
          if (reply.likes > 0) {
            markdown += `> 👍 ${reply.likes} likes\n\n`;
          }
        }
      }
    }
  }

  return markdown;
}

/**
 * Generate markdown for external links file (failed downloads only)
 * @param {Object} post - Post data object
 * @param {Array} failedLinks - Array of external links that failed to download
 * @returns {string} Markdown content
 */
export function generateExternalLinksMarkdown(post, failedLinks = []) {
  const { title, timestamp } = post;
  const postFilename = generatePostFilename(post);

  let markdown = `# External Links - ${title || 'Untitled'}\n\n`;
  markdown += `Post: [${title || timestamp}](../Messages/${postFilename})\n\n`;
  markdown += '## Links to Download Manually\n\n';
  markdown += 'These external links could not be downloaded automatically and require manual download.\n\n';

  // Group by source if available
  const attachmentLinks = failedLinks.filter(l => l.source === 'attachment');
  const contentLinks = failedLinks.filter(l => l.source === 'content');
  const otherLinks = failedLinks.filter(l => !l.source);

  if (attachmentLinks.length > 0) {
    markdown += '### From Attachments\n\n';
    for (const link of attachmentLinks) {
      markdown += `- **${link.name || 'External Link'}**\n`;
      markdown += `  - URL: ${link.url}\n\n`;
    }
  }

  if (contentLinks.length > 0) {
    markdown += '### From Post Content\n\n';
    for (const link of contentLinks) {
      markdown += `- **${link.name || 'External Link'}**\n`;
      markdown += `  - URL: ${link.url}\n\n`;
    }
  }

  if (otherLinks.length > 0) {
    markdown += '### Other Links\n\n';
    for (const link of otherLinks) {
      markdown += `- [${link.name || link.url}](${link.url})\n`;
    }
    markdown += '\n';
  }

  markdown += '---\n';
  markdown += 'Please download these manually and place them in the appropriate folder.\n';

  return markdown;
}

/**
 * Generate markdown for monthly index
 * @param {string} groupName - Group name
 * @param {string} monthYear - Month and year (e.g., "Enero 2025")
 * @param {Array} posts - Array of post objects
 * @returns {string} Markdown content
 */
export function generateMonthlyIndexMarkdown(groupName, monthYear, posts) {
  let markdown = `# ${groupName} - ${monthYear}\n\n`;
  markdown += `**Total posts this month:** ${posts.length}\n\n`;
  markdown += '## Posts\n\n';

  for (const post of posts) {
    const filename = generatePostFilename(post);
    const titleDisplay = post.title || '*(no title)*';
    markdown += `- [${post.timestamp} - ${titleDisplay}](./Messages/${encodeURIComponent(filename)}) - ${post.author}\n`;
  }

  return markdown;
}

/**
 * Generate markdown for top-level index
 * @param {Array} groups - Array of group names
 * @param {string} lastUpdated - ISO timestamp
 * @returns {string} Markdown content
 */
export function generateTopLevelIndexMarkdown(groups, lastUpdated) {
  let markdown = '# Handing Backup - Mis Grupos\n\n';
  markdown += '## 2025\n\n';
  markdown += '### Groups\n';

  for (const group of groups) {
    const encoded = encodeURIComponent(group);
    markdown += `- [${group}](./2025/Mis%20Grupos/${encoded}/)\n`;
  }

  markdown += `\nLast updated: ${lastUpdated}\n`;

  return markdown;
}

/**
 * Write markdown file to disk
 * @param {string} filePath - Destination file path
 * @param {string} content - Markdown content
 */
export async function writeMarkdownFile(filePath, content) {
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Generate filename for a post
 * @param {Object} post - Post data object
 * @returns {string} Filename (e.g., "01-14-08-04-Día de la Tradicion.md")
 */
export function generatePostFilename(post) {
  const date = parseTimestamp(post.timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  const timestamp = `${month}-${day}-${hour}-${minute}`;

  if (post.title) {
    const sanitized = sanitizeFilename(post.title);
    return `${timestamp}-${sanitized}.md`;
  }

  return `${timestamp}.md`;
}

/**
 * Generate filename for external links file
 * @param {Object} post - Post data object
 * @returns {string} Filename
 */
export function generateExternalLinksFilename(post) {
  const date = parseTimestamp(post.timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  const timestamp = `${month}-${day}-${hour}-${minute}`;

  if (post.title) {
    const sanitized = sanitizeFilename(post.title);
    return `${timestamp}-${sanitized}-links.md`;
  }

  return `${timestamp}-links.md`;
}
