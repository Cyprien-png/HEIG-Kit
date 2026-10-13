import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import makeFetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

const MAX_REDIRECTS = 20;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export interface Page {
  url: string;
  status: number;
  html: string;
}

export interface Form {
  action: string;
  method: string;
  fields: Record<string, string>;
}

export interface SessionOptions {
  /** File where cookies are kept between runs, so logins (and edu-ID two-step login) are not repeated. */
  cookieFile?: string;
  /** Directory where every visited page is saved, for troubleshooting. */
  debugDir?: string;
}

/** HTTP client keeping cookies across requests, like a browser session. */
export class Session {
  private readonly fetch: typeof fetch;
  private step = 0;

  private constructor(
    private readonly jar: CookieJar,
    private readonly options: SessionOptions,
  ) {
    this.fetch = makeFetchCookie(fetch, jar);
  }

  /** Opens a session, restoring the cookies saved in `cookieFile` if any. */
  static async open(options: SessionOptions = {}): Promise<Session> {
    let jar = new CookieJar();
    if (options.cookieFile) {
      try {
        jar = CookieJar.fromJSON(await readFile(options.cookieFile, "utf-8"));
      } catch {
        // No saved session yet, or an unreadable one: start from scratch.
      }
    }
    return new Session(jar, options);
  }

  /** Saves the cookies to `cookieFile`, readable by the current user only since they grant access to the account. */
  async save(): Promise<void> {
    const file = this.options.cookieFile;
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(this.jar.toJSON()), { mode: 0o600 });
    await chmod(file, 0o600);
  }

  async get(url: string): Promise<Page> {
    return this.request(url, { method: "GET" });
  }

  async submit(form: Form, overrides: Record<string, string> = {}): Promise<Page> {
    const body = new URLSearchParams({ ...form.fields, ...overrides });
    if (form.method === "get") {
      const url = new URL(form.action);
      body.forEach((value, key) => url.searchParams.set(key, value));
      return this.get(url.toString());
    }
    return this.request(form.action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  /**
   * Follows redirects itself so it can stop at a redirect to a non-web URL (e.g. `moodlemobile://token=…`,
   * how Moodle hands its mobile app token over), returned as a page with that URL and an empty body.
   */
  private async request(url: string, init: RequestInit): Promise<Page> {
    let current = url;
    let currentInit = init;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const res = await this.fetch(current, {
        ...currentInit,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, ...currentInit.headers },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        current = new URL(location, current).toString();
        if (!/^https?:/.test(current)) return { url: current, status: res.status, html: "" };
        // Like browsers, 307/308 replay the request; other redirects become a GET.
        if (res.status !== 307 && res.status !== 308) currentInit = { method: "GET" };
        continue;
      }
      const page = { url: current, status: res.status, html: await decodeBody(res) };
      await this.dump(page);
      return page;
    }
    throw new Error(`Too many redirects from ${url}`);
  }

  private async dump(page: Page): Promise<void> {
    const debugDir = this.options.debugDir;
    if (!debugDir) return;
    await mkdir(debugDir, { recursive: true });
    const name = `${String(++this.step).padStart(2, "0")}-${new URL(page.url).hostname}.html`;
    await writeFile(path.join(debugDir, name), `<!-- ${page.status} ${page.url} -->\n${page.html}`);
  }
}

/** Decodes the body using the charset announced by the server (GAPS is iso-8859-1). */
async function decodeBody(res: Response): Promise<string> {
  const buffer = await res.arrayBuffer();
  const charset = /charset=([^;]+)/i.exec(res.headers.get("content-type") ?? "")?.[1]?.trim();
  try {
    return new TextDecoder(charset ?? "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/** Extracts a form and its default field values, resolving its action against the page URL. */
export function parseForm(page: Page, selector = "form"): Form | undefined {
  const $ = cheerio.load(page.html);
  const form = $(selector).first();
  if (form.length === 0) return undefined;

  const fields: Record<string, string> = {};
  form.find("input[name], textarea[name]").each((_, el) => {
    const input = $(el);
    const type = input.attr("type")?.toLowerCase();
    if ((type === "checkbox" || type === "radio") && input.attr("checked") === undefined) return;
    if (type === "submit") return;
    fields[input.attr("name")!] = input.val()?.toString() ?? "";
  });

  return {
    action: new URL(form.attr("action") ?? page.url, page.url).toString(),
    method: (form.attr("method") ?? "get").toLowerCase(),
    fields,
  };
}
