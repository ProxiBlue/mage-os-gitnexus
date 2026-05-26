#!/usr/bin/env node
import { Command } from 'commander';
import { augment } from './augment.js';

const program = new Command();

program
  .name('gitnexus-magento')
  .description('Magento 2 / Mage-OS XML graph augmenter for GitNexus')
  .version('0.1.0');

program
  .command('augment')
  .description('Parse Magento XML configs and inject edges into GitNexus graph')
  .argument('[path]', 'Path to Magento project root', process.cwd())
  .action(async (projectPath: string) => {
    try {
      await augment(projectPath);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
