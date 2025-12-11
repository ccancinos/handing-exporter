# Handing Backup Tool

Automated backup and archival tool for [Handing.co](https://handing.co/) kindergarten communication platform. Downloads all posts, images, videos, and comments from your child's groups and exports them to markdown format for use with [Obsidian](https://obsidian.md/) or any markdown-based note-taking system.

## Features

- **Complete Backup**: Downloads all posts, images, videos, and comments from all your groups
- **Markdown Export**: Converts posts to markdown with frontmatter metadata
- **Organized Structure**: Creates an intuitive filesystem organized by year/group/month
- **Smart Updates**: Only downloads new content on subsequent runs (incremental backups)
- **Google Photos Gallery Extraction**: Automatically downloads all images from Google Photos shared albums with advanced lazy-loading support (250+ images per album)
- **External File Downloads**: Downloads PDFs, documents, and other attachments directly from external links
- **Resume Capability**: Retries failed downloads automatically with exponential backoff
- **Obsidian-Ready**: Generated markdown files work seamlessly with Obsidian's linking system

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- Google Chrome (the tool uses your system's Chrome browser)

## Installation

1. Clone or download this repository:
```bash
git clone <repository-url>
cd handing-backup
```

2. Install dependencies:
```bash
npm install
```

3. Create your configuration file:
```bash
cp config.example.json config.json
```

4. Edit `config.json` with your Handing credentials:
```json
{
  "email": "your-email@example.com",
  "password": "your-password",
  "outputDir": "./output",
  ...
}
```

**Important**: Never commit `config.json` to version control (it's already in `.gitignore`).

## Usage

### Full Backup

Run the backup for all configured groups:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### Testing Commands

Test a single post (useful for debugging):
```bash
npm run test-post <POST_URL>

# Example:
npm run test-post https://newmodel.handing.co/posts/3797322
```

Test archive group processing (visible browser for debugging):
```bash
npm run test-archive-groups
```

**Note**: Test commands run in non-headless mode so you can watch the scraping process, which is especially useful for debugging Google Photos lazy loading.

## Output Structure

The tool creates the following directory structure:

```
output/
├── _index.md                      # Top-level navigation (optional)
└── 2025/
    └── Mis Grupos/
        ├── Sala de 4A/
        │   └── 01_Enero/
        │       ├── _index.md      # Monthly summary (optional)
        │       ├── Messages/      # Markdown files for each post
        │       ├── Images/        # Downloaded images
        │       ├── Videos/        # Downloaded videos
        │       ├── External_Files/ # Successfully downloaded external files (PDFs, docs, etc.)
        │       └── External_Links/ # Reference files for non-downloadable external links
        ├── Sala de 5A/
        └── 6to Grado/
```

**Note**: Month folders use numbered prefixes (01_Enero, 02_Febrero, etc.) to ensure correct chronological sorting.

### Naming Conventions

- **Posts**: `MM-DD-HH-MM-Title.md` (e.g., `01-14-08-04-Día de la Tradicion.md`)
- **Media**: `MM-DD-HH-MM-type-N.ext` (e.g., `01-14-08-04-image-1.jpg`)
- **External Links**: `MM-DD-HH-MM-Title-links.md`

### Post Markdown Format

Each post is saved as a markdown file with frontmatter:

```markdown
---
title: Día de la Tradición
date: 2025-01-14T08:04:00
author: Carla Peysere
group: Sala de 4A
likes: 16
---

Post content goes here...

## Images
![image-1](../Images/01-14-08-04-image-1.jpg)

## Videos
- [01-14-08-04-video-1.mp4](../Videos/01-14-08-04-video-1.mp4)

## External Links
See [external links file](../External_Links/01-14-08-04-Día%20de%20la%20Tradicion-links.md)

## Comments (3 total)
**Sofia Moreira** - 2025-01-14T16:15:00 (❤️ 2)
> Great celebration!
```

## Configuration Options

Edit `config.json` to customize behavior:

```json
{
  "email": "your-email@example.com",
  "password": "your-password",
  "outputDir": "./output",
  "groups": [
    {
      "name": "Sala de 4A",
      "url": "https://newmodel.handing.co/groups/648370/timeline"
    },
    {
      "name": "Sala de 5A",
      "url": "https://newmodel.handing.co/groups/123456/timeline"
    }
  ],
  "mediaStrategy": {
    "downloadImages": true,      // Download images
    "downloadVideos": true,      // Download videos
    "maxRetries": 3,             // Retry failed downloads
    "timeout": 30000             // Download timeout (ms)
  },
  "scraping": {
    "headless": true,            // Run browser in background
    "scrollDelay": 1000,         // Delay between scrolls (ms)
    "maxRetries": 3,             // Retry failed operations
    "userAgent": "Mozilla/5.0..."
  },
  "filesystem": {
    "generateMonthlyIndex": true,    // Create _index.md per month
    "generateTopLevelIndex": true,   // Create top-level _index.md
    "sanitizeFilenames": true        // Remove invalid filename chars
  },
  "downloaders": {
    "enableGalleries": true,         // Enable Google Photos gallery extraction
    "maxImagesPerGallery": 100       // Max images to extract per gallery (0 = unlimited)
  }
}
```

**Important**: To find your group URLs, navigate to the group's timeline page in your browser and copy the URL. It should look like `https://newmodel.handing.co/groups/[GROUP_ID]/timeline`.

## How It Works

1. **Authentication**: Logs into Handing.co with your credentials
2. **Group Processing**: Processes each group configured in your `config.json` (groups are manually specified with their URLs)
3. **Content Extraction**: For each group, scrolls through the timeline and extracts:
   - Post title, content, author, timestamp, likes
   - Images and videos
   - External links (Google Photos, Drive, etc.)
   - Comments and nested replies
4. **Media Download**: Downloads all media files with retry logic and exponential backoff
5. **Gallery Extraction**: For Google Photos albums, uses specialized lazy-loading extraction to download all images
6. **External File Download**: Attempts direct download of PDFs, documents, and other external files
7. **Organization**: Creates directory structure and markdown files organized by year/group/month
8. **Tracking**: Updates per-group manifest files (e.g., `manifest-sala-de-5a.json`) to track downloaded content

## Smart Updates

The tool maintains per-group manifest files (e.g., `manifest-sala-de-5a.json`) that track:
- Which posts have been downloaded
- Status of each media file (downloaded/failed)
- Timestamps for incremental updates
- Post metadata (title, URL, counts)

On subsequent runs, it will:
- Skip already-downloaded posts
- Download only new posts
- Retry failed media downloads
- Detect posts with new comments and re-generate markdown

To force a complete re-download of a specific group, simply delete or rename that group's manifest file (e.g., `manifest-sala-de-5a.json`).

## External Links & Downloads

The tool intelligently handles external links:

- **Google Photos Albums**: Automatically extracts and downloads all images from shared albums using specialized lazy-loading support. Successfully tested with albums containing 300+ images.
- **Direct File Links**: PDFs, documents, and other downloadable files are automatically downloaded to the `External_Files/` folder.
- **Non-downloadable Links**: Links that cannot be automatically downloaded (email addresses, forms requiring authentication, broken URLs) are saved as reference files in the `External_Links/` folder for manual review.

## Troubleshooting

### Authentication Failed
- Verify your credentials in `config.json`
- Check if Handing.co has changed their login flow
- Try running in non-headless mode: set `"headless": false` in config

### Downloads Failing
- Check your internet connection
- Increase timeout: `"timeout": 60000` in config
- Check if media URLs have expired (run backup more frequently)

### Missing Content
- Increase scroll delay: `"scrollDelay": 2000` in config
- Check browser console for errors (run with `"headless": false`)

## Privacy & Security

- **Credentials**: Your credentials are stored locally in `config.json` and never transmitted except to Handing.co
- **Data**: All downloaded content stays on your local machine
- **Purpose**: This tool is for personal backup and archival only
- **Rate Limiting**: Includes delays to avoid overwhelming the server

## License

MIT

## Disclaimer

This tool is not affiliated with or endorsed by Handing.co. Use responsibly and in accordance with Handing's terms of service. This is intended for personal backup purposes only.
