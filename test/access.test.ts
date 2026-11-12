import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { test } from "node:test";
import { z } from "zod";
import { CAMPUS_API, CAMPUS_TOOLS, NO_CAMPUS_MESSAGE, NoCampusAccess, hasCampusAccess, requireCampusAccess } from "../src/accounts/access.js";
import { currentIdentity, runAs } from "../src/identity.js";
import { bindTools } from "../src/mcp/common.js";

test("an account without edu-ID: what comes from GAPS and Cyberlearn is closed, the rest is not", () => {
  for (const path of ["/api/campus/grades", "/api/calendar", "/api/calendar/events/x", "/api/calendars", "/api/me/sync"]) assert.ok(CAMPUS_API.test(path), path);
  for (const path of ["/api/decks", "/api/quizzes", "/api/library", "/api/kb/search", "/api/corrections", "/api/profile", "/api/auth/me", "/api/calendarx"]) assert.equal(CAMPUS_API.test(path), false, path);
  assert.equal(hasCampusAccess({ id: 2, role: "student", access: "campus" }), true);
  assert.equal(hasCampusAccess({ id: 2, role: "admin", access: "local" }), false, "the role changes nothing");
  // A single-user installation has no such choice.
  assert.equal(hasCampusAccess({ id: 1, role: "admin" }), true);
  assert.throws(() => runAs({ id: 2, role: "student", access: "local" }, () => requireCampusAccess()), NoCampusAccess);
  runAs({ id: 2, role: "student", access: "campus" }, () => requireCampusAccess());
});

test("its agents get a plain refusal from the tools of GAPS, Cyberlearn and the calendar", async () => {
  const tools = new Map<string, (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>>();
  const build = (access: "campus" | "local") => {
    const server = new McpServer({ name: "t", version: "0" });
    bindTools(server, { id: 7, role: "student", access });
    for (const name of ["get_grades", "get_calendar", "set_calendar_event", "list_decks"]) {
      server.registerTool(name, { description: name, inputSchema: { x: z.string().optional() } }, async () => ({ content: [{ type: "text" as const, text: `ran ${name} as ${currentIdentity()?.id}` }] }));
    }
    const registered = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<never> }> })._registeredTools;
    for (const [name, tool] of Object.entries(registered)) tools.set(name, (args) => tool.handler(args, {}));
  };
  build("local");
  for (const name of ["get_grades", "get_calendar", "set_calendar_event"]) {
    assert.ok(CAMPUS_TOOLS.has(name));
    const result = await tools.get(name)!({});
    assert.equal(result.isError, true, name);
    assert.equal(result.content[0].text, NO_CAMPUS_MESSAGE);
  }
  assert.equal((await tools.get("list_decks")!({})).content[0].text, "ran list_decks as 7");
  build("campus");
  assert.equal((await tools.get("get_grades")!({})).content[0].text, "ran get_grades as 7");
});
