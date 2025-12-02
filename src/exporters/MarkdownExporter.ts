/**
 * Markdown Exporter
 *
 * Exports posts to Markdown files compatible with Obsidian
 * Uses the existing markdown generation logic from markdown-writer
 */

import { Exporter, Post, MediaInfo, Config } from '../types.js';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

export class MarkdownExporter implements Exporter {
  getExtension(): string {
    return 'md';
  }

  async export(post: Post, media: MediaInfo[], outputDir: string, config: Config): Promise<void> {
    const markdown = this.generateMarkdown(post, media);
    const filename = this.generateFilename(post);
    const filePath = resolve(outputDir, 'Messages', filename);

    await writeFile(filePath, markdown, 'utf-8');
  }

  private generateMarkdown(post: Post, media: MediaInfo[]): string {
    const {
      id,
      title,
      url,
      timestamp,
      author,
      groupName,
      likes,
      content,
      contentStyles = '',
      externalLinks = [],
      comments = []
    } = post;

    const images = media.filter(m => m.type === 'image');
    const videos = media.filter(m => m.type === 'video');
    const documents = media.filter(m => m.type === 'document');

    let markdown = '';

    // Front matter
    markdown += '---\n';
    markdown += `title: "${title || 'Untitled'}"\n`;
    markdown += `author: ${author}\n`;
    markdown += `date: ${timestamp}\n`;
    markdown += `group: ${groupName}\n`;
    markdown += `post_id: "${id}"\n`;
    markdown += `post_url: ${url}\n`;
    markdown += `likes: ${likes || 0}\n`;
    markdown += `comments_count: ${comments.length}\n`;
    markdown += `has_external_links: ${externalLinks.length > 0}\n`;
    markdown += '---\n\n';

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
    if (images.length > 0 || videos.length > 0) {
      markdown += '## Media\n\n';

      // Images subsection
      if (images.length > 0) {
        markdown += '### Images\n\n';
        for (let i = 0; i < images.length; i++) {
          markdown += `![Image ${i + 1}](${images[i].relativePath})\n`;
        }
        markdown += '\n';
      }

      // Videos subsection
      if (videos.length > 0) {
        markdown += '### Videos\n\n';
        for (let i = 0; i < videos.length; i++) {
          markdown += `[Video ${i + 1}](${videos[i].relativePath})\n\n`;
        }
      }
    }

    // Downloaded files section
    if (documents.length > 0) {
      markdown += `## Downloaded External Files (${documents.length})\n\n`;

      for (const doc of documents) {
        markdown += `- [${doc.fileName}](${doc.relativePath})\n`;
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
        markdown += `### ${comment.author}\n`;
        markdown += `*${comment.timestamp}*\n\n`;
        markdown += `${comment.text}\n\n`;

        if (comment.likes > 0) {
          markdown += `👍 ${comment.likes} likes\n\n`;
        }

        markdown += '---\n\n';

        // Handle nested replies
        if (comment.replies && comment.replies.length > 0) {
          for (const reply of comment.replies) {
            markdown += `**Reply by ${reply.author}** *${reply.timestamp}*\n\n`;
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

  private generateFilename(post: Post): string {
    const date = new Date(post.timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    const timestamp = `${month}-${day}-${hour}-${minute}`;

    if (post.title) {
      const sanitized = post.title
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
      return `${timestamp}-${sanitized}.md`;
    }

    return `${timestamp}.md`;
  }
}
