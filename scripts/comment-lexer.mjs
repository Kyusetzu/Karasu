// Finds and strips comments per language, string- and regex-aware; the shared half of the two comment scripts.

const DIRECTIVE = /^\s*(@ts-(expect-error|ignore|nocheck|check)\b|eslint|biome-ignore|prettier-ignore|oxlint)/;

/** The paths the one-liner rule applies to, out of everything git tracks. */
export function inScope(path) {
  const p = path.replace(/\\/g, "/");
  if (p.startsWith("site/") || p.startsWith(".claude/")) return false;
  if (p === "vite.config.ts" || p === "vitest.setup.ts" || p === "index.html") return true;
  if (p.startsWith("src/") && /\.(ts|tsx|css)$/.test(p)) return true;
  if (p.startsWith("src-tauri/src/") && p.endsWith(".rs")) return true;
  if (p.startsWith("scripts/") && /\.(mjs|js|ts|tsx|ps1|sh|html)$/.test(p)) return true;
  if (p.startsWith("src-tauri/gen/android/") && /\.(kt|kts)$/.test(p)) return true;
  if (p.startsWith(".github/workflows/") && /\.ya?ml$/.test(p)) return true;
  return false;
}

/** The language a path is lexed as, or `null` for a file outside the vocabulary. */
export function langFor(path) {
  const p = path.replace(/\\/g, "/");
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "rs":
      return "rs";
    case "ts":
    case "tsx":
      return "ts";
    case "js":
    case "mjs":
    case "cjs":
      return "js";
    case "kt":
    case "kts":
      return "kt";
    case "css":
      return "css";
    case "yml":
    case "yaml":
      return "yml";
    case "ps1":
      return "ps1";
    case "sh":
      return "sh";
    case "html":
      return "html";
    default:
      return null;
  }
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function isIdent(ch) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

// The C family: Rust, TypeScript/JavaScript, Kotlin and CSS share one scanner with per-language switches.
function lexC(text, lang) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  let desync = false;
  const nested = lang === "rs" || lang === "kt";
  const lineComments = lang !== "css";
  // A stack of template-literal frames for TS/JS backticks and Kotlin "${ }" strings.
  const templates = [];
  // The last significant character and word before the current position, for the regex heuristic.
  let prevChar = "";
  let prevWord = "";
  let wordBuf = "";

  const push = (start, end, kind) => {
    let content;
    const raw = text.slice(start, end);
    if (raw.startsWith("/*")) content = raw.slice(raw.startsWith("/**") && raw.length > 4 ? 3 : 2, -2);
    else if (raw.startsWith("///") || raw.startsWith("//!")) content = raw.slice(3);
    else content = raw.slice(2);
    tokens.push({ start, end, kind, text: content });
  };

  const regexAllowed = () => {
    if (prevChar === "") return true;
    if ("(,=:[!&|?{};+-*%~^".includes(prevChar)) return true;
    if (prevChar === ")" || prevChar === "]") return false;
    if (isIdent(prevChar)) {
      return /^(return|typeof|case|do|else|in|of|instanceof|new|delete|void|throw|await|yield)$/.test(prevWord);
    }
    return false;
  };

  const skipString = (quote, escapes) => {
    // i points at the opening quote; returns the index after the closing one.
    let j = i + 1;
    while (j < n) {
      const c = text[j];
      if (escapes && c === "\\") {
        j += 2;
        continue;
      }
      if (c === quote) return j + 1;
      if (c === "\n" && lang !== "kt" && quote !== "`") {
        // An unterminated single-line string: give up at the line end rather than eat the file.
        return j;
      }
      j++;
    }
    desync = true;
    return n;
  };

  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];

    // Inside a template expression, a `}` at depth 0 returns to the string.
    if (templates.length > 0) {
      const frame = templates[templates.length - 1];
      if (frame.inExpr) {
        if (c === "{") frame.depth++;
        else if (c === "}") {
          if (frame.depth === 0) {
            frame.inExpr = false;
            i++;
            continue;
          }
          frame.depth--;
        }
      } else {
        // In the string part of a template: look for the closer or `${`.
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (frame.closer === "`" && c === "`") {
          templates.pop();
          i++;
          prevChar = "`";
          continue;
        }
        if (frame.closer === '"""' && text.startsWith('"""', i)) {
          templates.pop();
          i += 3;
          prevChar = '"';
          continue;
        }
        if (frame.closer === '"' && c === '"') {
          templates.pop();
          i++;
          prevChar = '"';
          continue;
        }
        if (c === "$" && c2 === "{") {
          frame.inExpr = true;
          frame.depth = 0;
          i += 2;
          prevChar = "{";
          continue;
        }
        i++;
        continue;
      }
    }

    // Comments.
    if (lineComments && c === "/" && c2 === "/") {
      const start = i;
      let end = text.indexOf("\n", i);
      if (end === -1) end = n;
      let kind = "plain";
      const c3 = text[i + 2];
      const c4 = text[i + 3];
      if (lang === "rs" && ((c3 === "/" && c4 !== "/") || c3 === "!")) kind = "doc";
      if (lang === "kt" && c3 === "/" && c4 !== "/") kind = "doc";
      if ((lang === "ts" || lang === "js") && DIRECTIVE.test(text.slice(i + 2, end))) kind = "directive";
      push(start, end, kind);
      i = end;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const start = i;
      const isDoc = text[i + 2] === "*" && text[i + 3] !== "/" && lang !== "css";
      let depth = 1;
      let j = i + 2;
      while (j < n) {
        if (nested && text[j] === "/" && text[j + 1] === "*") {
          depth++;
          j += 2;
          continue;
        }
        if (text[j] === "*" && text[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
          continue;
        }
        j++;
      }
      if (depth !== 0) desync = true;
      push(start, Math.min(j, n), isDoc ? "doc" : "plain");
      i = j;
      continue;
    }

    // Hashbang on the first line of a script is not a comment.
    if (i === 0 && c === "#" && c2 === "!") {
      let end = text.indexOf("\n");
      i = end === -1 ? n : end;
      continue;
    }

    // Strings.
    if (lang === "rs") {
      // Raw strings: r"…", r#"…"#, br"…", cr"…".
      if ((c === "r" || ((c === "b" || c === "c") && c2 === "r")) && !isIdent(text[i - 1])) {
        let j = i + (c === "r" ? 1 : 2);
        let hashes = 0;
        while (text[j] === "#") {
          hashes++;
          j++;
        }
        if (text[j] === '"') {
          const closer = '"' + "#".repeat(hashes);
          const end = text.indexOf(closer, j + 1);
          if (end === -1) {
            desync = true;
            i = n;
          } else i = end + closer.length;
          prevChar = '"';
          continue;
        }
      }
      if (c === "b" && c2 === '"' && !isIdent(text[i - 1])) {
        i++;
        i = skipString('"', true);
        prevChar = '"';
        continue;
      }
      if (c === "b" && c2 === "'" && !isIdent(text[i - 1])) {
        i++;
        i = skipString("'", true);
        prevChar = "'";
        continue;
      }
      if (c === '"') {
        i = skipString('"', true);
        prevChar = '"';
        continue;
      }
      if (c === "'") {
        // A char literal ('x', '\n', '\u{…}') or a lifetime ('a). Escapes and a closing quote two ahead mean a char.
        if (c2 === "\\") {
          i = skipString("'", true);
        } else if (text[i + 2] === "'") {
          i += 3;
        } else {
          // A multi-byte char literal: the closing quote follows one code point.
          const cp = text.codePointAt(i + 1);
          const len = cp > 0xffff ? 2 : 1;
          if (text[i + 1 + len] === "'" && !isIdent(text[i - 1])) i += 2 + len;
          else i++;
        }
        prevChar = "'";
        continue;
      }
    } else if (lang === "kt") {
      if (text.startsWith('"""', i)) {
        templates.push({ closer: '"""', inExpr: false, depth: 0 });
        i += 3;
        continue;
      }
      if (c === '"') {
        templates.push({ closer: '"', inExpr: false, depth: 0 });
        i++;
        continue;
      }
      if (c === "'") {
        i = skipString("'", true);
        prevChar = "'";
        continue;
      }
    } else if (lang === "css") {
      if (c === '"' || c === "'") {
        i = skipString(c, true);
        prevChar = c;
        continue;
      }
    } else {
      // TypeScript / JavaScript.
      if (c === "`") {
        templates.push({ closer: "`", inExpr: false, depth: 0 });
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        i = skipString(c, true);
        prevChar = c;
        continue;
      }
      if (c === "/" && regexAllowed()) {
        // A regex literal: escapes and character classes consumed, flags after the closer.
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < n && text[j] !== "\n") {
          const d = text[j];
          if (d === "\\") {
            j += 2;
            continue;
          }
          if (inClass) {
            if (d === "]") inClass = false;
          } else if (d === "[") inClass = true;
          else if (d === "/") {
            ok = true;
            break;
          }
          j++;
        }
        if (ok) {
          j++;
          while (j < n && /[a-z]/i.test(text[j])) j++;
          i = j;
          prevChar = "/";
          continue;
        }
        // Not a regex after all (a division at line end): fall through as an operator.
      }
    }

    // Track the previous significant character and word.
    if (isIdent(c)) {
      wordBuf += c;
    } else if (!/\s/.test(c)) {
      wordBuf = "";
    }
    if (!/\s/.test(c)) {
      prevChar = c;
      if (isIdent(c)) prevWord = wordBuf;
    }
    i++;
  }
  return { tokens, desync };
}

// The hash family: YAML, shell and PowerShell.
function lexHash(text, lang) {
  const tokens = [];
  const n = text.length;
  let desync = false;
  const push = (start, end, kind, markerLen) =>
    tokens.push({ start, end, kind, text: text.slice(start + markerLen, end).replace(/#>$/, "") });

  if (lang === "yml") {
    // Line-oriented: block scalars are content, with their own comment lines reported as `embedded`.
    const lines = text.split("\n");
    let offset = 0;
    let scalar = null; // { indent } while inside a block scalar
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lineEnd = offset + line.length;
      const stripped = line.replace(/\r$/, "");
      const indent = stripped.match(/^\s*/)[0].length;
      const blank = stripped.trim() === "";
      if (scalar) {
        if (blank) {
          offset = lineEnd + 1;
          continue;
        }
        if (scalar.contentIndent === null && indent > scalar.indent) scalar.contentIndent = indent;
        if (scalar.contentIndent !== null && indent >= scalar.contentIndent) {
          const body = stripped.slice(indent);
          if (body.startsWith("#")) push(offset + indent, offset + stripped.length, "embedded", 1);
          else if (body.startsWith("//")) push(offset + indent, offset + stripped.length, "embedded", 2);
          offset = lineEnd + 1;
          continue;
        }
        scalar = null;
      }
      // Scan the line for a `#` outside quotes, preceded by whitespace or the line start.
      let j = 0;
      let quote = null;
      let commentAt = -1;
      while (j < stripped.length) {
        const c = stripped[j];
        if (quote) {
          if (quote === '"' && c === "\\") j += 2;
          else if (c === quote) {
            if (quote === "'" && stripped[j + 1] === "'") j += 2;
            else {
              quote = null;
              j++;
            }
          } else j++;
          continue;
        }
        if (c === "#" && (j === 0 || /\s/.test(stripped[j - 1]))) {
          commentAt = j;
          break;
        }
        if ((c === '"' || c === "'") && (j === 0 || /[\s:\[{,-]/.test(stripped[j - 1]))) quote = c;
        j++;
      }
      const code = commentAt === -1 ? stripped : stripped.slice(0, commentAt);
      if (commentAt !== -1) push(offset + commentAt, offset + stripped.length, "plain", 1);
      // A block scalar indicator opens content lines that are more indented than this one.
      if (/(^|[\s:])[|>][-+]?[0-9]?\s*$/.test(code) && !blank) {
        scalar = { indent, contentIndent: null };
      }
      offset = lineEnd + 1;
    }
    return { tokens, desync };
  }

  let i = 0;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (i === 0 && c === "#" && c2 === "!") {
      const end = text.indexOf("\n");
      i = end === -1 ? n : end;
      continue;
    }
    if (lang === "ps1" && c === "<" && c2 === "#") {
      const end = text.indexOf("#>", i + 2);
      if (end === -1) {
        desync = true;
        push(i, n, "plain", 2);
        i = n;
      } else {
        push(i, end + 2, "plain", 2);
        i = end + 2;
      }
      continue;
    }
    if (c === "#") {
      const prev = text[i - 1];
      const startsToken = i === 0 || /[\s(;{|&]/.test(prev);
      if (lang === "sh" && (prev === "$" || (prev === "{" && text[i - 2] === "$"))) {
        i++;
        continue;
      }
      if (startsToken) {
        let end = text.indexOf("\n", i);
        if (end === -1) end = n;
        push(i, end, "plain", 1);
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (lang === "ps1" && c === "@" && (c2 === '"' || c2 === "'") && /\r?\n/.test(text.slice(i + 2, i + 4))) {
      // A here-string closes with the quote and `@` at a line start.
      const closer = "\n" + c2 + "@";
      const end = text.indexOf(closer, i + 2);
      if (end === -1) {
        desync = true;
        i = n;
      } else i = end + closer.length;
      continue;
    }
    if (lang === "sh" && c === "<" && c2 === "<") {
      const m = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(text.slice(i));
      if (m) {
        const word = m[2];
        const lineEnd = text.indexOf("\n", i);
        if (lineEnd === -1) {
          i = n;
          continue;
        }
        // The body runs from the next line to a line holding only the word.
        let j = lineEnd + 1;
        let found = false;
        while (j <= n) {
          let le = text.indexOf("\n", j);
          if (le === -1) le = n;
          if (text.slice(j, le).replace(/^\t+/, "").replace(/\r$/, "") === word) {
            found = true;
            j = le;
            break;
          }
          if (le >= n) break;
          j = le + 1;
        }
        if (!found) desync = true;
        // Keep scanning the operator's own line for further tokens before jumping past the body.
        const rest = lexHash(text.slice(i + m[0].length, lineEnd), lang);
        for (const t of rest.tokens) tokens.push({ ...t, start: t.start + i + m[0].length, end: t.end + i + m[0].length });
        i = found ? j : n;
        continue;
      }
    }
    if (c === "'" ) {
      if (lang === "sh" && text[i - 1] === "$") {
        // $'…' takes backslash escapes.
        let j = i + 1;
        while (j < n && text[j] !== "'") j += text[j] === "\\" ? 2 : 1;
        i = j + 1;
        continue;
      }
      let j = i + 1;
      while (j < n) {
        if (text[j] === "'") {
          if (lang === "ps1" && text[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j >= n) desync = true;
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        const d = text[j];
        if (lang === "sh" && d === "\\") {
          j += 2;
          continue;
        }
        if (lang === "ps1" && d === "`") {
          j += 2;
          continue;
        }
        if (d === '"') {
          if (lang === "ps1" && text[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j >= n) desync = true;
      i = j + 1;
      continue;
    }
    i++;
  }
  return { tokens, desync };
}

function lexHtml(text) {
  const tokens = [];
  let i = 0;
  let desync = false;
  while (i < text.length) {
    const start = text.indexOf("<!--", i);
    if (start === -1) break;
    const end = text.indexOf("-->", start + 4);
    if (end === -1) {
      desync = true;
      tokens.push({ start, end: text.length, kind: "plain", text: text.slice(start + 4) });
      break;
    }
    tokens.push({ start, end: end + 3, kind: "plain", text: text.slice(start + 4, end) });
    i = end + 3;
  }
  return { tokens, desync };
}

/** Every comment in `text`, with offsets, line numbers, kind and content; `desync` when the scanner lost its place. */
export function lexComments(text, lang) {
  let result;
  switch (lang) {
    case "rs":
    case "ts":
    case "js":
    case "kt":
    case "css":
      result = lexC(text, lang);
      break;
    case "yml":
    case "sh":
    case "ps1":
      result = lexHash(text, lang);
      break;
    case "html":
      result = lexHtml(text);
      break;
    default:
      throw new Error(`no lexer for ${lang}`);
  }
  const starts = lineStarts(text);
  for (const t of result.tokens) {
    t.line = lineAt(starts, t.start);
    t.endLine = lineAt(starts, Math.max(t.start, t.end - 1));
  }
  return result;
}

/** `text` with every comment replaced by a single space; the shape the strip check compares. */
export function stripComments(text, lang) {
  const { tokens } = lexComments(text, lang);
  let out = "";
  let last = 0;
  for (const t of tokens) {
    out += text.slice(last, t.start) + " ";
    last = t.end;
  }
  return out + text.slice(last);
}

/** Comment blocks: maximal runs of adjacent comment-only lines of one kind; code beside, a blank or a directive ends one. */
export function blocks(text, lang) {
  const { tokens, desync } = lexComments(text, lang);
  const lines = text.split("\n");
  const starts = lineStarts(text);
  // Which token covers each comment-only line, or null.
  const lineInfo = new Array(lines.length).fill(null);
  for (const t of tokens) {
    for (let ln = t.line; ln <= t.endLine; ln++) {
      const lineStart = starts[ln - 1];
      const lineText = lines[ln - 1].replace(/\r$/, "");
      const lineEnd = lineStart + lineText.length;
      // The line is comment-only when everything outside [t.start, t.end) is whitespace.
      const before = lineText.slice(0, Math.max(0, t.start - lineStart));
      const after = lineText.slice(Math.max(0, Math.min(lineText.length, t.end - lineStart)));
      if (before.trim() === "" && after.trim() === "") {
        lineInfo[ln - 1] = { token: t, ln };
      } else if (lineInfo[ln - 1] === null) {
        lineInfo[ln - 1] = { token: t, ln, trailing: true };
      }
    }
  }
  const out = [];
  let current = null;
  for (let idx = 0; idx < lines.length; idx++) {
    const info = lineInfo[idx];
    if (info && !info.trailing && info.token.kind !== "directive") {
      if (current && current.kind === info.token.kind && current.endLine === idx) {
        current.endLine = idx + 1;
        if (current.tokens[current.tokens.length - 1] !== info.token) current.tokens.push(info.token);
      } else {
        current = { line: idx + 1, endLine: idx + 1, kind: info.token.kind, tokens: [info.token] };
        out.push(current);
      }
    } else {
      current = null;
    }
  }
  for (const b of out) {
    b.length = b.endLine - b.line + 1;
    const first = b.tokens[0];
    b.firstLine = firstContentLine(first.text);
    b.chars = b.length === 1 ? commentChars(first) : null;
  }
  // Single-line comments beside code still have a length to police.
  const trailing = [];
  for (const info of lineInfo) {
    if (info && info.trailing && info.token.line === info.token.endLine) {
      trailing.push({ line: info.ln, kind: info.token.kind, chars: commentChars(info.token) });
    }
  }
  return { blocks: out, trailing, desync, tokens };
}

function firstContentLine(content) {
  for (const raw of content.split("\n")) {
    const line = raw.replace(/^\s*\*+\s?/, "").trim();
    if (line !== "") return line;
  }
  return "";
}

function commentChars(token) {
  return token.text.replace(/\*\/\s*$/, "").trim().length;
}

/** Built-in fixtures; each returns the comments the scanner must and must not see. */
export function selfTest() {
  const cases = [
    ["ts", 'const re = /\\/\\/ not a comment/g; // yes\nconst s = `a ${"//"} b`; /* block */', ["yes", "block"]],
    ["ts", "const x = a / b; // div\nconst y = (a) / 2 // half", ["div", "half"]],
    ["ts", 'return <div>{/* jsx */}</div>; // after', ["jsx", "after"]],
    ["ts", "// @ts-expect-error boom\nconst z = 1;", ["@ts-expect-error boom"]],
    ["rs", 'let s = r#"/* not */ // not"#; // real\nlet c = \'\\\'\'; let l: &\'a str = "x"; /// doc', ["real", "doc"]],
    ["rs", "/* outer /* inner */ still */ let a = 1; //! mod", ["outer /* inner */ still", "mod"]],
    ["kt", 'val s = "a ${x /* in expr */} b" // trailing\nval t = """raw // not"""', ["in expr", "trailing"]],
    ["css", ".a { background: url('x/*y*/'); } /* one */", ["one"]],
    ["yml", 'run: |\n  echo "#no" # shell\n  # inside\n  //also\nkey: v # trail\nurl: http://x/#frag', ["inside", "also", "trail"]],
    ["sh", "cat <<'EOF'\n# not\n// not\nEOF\necho '#no' \"#no\" # yes\nlen=${#x} # count", ["yes", "count"]],
    ["ps1", "$s = @'\n# not\n'@\n<# block\ntwo #>\nWrite-Host '#no' # yes", ["block\ntwo", "yes"]],
    ["html", "<p>a</p><!-- one --><b>b</b>", ["one"]],
  ];
  const failures = [];
  for (const [lang, text, expected] of cases) {
    const { tokens, desync } = lexComments(text, lang);
    const got = tokens.map((t) => t.text.trim());
    const want = expected.map((e) => e.trim());
    const same = got.length === want.length && got.every((g, k) => g === want[k]);
    if (!same || desync) failures.push({ lang, text, got, want, desync });
  }
  return failures;
}
