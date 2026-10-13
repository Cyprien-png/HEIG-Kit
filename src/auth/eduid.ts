import * as cheerio from "cheerio";
import { type Page, type Session, parseForm } from "../http.js";

export interface Credentials {
  email: string;
  password: string;
  /** Returns a code from the authenticator app when edu-ID asks for two-step login, or undefined if none is available. */
  otp?: () => Promise<string | undefined>;
}

/**
 * Thrown when edu-ID asks for a two-step login code that could not be provided. `page` is the code page:
 * passing it back to `loginWithEduId` with a code resumes the login while the edu-ID flow is still valid.
 */
export class MfaRequiredError extends Error {
  constructor(
    readonly page: Page,
    readonly invalidCode: boolean,
  ) {
    super(invalidCode ? "edu-ID rejected the two-step login code" : "edu-ID two-step login code required");
  }
}

const IDP_HOST = /(^|\.)login\.eduid\.ch$/;
const MAX_STEPS = 10;

/**
 * Walks through the SWITCH edu-ID (Shibboleth IdP) login flow starting from a
 * service provider page that redirected to it, and returns the page reached
 * once the SAML assertion has been posted back to the service provider.
 */
export async function loginWithEduId(session: Session, start: Page, creds: Credentials): Promise<Page> {
  let page = start;
  let passwordSubmitted = false;
  let otpSubmitted = false;

  for (let i = 0; i < MAX_STEPS; i++) {
    const $ = cheerio.load(page.html);

    // Final step: auto-submitted form carrying the SAML assertion to the service provider.
    if ($("input[name=SAMLResponse]").length > 0) {
      return session.submit(parseForm(page, "form:has(input[name=SAMLResponse])")!);
    }

    if (!IDP_HOST.test(new URL(page.url).hostname)) {
      return page;
    }

    if ($("input[name=j_otp]").length > 0) {
      const code = otpSubmitted ? undefined : (await creds.otp?.())?.replace(/\s/g, "");
      if (!code) throw new MfaRequiredError(page, otpSubmitted);
      otpSubmitted = true;
      // "Don't ask again for some time": edu-ID then skips two-step login while the saved cookies are valid.
      page = await session.submit(parseForm(page, "form:has(input[name=j_otp])")!, {
        j_otp: code,
        rememberBrowser: "true",
        _eventId_submit: "",
      });
    } else if ($("input[name=j_password]").length > 0) {
      if (passwordSubmitted) {
        throw new Error("edu-ID rejected the credentials, check HEIG_EMAIL / HEIG_PASSWORD in .env");
      }
      passwordSubmitted = true;
      page = await session.submit(parseForm(page, "form:has(input[name=j_password])")!, {
        j_username: creds.email,
        j_password: creds.password,
        _eventId_proceed: "",
      });
    } else if ($("input[name=j_username]").length > 0) {
      page = await session.submit(parseForm(page, "form:has(input[name=j_username])")!, {
        j_username: creds.email,
        _eventId_submit: "",
      });
    } else if ($("input[name=shib_idp_ls_supported]").length > 0) {
      // Browser local storage probe, answered as a browser without local storage.
      page = await session.submit(parseForm(page)!, { shib_idp_ls_supported: "false", _eventId_proceed: "" });
    } else {
      throw new Error(
        `Unexpected edu-ID step at ${page.url} (terms to accept or an unsupported two-step login method?). ` +
          "Rerun with --debug and inspect .cache/debug/",
      );
    }
  }

  throw new Error(`edu-ID login did not complete after ${MAX_STEPS} steps`);
}
