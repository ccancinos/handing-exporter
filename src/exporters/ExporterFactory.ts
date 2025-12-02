/**
 * Exporter Factory
 *
 * Automatically selects the appropriate exporter based on configuration
 */

import { Exporter, Config } from '../types.js';
import { MarkdownExporter } from './MarkdownExporter.js';
import { HtmlExporter } from './HtmlExporter.js';

export class ExporterFactory {
  static getExporter(config: Config): Exporter {
    const format = config.outputFormat || 'markdown';

    switch (format) {
      case 'html':
        return new HtmlExporter();
      case 'markdown':
      default:
        return new MarkdownExporter();
    }
  }
}
