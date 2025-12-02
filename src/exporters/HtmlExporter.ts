/**
 * HTML Exporter
 *
 * Exports posts to styled HTML files with embedded CSS
 * Preserves contentStyles from scraper for rich formatting
 */

import { Exporter, Post, MediaInfo, Config } from '../types.js';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

export class HtmlExporter implements Exporter {
  getExtension(): string {
    return 'html';
  }

  async export(post: Post, media: MediaInfo[], outputDir: string, config: Config): Promise<void> {
    const html = this.generateHtml(post, media);
    const filename = this.generateFilename(post);
    const filePath = resolve(outputDir, 'Messages', filename);

    await writeFile(filePath, html, 'utf-8');
  }

  private generateHtml(post: Post, media: MediaInfo[]): string {
    const {
      title,
      author,
      timestamp,
      groupName,
      content,
      contentStyles = '',
      likes,
      comments = [],
      externalLinks = []
    } = post;

    const images = media.filter(m => m.type === 'image');
    const videos = media.filter(m => m.type === 'video');
    const documents = media.filter(m => m.type === 'document');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title || 'Untitled')}</title>
  <style>
    /* Base Styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    /* Header */
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
    }

    .header h1 {
      margin-bottom: 10px;
      font-size: 28px;
    }

    .meta {
      opacity: 0.9;
      font-size: 14px;
    }

    .meta-item {
      display: inline-block;
      margin-right: 15px;
    }

    /* Content */
    .content {
      padding: 30px;
    }

    .post-content {
      margin-bottom: 30px;
      font-size: 16px;
      line-height: 1.8;
    }

    /* Media Gallery */
    .section {
      margin-bottom: 40px;
    }

    .section-title {
      font-size: 20px;
      color: #667eea;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #667eea;
    }

    .image-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }

    .image-gallery img {
      width: 100%;
      height: 250px;
      object-fit: cover;
      border-radius: 4px;
      transition: transform 0.2s;
      cursor: pointer;
    }

    .image-gallery img:hover {
      transform: scale(1.05);
    }

    .video-list {
      display: grid;
      gap: 15px;
      margin-top: 15px;
    }

    .video-item video {
      width: 100%;
      max-width: 600px;
      border-radius: 4px;
    }

    /* Links */
    .links-list {
      list-style: none;
    }

    .links-list li {
      padding: 10px;
      margin-bottom: 8px;
      background: #f8f9fa;
      border-left: 3px solid #667eea;
      border-radius: 4px;
    }

    .links-list a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }

    .links-list a:hover {
      text-decoration: underline;
    }

    /* Comments */
    .comment {
      padding: 15px;
      margin-bottom: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      border-left: 3px solid #764ba2;
    }

    .comment-author {
      font-weight: 600;
      color: #764ba2;
      margin-bottom: 5px;
    }

    .comment-timestamp {
      font-size: 12px;
      color: #666;
      margin-bottom: 10px;
    }

    .comment-text {
      margin-bottom: 8px;
    }

    .comment-likes {
      font-size: 14px;
      color: #666;
    }

    .replies {
      margin-top: 15px;
      margin-left: 20px;
      padding-left: 15px;
      border-left: 2px solid #ddd;
    }

    .reply {
      padding: 10px;
      margin-bottom: 10px;
      background: white;
      border-radius: 4px;
    }

    .reply-author {
      font-weight: 600;
      color: #555;
      font-size: 14px;
    }

    .reply-text {
      font-size: 14px;
      margin-top: 5px;
      color: #666;
    }

    /* Footer */
    .footer {
      padding: 20px 30px;
      background: #f8f9fa;
      text-align: center;
      font-size: 14px;
      color: #666;
    }

    /* Custom Content Styles from Post */
    ${contentStyles}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${this.escapeHtml(title || 'Sin título')}</h1>
      <div class="meta">
        <span class="meta-item">👤 ${this.escapeHtml(author)}</span>
        <span class="meta-item">📅 ${this.escapeHtml(timestamp)}</span>
        <span class="meta-item">📁 ${this.escapeHtml(groupName)}</span>
        <span class="meta-item">❤️ ${likes} likes</span>
      </div>
    </div>

    <div class="content">
      ${content ? `
      <div class="post-content">
        ${content}
      </div>
      ` : ''}

      ${images.length > 0 ? `
      <div class="section">
        <h2 class="section-title">📷 Imágenes (${images.length})</h2>
        <div class="image-gallery">
          ${images.map(img => `
            <img src="${img.relativePath}" alt="${img.fileName}" loading="lazy">
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${videos.length > 0 ? `
      <div class="section">
        <h2 class="section-title">🎥 Videos (${videos.length})</h2>
        <div class="video-list">
          ${videos.map(video => `
            <div class="video-item">
              <video controls preload="metadata">
                <source src="${video.relativePath}" type="video/mp4">
                Tu navegador no soporta la reproducción de video.
              </video>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${documents.length > 0 ? `
      <div class="section">
        <h2 class="section-title">📄 Archivos Descargados (${documents.length})</h2>
        <ul class="links-list">
          ${documents.map(doc => `
            <li>
              <a href="${doc.relativePath}" target="_blank">${this.escapeHtml(doc.fileName)}</a>
            </li>
          `).join('')}
        </ul>
      </div>
      ` : ''}

      ${externalLinks && externalLinks.length > 0 ? `
      <div class="section">
        <h2 class="section-title">🔗 Enlaces Externos (${externalLinks.length})</h2>
        <ul class="links-list">
          ${externalLinks.map(link => `
            <li>
              <a href="${this.escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
                ${this.escapeHtml(link.name || link.url)}
              </a>
            </li>
          `).join('')}
        </ul>
      </div>
      ` : ''}

      ${comments.length > 0 ? `
      <div class="section">
        <h2 class="section-title">💬 Comentarios (${comments.length})</h2>
        ${comments.map(comment => `
          <div class="comment">
            <div class="comment-author">${this.escapeHtml(comment.author)}</div>
            <div class="comment-timestamp">${this.escapeHtml(comment.timestamp)}</div>
            <div class="comment-text">${this.escapeHtml(comment.text)}</div>
            ${comment.likes > 0 ? `<div class="comment-likes">👍 ${comment.likes} likes</div>` : ''}

            ${comment.replies && comment.replies.length > 0 ? `
              <div class="replies">
                ${comment.replies.map(reply => `
                  <div class="reply">
                    <div class="reply-author">${this.escapeHtml(reply.author)} <span class="comment-timestamp">${this.escapeHtml(reply.timestamp)}</span></div>
                    <div class="reply-text">${this.escapeHtml(reply.text)}</div>
                    ${reply.likes > 0 ? `<div class="comment-likes">👍 ${reply.likes} likes</div>` : ''}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
      ` : ''}
    </div>

    <div class="footer">
      Exportado desde Handing | ${groupName}
    </div>
  </div>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
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
      return `${timestamp}-${sanitized}.html`;
    }

    return `${timestamp}.html`;
  }
}
