/**
 * Configuration Management
 *
 * Loads and validates configuration from config.json
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Config } from './types.js';

export async function loadConfig(): Promise<Config> {
  const configPath = resolve(process.cwd(), 'config.json');

  try {
    const configData = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);

    // Validate required fields
    validateConfig(config);

    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'config.json not found. Please copy config.example.json to config.json and fill in your credentials.'
      );
    }
    throw error;
  }
}

function validateConfig(config: any): void {
  const required = ['email', 'password', 'outputDir', 'groups'];

  for (const field of required) {
    if (!config[field]) {
      throw new Error(`Missing required field in config.json: ${field}`);
    }
  }

  // Check for example values that haven't been changed
  if (config.email === 'your-email@example.com') {
    throw new Error('Please update config.json with your actual Handing credentials');
  }

  // Validate groups array
  if (!Array.isArray(config.groups) || config.groups.length === 0) {
    throw new Error('config.json must include at least one group in the "groups" array');
  }

  for (const group of config.groups) {
    if (!group.name || !group.url) {
      throw new Error('Each group must have a "name" and "url" field');
    }
    if (!group.url.includes('newmodel.handing.co')) {
      throw new Error(`Invalid group URL: ${group.url}. Must be a Handing timeline URL.`);
    }
  }
}
