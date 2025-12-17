/**
 * Core TypeScript Types and Interfaces
 *
 * Minimal typing for the Handing Backup Tool - just enough for IDE autocomplete
 * and catching major errors, without bureaucratic overhead.
 */

import { Page } from 'playwright';

// ============================================================================
// Core Data Types
// ============================================================================

export interface Post {
  id: string;
  title: string;
  url: string;
  author: string;
  authorAvatar?: string;  // Avatar URL
  authorRole?: string;    // Author's role in school community (e.g., "Maestra Celadora y Maestra de Inglés")
  timestamp: string;
  groupName: string;
  content: string;
  contentStyles?: string;  // CSS styles extracted from scraper
  images: string[];
  externalLinks?: ExternalLink[];
  comments: Comment[];
  likes: number;
  commentsCount?: number;
  extractedFrom?: string;
}

export interface Comment {
  author: string;
  authorAvatar?: string;  // Avatar URL
  authorRole?: string;    // Author's role in school community (e.g., "Padre de Joaquin Berges (Sala de 5A)")
  timestamp: string;
  text: string;
  likes: number;
  replies?: Comment[];
}

export interface ExternalLink {
  url: string;
  name: string;
  source: 'attachment' | 'content';
}

export interface Config {
  email: string;
  password: string;
  outputDir: string;
  groups: GroupConfig[];
  mediaStrategy: MediaStrategyConfig;
  scraping: ScrapingConfig;
  filesystem: FilesystemConfig;
  outputFormat?: 'markdown' | 'html';
  downloaders?: DownloadersConfig;
}

export interface GroupConfig {
  name: string;
  url: string;
}

export interface MediaStrategyConfig {
  downloadImages: boolean;
  downloadVideos: boolean;
  maxRetries: number;
  timeout: number;
}

export interface ScrapingConfig {
  headless: boolean;
  scrollDelay: number;
  maxRetries: number;
  userAgent: string;
}

export interface FilesystemConfig {
  generateMonthlyIndex: boolean;
  generateTopLevelIndex: boolean;
  sanitizeFilenames: boolean;
}

export interface DownloadersConfig {
  enableGalleries?: boolean;
  maxImagesPerGallery?: number;
}

// ============================================================================
// Downloader Interfaces
// ============================================================================

export interface Downloader {
  canHandle(url: string): boolean;
  download(url: string, context: DownloadContext): Promise<DownloadResult[]>;
  getPriority?(): number;
}

export interface DownloadContext {
  outputDir: string;
  post: Post;
  fileIndex: number;
  page?: Page;  // Playwright page for browser-based downloaders
  options?: any;
  mediaType?: string;  // 'image', 'video', 'file', etc.
  index?: number;  // Index for filename generation
}

export interface DownloadResult {
  status: 'success' | 'failed' | 'auth_required';
  filePath?: string;
  fileName?: string;
  size?: number;
  contentType?: string;
  extension?: string;
  error?: string;
  url?: string;  // Original URL
  localPath?: string;  // Local file path
  filename?: string;  // Generated filename
  sourceAlbum?: string;  // For gallery downloads
  sourceName?: string;  // Original name from source
  sourceFolder?: string;  // For folder downloads
}

// ============================================================================
// Exporter Interfaces
// ============================================================================

export interface Exporter {
  export(post: Post, media: MediaInfo[], outputDir: string, config: Config): Promise<void>;
  getExtension(): string;
}

export interface MediaInfo {
  fileName: string;
  originalUrl: string;
  relativePath: string;
  type?: 'image' | 'video' | 'document';
}

// ============================================================================
// Manifest Types
// ============================================================================

export interface Manifest {
  metadata: ManifestMetadata;
  posts: Record<string, ManifestPost>;
  avatars?: Record<string, AvatarMetadata>;  // Track downloaded avatars
}

export interface ManifestMetadata {
  last_run?: string;
  total_posts: number;
  group_name?: string;
}

export interface ManifestPost {
  title: string;
  url: string;
  first_downloaded: string;
  last_updated: string;
  markdown_path?: string;
  images_count?: number;
  videos_count?: number;
  external_links_count?: number;
  status: 'complete' | 'partial' | 'failed';
  error?: string;  // Error message if status is 'failed'
}

// Avatar metadata for manifest tracking
export interface AvatarMetadata {
  author: string;
  url: string;
  filename: string;
  downloaded_at: string;
  status: 'complete' | 'failed';
  error?: string;
}
