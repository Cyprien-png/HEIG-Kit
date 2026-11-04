import type { Module } from "./module.js";
import { campus } from "./modules/campus.js";
import { claude } from "./modules/claude.js";
import { documents } from "./modules/documents.js";
import { knowledge } from "./modules/knowledge.js";
import { remote } from "./modules/remote.js";
import { shortcuts } from "./modules/shortcuts.js";
import { visuals } from "./modules/visuals.js";
import { voice } from "./modules/voice.js";
import { web } from "./modules/web.js";

/** Every module, in installation order (the Claude Code plugin last, so it can register the MCP server). */
export const MODULES: Module[] = [campus, knowledge, documents, visuals, voice, web, remote, shortcuts, claude];
