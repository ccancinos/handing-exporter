/**
 * Manifest Management
 *
 * Tracks download state to enable smart updates and resume capability
 * Each group has its own manifest file
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { sanitizeFilename } from './utils.js';

/**
 * Generate manifest file path for a group
 * @param {string} groupName - Group name
 * @returns {string} Manifest file path
 */
function getManifestPath(groupName) {
  const sanitized = sanitizeFilename(groupName)
    .toLowerCase()
    .replace(/\s+/g, '-');
  return resolve(process.cwd(), `manifest-${sanitized}.json`);
}

/**
 * Load manifest from disk for a specific group
 * @param {string} groupName - Group name
 * @returns {Promise<Object>} Manifest object
 */
export async function loadManifest(groupName) {
  const manifestPath = getManifestPath(groupName);

  try {
    const data = await readFile(manifestPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Manifest doesn't exist yet, create new one
      return createEmptyManifest(groupName);
    }
    throw error;
  }
}

/**
 * Save manifest to disk for a specific group
 * @param {string} groupName - Group name
 * @param {Object} manifest - Manifest object
 */
export async function saveManifest(groupName, manifest) {
  const manifestPath = getManifestPath(groupName);
  manifest.metadata.last_run = new Date().toISOString();
  const data = JSON.stringify(manifest, null, 2);
  await writeFile(manifestPath, data, 'utf-8');
}

/**
 * Create empty manifest structure
 * @param {string} groupName - Group name
 * @returns {Object} Empty manifest
 */
function createEmptyManifest(groupName) {
  return {
    metadata: {
      group_name: groupName,
      created_at: new Date().toISOString(),
      last_run: null,
      total_posts: 0,
      version: '1.1.0'  // Bumped for avatar support
    },
    posts: {},
    avatars: {}  // Track downloaded avatars
  };
}

/**
 * Check if a post exists in manifest
 * @param {Object} manifest - Manifest object
 * @param {string} postId - Post ID
 * @returns {boolean}
 */
export function hasPost(manifest, postId) {
  return postId in manifest.posts;
}

/**
 * Add or update post in manifest
 * @param {Object} manifest - Manifest object
 * @param {string} postId - Post ID
 * @param {Object} postData - Post data
 */
export function updatePost(manifest, postId, postData) {
  const existing = manifest.posts[postId];

  manifest.posts[postId] = {
    ...postData,
    first_downloaded: existing?.first_downloaded || new Date().toISOString(),
    last_updated: new Date().toISOString()
  };

  manifest.metadata.total_posts = Object.keys(manifest.posts).length;
}

/**
 * Mark media as downloaded
 * @param {Object} manifest - Manifest object
 * @param {string} postId - Post ID
 * @param {string} mediaId - Media ID
 * @param {Object} mediaData - Media data
 */
export function markMediaDownloaded(manifest, postId, mediaId, mediaData) {
  if (!manifest.posts[postId]) {
    throw new Error(`Post ${postId} not found in manifest`);
  }

  const media = manifest.posts[postId].media.find(m => m.id === mediaId);
  if (media) {
    media.status = 'downloaded';
    media.downloaded_at = new Date().toISOString();
    Object.assign(media, mediaData);
  }
}

/**
 * Get all failed media from manifest
 * @param {Object} manifest - Manifest object
 * @returns {Array} Array of failed media items with post context
 */
export function getFailedMedia(manifest: any) {
  const failed = [];

  for (const [postId, post] of Object.entries(manifest.posts)) {
    const postData = post as any;
    if (postData.media) {
      for (const media of postData.media) {
        if (media.status === 'failed' || media.status === 'pending') {
          failed.push({ postId, post, media });
        }
      }
    }
  }

  return failed;
}

/**
 * Check if a post is already processed (status = 'complete')
 * @param {Object} manifest - Manifest object
 * @param {string} postId - Post ID
 * @returns {boolean} True if post is complete
 */
export function isPostComplete(manifest: any, postId: string): boolean {
  return manifest.posts[postId]?.status === 'complete';
}

/**
 * Get list of failed posts for retry
 * @param {Object} manifest - Manifest object
 * @returns {string[]} Array of failed post IDs
 */
export function getFailedPosts(manifest: any): string[] {
  return Object.entries(manifest.posts)
    .filter(([_, post]) => (post as any).status === 'failed')
    .map(([id, _]) => id);
}

/**
 * Get processing statistics from manifest
 * @param {Object} manifest - Manifest object
 * @returns {Object} Statistics object
 */
export function getManifestStats(manifest: any) {
  const posts = Object.values(manifest.posts) as any[];
  return {
    total: posts.length,
    complete: posts.filter(p => p.status === 'complete').length,
    failed: posts.filter(p => p.status === 'failed').length,
    partial: posts.filter(p => p.status === 'partial').length
  };
}

/**
 * Check if avatar already downloaded
 * @param {Object} manifest - Manifest object
 * @param {string} author - Author name
 * @returns {boolean} True if avatar is complete
 */
export function hasAvatar(manifest: any, author: string): boolean {
  return manifest.avatars && manifest.avatars[author]?.status === 'complete';
}

/**
 * Update avatar in manifest
 * @param {Object} manifest - Manifest object
 * @param {string} author - Author name
 * @param {Object} avatarData - Avatar data (url, filename, status, error)
 */
export function updateAvatar(
  manifest: any,
  author: string,
  avatarData: { url: string; filename: string; status: 'complete' | 'failed'; error?: string }
): void {
  if (!manifest.avatars) {
    manifest.avatars = {};
  }

  manifest.avatars[author] = {
    author,
    url: avatarData.url,
    filename: avatarData.filename,
    downloaded_at: new Date().toISOString(),
    status: avatarData.status,
    error: avatarData.error
  };
}

/**
 * Get failed avatars for retry
 * @param {Object} manifest - Manifest object
 * @returns {Array} Array of failed avatar objects
 */
export function getFailedAvatars(manifest: any): Array<{ author: string; url: string; filename: string }> {
  if (!manifest.avatars) {
    return [];
  }

  return Object.values(manifest.avatars)
    .filter((avatar: any) => avatar.status === 'failed')
    .map((avatar: any) => ({
      author: avatar.author,
      url: avatar.url,
      filename: avatar.filename
    }));
}
