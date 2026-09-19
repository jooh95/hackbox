// Best-effort mapping from a free-text finding title/description to an
// OWASP Top 10 (2021) category. Scanner output rarely names the category
// directly, so this is a keyword heuristic, not an authoritative classifier.
const RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /sql injection|nosql injection|command injection|code injection|xpath/i, category: "A03: Injection" },
  { pattern: /cross site scripting|\bxss\b/i, category: "A03: Injection" },
  { pattern: /authentication|session|password|credential/i, category: "A07: Identification and Authentication Failures" },
  { pattern: /access control|authorization|directory browsing|path traversal/i, category: "A01: Broken Access Control" },
  { pattern: /ssrf|server side request forgery/i, category: "A10: Server-Side Request Forgery" },
  { pattern: /encryption|tls|ssl|certificate|cleartext/i, category: "A02: Cryptographic Failures" },
  { pattern: /csrf|cross site request forgery/i, category: "A01: Broken Access Control" },
  { pattern: /deserialization/i, category: "A08: Software and Data Integrity Failures" },
  { pattern: /outdated|vulnerable component|dependency/i, category: "A06: Vulnerable and Outdated Components" },
  { pattern: /logging|monitoring/i, category: "A09: Security Logging and Monitoring Failures" },
  {
    pattern: /header|cookie|csp|content security policy|clickjack|x-frame|x-content-type|misconfiguration|banner|disclosure|cache-control/i,
    category: "A05: Security Misconfiguration",
  },
];

export function categorizeFinding(title: string, description: string): string {
  const haystack = `${title} ${description}`;
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return "A05: Security Misconfiguration";
}
