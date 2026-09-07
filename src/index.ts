#!/usr/bin/env node
import { program } from 'commander';

import { resolveOptions, type CliOptions, type Options } from './config.js';
import { createApp, listen, portOf } from './server.js';
import { errorMessage } from './utils.js';

program
  .name('moderngov-test')
  .description('Utility package usefull to test moderngov template implementation.')
  .version('1.0.0');

program
  .option('-c, --config <file>', 'Config.json file path')
  .option('--moderngovUrl <url>', 'The URL of the live ModernGov site.')
  .option('--localDevUrl <url>', 'The URL of the local development site\'s template for ModernGov.')
  .option('--pagetitleSelector <selector>', 'The css selector of the element containing the pagetitle on the live ModernGov site.')
  .option('--breadcrumbSelector <selector>', 'The css selector of the element containing the breadcrumb on the live ModernGov site.')
  .option('--contentSelector <selector>', 'The css selector of the element containing the content on the live ModernGov site.')
  .option('--sidenavSelector <selector>', 'The css selector of the element containing the sidenav on the live ModernGov site.')
  .option('--moderngovAssets <assets>', 'Comma separated list of moderngov assets, e.g. css and js.')
  .action(async (cliOptions: CliOptions) => {
    let options: Options;

    try {
      options = resolveOptions(cliOptions);
    } catch (error) {
      // program.error() exits, so nothing below runs on a bad config.
      program.error(errorMessage(error), { exitCode: 1 });
    }

    try {
      const server = await listen(createApp(options));

      console.log(`moderngov-test is running on http://localhost:${String(portOf(server))}`);
      console.log(`  ModernGov site:  ${options.moderngovUrl}`);
      console.log(`  Local template:  ${options.localDevUrl}`);
    } catch (error) {
      program.error(`Unable to start the server: ${errorMessage(error)}`, { exitCode: 1 });
    }
  });

await program.parseAsync();
