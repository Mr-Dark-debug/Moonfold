import { describe, expect, it } from "vite-plus/test";

import { parseFeed } from "./channels.ts";

describe("parseFeed", () => {
  it("reads RSS and Atom items as plain text, never markup", () => {
    const rss = `<rss><channel><title>Feed</title>
      <item><title>Export &amp; import broke</title><link>https://example.dev/a</link>
        <description><![CDATA[<p>It <b>crashes</b> &lt;sometimes&gt;</p>]]></description>
        <pubDate>Tue, 11 Nov 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(parseFeed("feed:example.dev", rss)).toEqual([
      {
        source: "feed:example.dev",
        url: "https://example.dev/a",
        title: "Export & import broke",
        text: "It crashes <sometimes>",
        at: "Tue, 11 Nov 2026 10:00:00 GMT",
      },
    ]);

    const atom = `<feed><entry><title>Dark mode please</title>
      <link href="https://www.reddit.com/r/x/comments/1/"/>
      <content type="html">&lt;div&gt;Would love it&lt;/div&gt;</content>
      <updated>2026-11-11T10:00:00Z</updated></entry></feed>`;
    const [entry] = parseFeed("reddit:r/x", atom);
    expect(entry?.url).toBe("https://www.reddit.com/r/x/comments/1/");
    expect(entry?.text).toBe("<div>Would love it</div>");
  });

  it("caps how much it takes from one feed and from one post", () => {
    const item = `<item><title>t</title><link>https://example.dev</link><description>${"x".repeat(5_000)}</description></item>`;
    const posts = parseFeed("feed", `<rss>${item.repeat(40)}</rss>`);
    expect(posts).toHaveLength(15);
    expect(posts[0]!.text.length).toBe(600);
  });
});
