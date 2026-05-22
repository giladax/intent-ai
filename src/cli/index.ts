#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { up, down } from "./infra.js";
import { registerDigestCommand } from "./digest.js";
import { registerExploreCommand } from "./explore.js";

const program = new Command();

program
  .name("intent")
  .description("Execution memory system for Claude Code conversations")
  .version("1.0.0");

registerDigestCommand(program);
registerExploreCommand(program);

program
  .command("eval")
  .description("Run evaluation harness against digests")
  .action(() => {
    console.log("eval: not yet implemented");
  });

program
  .command("up")
  .description("Start database and run migrations")
  .action(() => {
    up();
  });

program
  .command("down")
  .description("Stop database")
  .action(() => {
    down();
  });

program.parse();
