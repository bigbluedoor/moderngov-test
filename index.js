#!/usr/bin/env node
import { program } from 'commander';

import { resolveOptions } from './src/config.js';
import { createApp, listen } from './src/server.js';

program
  .name('moderngov-test')
  .description('Utility package usefull to test moderngov template implementation.')
  .version('1.0.0');

program
  .option('--moderngovUrl <url>', 'The URL of the live ModernGov site.')
  .option('--localDevUrl <url>', 'The URL of the local development site\'s template for ModernGov.')
  .option('--pagetitleSelector <selector>', 'The css selector of the element containing the pagetitle on the live ModernGov site.')
  .option('--breadcrumbSelector <selector>', 'The css selector of the element containing the breadcrumb on the live ModernGov site.')
  .option('--contentSelector <selector>', 'The css selector of the element containing the content on the live ModernGov site.')
  .option('--sidenavSelector <selector>', 'The css selector of the element containing the sidenav on the live ModernGov site.')
  .option('--moderngovAssets <assets>', 'Comma separated list of moderngov assets, e.g. css and js.')
  .action(async (cliOptions) => {
    let options;

    try {
      options = resolveOptions(cliOptions);
    } catch (error) {
      program.error(error.message, { exitCode: 1 });
    }

    try {
      const server = await listen(createApp(options));
      const { port } = server.address();

      console.log(`moderngov-test is running on http://localhost:${port}`);
      console.log(`  ModernGov site:  ${options.moderngovUrl}`);
      console.log(`  Local template:  ${options.localDevUrl}`);
    } catch (error) {
      program.error(`Unable to start the server: ${error.message}`, { exitCode: 1 });
    }
  });

program.parse();
