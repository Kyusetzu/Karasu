/**
 * AniList descriptions are HTML written by other users, and they are rendered
 * with `dangerouslySetInnerHTML` — the markup has to be trusted after this
 * function, so this function is the whole guarantee.
 */

const ALLOWED_TAGS = /^(b|i|em|strong|br)$/i;

/**
 * Strips spoilers and reduces the markup to five tags with no attributes.
 *
 * Allowing a *tag name* is not the same as allowing a tag. The previous
 * version tested only the name — `<(?!\/?(b|i|em|strong|br)\b)[^>]*>` — and
 * `\b` matches at the space before an attribute, so `<b onmouseover="…">` read
 * as an allowed tag and passed through whole, handlers and all. An event
 * handler set through `innerHTML` does run, unlike a `<script>` element, so
 * that was a live path from a description to script execution in a WebView
 * with `"csp": null`.
 *
 * Rebuilding each surviving tag from its name only is what closes it: nothing
 * from inside the angle brackets is carried over, so there is no attribute to
 * get wrong. Anything that is not an allowed tag — including comments and
 * doctypes, which `[a-zA-Z]` rejects — is dropped entirely.
 */
export function sanitizeDescription(html: string): string {
  return html.replace(/~!([\s\S]*?)!~/g, "").replace(/<[^>]*>/g, (tag) => {
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b/.exec(tag);
    return m && ALLOWED_TAGS.test(m[2]) ? `<${m[1]}${m[2].toLowerCase()}>` : "";
  });
}
