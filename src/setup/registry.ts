import type { Module } from "./module.js";
import { campus } from "./modules/campus.js";
import { claude } from "./modules/claude.js";
import { knowledge } from "./modules/knowledge.js";
import { shortcuts } from "./modules/shortcuts.js";

/** Every module, in installation order (the Claude Code plugin last, so it can register the MCP server). */
export const MODULES: Module[] = [campus, knowledge, shortcuts, claude];
