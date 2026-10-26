// An in-memory stand-in for Google's OAuth token endpoint and the Sheets v4 API. No network.
type Tab = { sheetId: number; title: string; rowCount: number; columnCount: number; frozen: number; values: (string | number)[][] };
type Book = { id: string; url: string; title: string; tabs: Tab[] };

export class FakeSheets {
  books = new Map<string, Book>();
  calls: string[] = [];
  refreshRejected = false;
  failNext: { status: number; message: string } | null = null;
  private nextId = 1;

  book(id: string) {
    const b = this.books.get(id);
    if (!b) throw new Error(`no spreadsheet ${id}`);
    return b;
  }

  // The visible contents of a tab, trimmed to its grid like the real thing.
  tab(id: string, title = "Transactions") {
    const tab = this.book(id).tabs.find((t) => t.title === title);
    if (!tab) throw new Error(`no tab ${title}`);
    return tab.values.slice(0, tab.rowCount).filter((r) => r.some((v) => v !== ""));
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const method = init?.method ?? "GET";

    if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
      if (this.refreshRejected) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      return json({ access_token: "sheets-access", expires_in: 3600 });
    }
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/revoke") return json({});
    if (u.host !== "sheets.googleapis.com") return json({ error: "unexpected host" }, 500);
    if (new Headers(init?.headers).get("Authorization") !== "Bearer sheets-access") return json({ error: { status: "UNAUTHENTICATED" } }, 401);

    const path = decodeURIComponent(u.pathname.replace("/v4/spreadsheets", ""));
    this.calls.push(`${method} ${path || "/"}`);
    if (this.failNext) {
      const { status, message } = this.failNext;
      this.failNext = null;
      return json({ error: { code: status, message, status: "ERROR" } }, status);
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (method === "POST" && path === "") {
      // Seen from the real API: it rejects this locale at creation.
      if (body.properties.locale === "en_IN") return json({ error: { code: 400, message: "Invalid properties: Unsupported locale: en_IN" } }, 400);
      const id = `sheet-${this.nextId++}`;
      const props = body.sheets[0].properties;
      const book: Book = {
        id,
        url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
        title: body.properties.title,
        tabs: [{ sheetId: 0, title: props.title, rowCount: 1000, columnCount: 26, frozen: props.gridProperties?.frozenRowCount ?? 0, values: [] }],
      };
      this.books.set(id, book);
      return json(this.describe(book));
    }

    const m = /^\/([^/:]+)(?::batchUpdate|\/values\/(.+?)(:clear)?)?$/.exec(path);
    if (!m) return json({ error: { message: "bad path" } }, 400);
    const book = this.books.get(m[1]);
    if (!book) return json({ error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } }, 404);

    if (method === "GET" && !m[2]) return json(this.describe(book));
    if (path.endsWith(":batchUpdate")) {
      const replies = [];
      for (const r of body.requests) {
        if (r.addSheet) {
          const tab: Tab = { sheetId: book.tabs.length + 100, title: r.addSheet.properties.title, rowCount: 1000, columnCount: 26, frozen: 1, values: [] };
          book.tabs.push(tab);
          replies.push({ addSheet: { properties: { sheetId: tab.sheetId, title: tab.title } } });
        } else if (r.updateSheetProperties) {
          const p = r.updateSheetProperties.properties;
          const tab = book.tabs.find((t) => t.sheetId === p.sheetId)!;
          const g = p.gridProperties;
          if (g.frozenRowCount >= g.rowCount) return json({ error: { code: 400, message: "You can't freeze all visible rows on the sheet." } }, 400);
          tab.rowCount = g.rowCount;
          tab.columnCount = g.columnCount;
          tab.frozen = g.frozenRowCount;
          tab.values = tab.values.slice(0, g.rowCount).map((row) => row.slice(0, g.columnCount));
          replies.push({});
        }
      }
      return json({ replies });
    }

    const range = /^(.+)!A(\d+):([A-Z]+)(\d+)$/.exec(m[2]);
    if (!range) return json({ error: { message: `bad range ${m[2]}` } }, 400);
    const tab = book.tabs.find((t) => t.title === range[1]);
    if (!tab) return json({ error: { message: "Unable to parse range" } }, 400);
    const first = Number(range[2]) - 1;
    const last = Number(range[4]) - 1;
    if (last >= tab.rowCount) return json({ error: { code: 400, message: `Range exceeds grid limits. Max rows: ${tab.rowCount}` } }, 400);

    if (m[3] === ":clear") {
      for (let r = first; r <= last; r++) tab.values[r] = [];
      return json({});
    }
    if (method === "PUT") {
      if (u.searchParams.get("valueInputOption") !== "RAW") return json({ error: { message: "expected RAW" } }, 400);
      (body.values as (string | number)[][]).forEach((row, i) => (tab.values[first + i] = row));
      return json({ updatedRows: body.values.length });
    }
    return json({ error: { message: "unsupported" } }, 400);
  };

  private describe(book: Book) {
    return {
      spreadsheetId: book.id,
      spreadsheetUrl: book.url,
      sheets: book.tabs.map((t) => ({ properties: { sheetId: t.sheetId, title: t.title, gridProperties: { rowCount: t.rowCount, columnCount: t.columnCount } } })),
    };
  }
}
