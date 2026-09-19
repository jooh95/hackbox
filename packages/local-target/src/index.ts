import express from "express";

// A deliberately unhardened sample app used only as a Hackbox test target.
// It intentionally has no security headers, an unescaped reflected query
// parameter, and a cookie without the HttpOnly flag, so a scan against it
// has something real to find. Never expose this outside a local network.

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.get("/", (_req, res) => {
  res.cookie("session", "demo-session-value"); // intentionally missing HttpOnly/Secure
  res.type("html").send(`
    <html>
      <body>
        <h1>Hackbox Sample Vulnerable Target</h1>
        <p>This app exists only to be scanned/load-tested by Hackbox.</p>
        <p><a href="/search?q=hello">Try the search endpoint</a></p>
      </body>
    </html>
  `);
});

// Deliberately vulnerable: reflects `q` into the page without escaping it,
// so an XSS payload in the query string comes back verbatim.
app.get("/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.type("html").send(`
    <html>
      <body>
        <h1>Search results</h1>
        <p>You searched for: ${q}</p>
      </body>
    </html>
  `);
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Hackbox sample vulnerable target listening on http://localhost:${port}`);
});
