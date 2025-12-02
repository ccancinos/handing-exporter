/**
 * File Organization Module
 *
 * Manages directory structure and file paths
 */

import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { sanitizeFilename, parseTimestamp } from './utils.js';

/**
 * Create directory structure for a group and month
 * @param {string} baseDir - Base output directory
 * @param {string} year - Year (e.g., "2025")
 * @param {string} groupName - Group name
 * @param {string} monthName - Month name (e.g., "Enero")
 * @returns {Promise<Object>} Object with directory paths
 */
export async function createMonthStructure(baseDir, year, groupName, monthName) {
  const groupPath = join(baseDir, year, 'Mis Grupos', groupName, monthName);

  const directories = {
    root: groupPath,
    messages: join(groupPath, 'Messages'),
    images: join(groupPath, 'Images'),
    videos: join(groupPath, 'Videos'),
    externalLinks: join(groupPath, 'External_Links'),
    externalFiles: join(groupPath, 'External_Files')
  };

  // Create all directories
  for (const dir of Object.values(directories)) {
    await mkdir(dir, { recursive: true });
  }

  return directories;
}

/**
 * Get month name in Spanish from date
 * @param {Date} date - Date object
 * @returns {string} Spanish month name
 */
export function getMonthName(date) {
  const months = [
    '01_Enero', '02_Febrero', '03_Marzo', '04_Abril', '05_Mayo', '06_Junio',
    '07_Julio', '08_Agosto', '09_Septiembre', '10_Octubre', '11_Noviembre', '12_Diciembre'
  ];
  return months[date.getMonth()];
}

/**
 * Generate file path for a post message
 * @param {string} baseDir - Base output directory
 * @param {Object} post - Post data object
 * @param {string} filename - Generated filename
 * @returns {string} Full file path
 */
export function getPostFilePath(baseDir, post, filename) {
  const date = parseTimestamp(post.timestamp);
  const year = date.getFullYear();
  const month = getMonthName(date);

  return join(
    baseDir,
    String(year),
    'Mis Grupos',
    post.groupName,
    month,
    'Messages',
    filename
  );
}

/**
 * Generate file path for media
 * @param {string} baseDir - Base output directory
 * @param {Object} post - Post data object
 * @param {string} filename - Media filename
 * @param {string} mediaType - 'Images' or 'Videos'
 * @returns {string} Full file path
 */
export function getMediaFilePath(baseDir, post, filename, mediaType) {
  const date = parseTimestamp(post.timestamp);
  const year = date.getFullYear();
  const month = getMonthName(date);

  return join(
    baseDir,
    String(year),
    'Mis Grupos',
    post.groupName,
    month,
    mediaType,
    filename
  );
}

/**
 * Generate file path for external links file
 * @param {string} baseDir - Base output directory
 * @param {Object} post - Post data object
 * @param {string} filename - External links filename
 * @returns {string} Full file path
 */
export function getExternalLinksFilePath(baseDir, post, filename) {
  const date = parseTimestamp(post.timestamp);
  const year = date.getFullYear();
  const month = getMonthName(date);

  return join(
    baseDir,
    String(year),
    'Mis Grupos',
    post.groupName,
    month,
    'External_Links',
    filename
  );
}

/**
 * Generate file path for downloaded external file
 * @param {string} baseDir - Base output directory
 * @param {Object} post - Post data object
 * @param {string} filename - Downloaded external file filename
 * @returns {string} Full file path
 */
export function getExternalFilePath(baseDir, post, filename) {
  const date = parseTimestamp(post.timestamp);
  const year = date.getFullYear();
  const month = getMonthName(date);

  return join(
    baseDir,
    String(year),
    'Mis Grupos',
    post.groupName,
    month,
    'External_Files',
    filename
  );
}

/**
 * Generate filename for downloaded external file
 * @param {Object} post - Post data object
 * @param {Object} link - External link object with name and url
 * @param {number} index - Link index in post
 * @param {string} extension - File extension (e.g., 'pdf', 'jpg')
 * @returns {string} Generated filename
 */
export function generateExternalFileFilename(post, link, index, extension) {
  const date = parseTimestamp(post.timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  const timestamp = `${month}-${day}-${hour}-${minute}`;

  // Use the link name if available, otherwise use index
  if (link.name && link.name.trim()) {
    const sanitizedName = sanitizeFilename(link.name);
    return `${timestamp}-${sanitizedName}.${extension}`;
  }

  return `${timestamp}-external-${index + 1}.${extension}`;
}

/**
 * Generate file path for monthly index
 * @param {string} baseDir - Base output directory
 * @param {string} year - Year
 * @param {string} groupName - Group name
 * @param {string} monthName - Month name
 * @returns {string} Full file path
 */
export function getMonthlyIndexPath(baseDir, year, groupName, monthName) {
  return join(
    baseDir,
    year,
    'Mis Grupos',
    groupName,
    monthName,
    '_index.md'
  );
}

/**
 * Generate file path for top-level index
 * @param {string} baseDir - Base output directory
 * @returns {string} Full file path
 */
export function getTopLevelIndexPath(baseDir) {
  return join(baseDir, '_index.md');
}

/**
 * Generate media filename with timestamp prefix
 * @param {Object} post - Post data object
 * @param {string} originalUrl - Original media URL
 * @param {string} type - 'image' or 'video'
 * @param {number} index - Media index in post
 * @returns {string} Generated filename
 */
export function generateMediaFilename(post, originalUrl, type, index) {
  const date = parseTimestamp(post.timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  const timestamp = `${month}-${day}-${hour}-${minute}`;

  // Extract original filename from URL (keeping all prefixes like large_, thumb_, etc.)
  const originalFilename = getFilenameFromUrl(originalUrl);

  // Extract extension from URL
  const extension = getExtensionFromUrl(originalUrl, type);

  // If we extracted a meaningful filename, use it; otherwise fall back to type-index
  if (originalFilename) {
    return `${timestamp}-${originalFilename}.${extension}`;
  }

  return `${timestamp}-${type}-${index + 1}.${extension}`;
}

/**
 * Extract original filename from URL path (without extension)
 * @param {string} url - Media URL
 * @returns {string|null} Filename without extension, or null if not found
 */
function getFilenameFromUrl(url) {
  try {
    // Parse URL and get the pathname
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Get the last segment of the path (the filename with extension)
    const segments = pathname.split('/');
    const filenameWithExt = segments[segments.length - 1];

    if (!filenameWithExt) {
      return null;
    }

    // Remove the extension to get the base filename
    const lastDotIndex = filenameWithExt.lastIndexOf('.');
    if (lastDotIndex > 0) {
      return filenameWithExt.substring(0, lastDotIndex);
    }

    // If no extension found, return the whole filename
    return filenameWithExt;
  } catch (error) {
    // If URL parsing fails, return null
    return null;
  }
}

/**
 * Extract file extension from URL
 * @param {string} url - Media URL
 * @param {string} type - 'image' or 'video'
 * @returns {string} File extension
 */
function getExtensionFromUrl(url, type) {
  // Try to extract from URL
  const match = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (match) {
    return match[1].toLowerCase();
  }

  // Default extensions
  return type === 'image' ? 'jpg' : 'mp4';
}

/**
 * Generate post filename (without extension)
 * @param {Object} post - Post data object
 * @returns {string} Filename without extension
 */
export function generatePostFilename(post) {
  const date = parseTimestamp(post.timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  const timestamp = `${month}-${day}-${hour}-${minute}`;

  if (post.title && post.title.trim()) {
    const sanitizedTitle = sanitizeFilename(post.title);
    return `${timestamp}-${sanitizedTitle}`;
  }

  return timestamp;
}

/**
 * Get relative path from Messages folder to media file
 * @param {string} mediaType - 'Images' or 'Videos'
 * @param {string} filename - Media filename
 * @returns {string} Relative path
 */
export function getRelativeMediaPath(mediaType, filename) {
  return `../${mediaType}/${filename}`;
}

/**
 * Get relative path from Messages folder to external links file
 * @param {string} filename - External links filename
 * @returns {string} Relative path
 */
export function getRelativeExternalLinksPath(filename) {
  return `../External_Links/${filename}`;
}

/**
 * Create directory structure for a post
 * @param {string} baseDir - Base output directory
 * @param {Object} post - Post data object
 */
export async function createPostDirectories(baseDir, post) {
  const date = parseTimestamp(post.timestamp);
  const year = date.getFullYear();
  const month = getMonthName(date);

  await createMonthStructure(baseDir, String(year), post.groupName, month);
}

/**
 * Group posts by month for index generation
 * @param {Array} posts - Array of post objects
 * @returns {Object} Posts grouped by 'YYYY-MM' keys
 */
export function groupPostsByMonth(posts) {
  const grouped = {};

  for (const post of posts) {
    const date = parseTimestamp(post.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const key = `${year}-${month}`;

    if (!grouped[key]) {
      grouped[key] = {
        year: String(year),
        monthName: getMonthName(date),
        posts: []
      };
    }

    grouped[key].posts.push(post);
  }

  return grouped;
}
