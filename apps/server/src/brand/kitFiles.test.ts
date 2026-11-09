import { describe, expect, it } from "@effect/vitest";

import {
  absolutizeKitImages,
  ensureBrandGitignore,
  gitignoreKeepsReferencesPrivate,
  isAllowedFontLicense,
  isFontLicenseFileName,
  isIgnoredByGitignore,
  kitRelativePath,
  nameSlug,
  svgProblems,
  trademarkSearchUrl,
} from "./kitFiles.ts";

describe("kitRelativePath", () => {
  it("normalizes paths inside the kit", () => {
    expect(kitRelativePath("directions/a.html")).toBe("directions/a.html");
    expect(kitRelativePath("./logo\\png//mark.png")).toBe("logo/png/mark.png");
  });

  it("rejects paths that leave the kit", () => {
    for (const path of [
      "../secrets.txt",
      "logo/../../x.png",
      "/etc/passwd",
      "\\\\server\\share\\x",
      "C:\\Users\\x.png",
      "c:x.png",
      "file:///etc/passwd",
      "",
      ".",
      "a\0b",
    ]) {
      expect(kitRelativePath(path), path).toBeUndefined();
    }
  });
});

describe("svgProblems", () => {
  it("accepts plain artwork with local references", () => {
    expect(
      svgProblems(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use xlink:href="#g"/><image href="data:image/png;base64,AAAA"/></svg>',
      ),
    ).toEqual([]);
  });

  it("finds scripts, handlers, foreign content and outside references", () => {
    expect(svgProblems("<svg><script>alert(1)</script></svg>")).toEqual([
      "it contains a <script> element",
    ]);
    expect(svgProblems('<svg><rect onload="x()"/></svg>')).toEqual([
      "it has an event handler attribute (on...=)",
    ]);
    expect(svgProblems("<svg><foreignObject/></svg>")).toEqual([
      "it contains a <foreignObject> element",
    ]);
    expect(svgProblems('<svg><a href="https://example.com"/></svg>')).toEqual([
      "it links outside the file (https://example.com)",
    ]);
    expect(svgProblems('<svg><image xlink:href="//cdn.example.com/a.png"/></svg>')).toEqual([
      "it links outside the file (//cdn.example.com/a.png)",
    ]);
    expect(svgProblems('<svg><rect style="fill:url(file:///etc/x)"/></svg>')).toEqual([
      "it loads a resource outside the file (file:///etc/x)",
    ]);
    expect(svgProblems("<svg><style>@import 'x.css';</style></svg>")).toEqual([
      "its style imports another stylesheet",
    ]);
  });

  it("sees through character references", () => {
    expect(svgProblems('<svg><a href="&#106;avascript:alert(1)"/></svg>')).toContain(
      "it uses a javascript: URL",
    );
    expect(svgProblems('<svg><rect &#x6f;nclick="x()"/></svg>')).toContain(
      "it has an event handler attribute (on...=)",
    );
  });
});

describe("font licenses", () => {
  it("recognizes license file names", () => {
    for (const name of [
      "OFL.txt",
      "ofl-1.1.txt",
      "LICENSE",
      "LICENSE.txt",
      "License.md",
      "LICENCE",
    ]) {
      expect(isFontLicenseFileName(name), name).toBe(true);
    }
    expect(isFontLicenseFileName("Inter.woff2")).toBe(false);
    expect(isFontLicenseFileName("OFL.pdf")).toBe(false);
  });

  it("allows only OFL, Apache and MIT texts", () => {
    expect(
      isAllowedFontLicense(
        "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
      ),
    ).toBe(true);
    expect(isAllowedFontLicense("Apache License\nVersion 2.0, January 2004")).toBe(true);
    expect(isAllowedFontLicense("The MIT License (MIT)")).toBe(true);
    expect(isAllowedFontLicense("All rights reserved. Desktop use only.")).toBe(false);
  });
});

describe(".gitignore", () => {
  it("evaluates rules the way git does for the kit's folders", () => {
    expect(isIgnoredByGitignore(".moonfold/\n!.moonfold/brand/\n", ".moonfold/brand/tokens")).toBe(
      true,
    );
    expect(isIgnoredByGitignore(".moonfold/*\n!.moonfold/brand/\n", ".moonfold/brand/tokens")).toBe(
      false,
    );
    expect(
      isIgnoredByGitignore("/.moonfold/brand/references/\n", ".moonfold/brand/references"),
    ).toBe(true);
    expect(isIgnoredByGitignore("node_modules\n", ".moonfold/brand/tokens")).toBe(false);
  });

  it("adds the references rule to a project that does not ignore .moonfold", () => {
    const edited = ensureBrandGitignore("node_modules/\n");
    expect(edited).toEqual({
      changed: true,
      text: "node_modules/\n\n# Moonfold brand kit: commit the kit, keep reference screenshots private.\n.moonfold/brand/references/\n",
    });
    expect(gitignoreKeepsReferencesPrivate(edited.text)).toBe(true);
    expect(ensureBrandGitignore(edited.text)).toEqual({ text: edited.text, changed: false });
  });

  it("re-includes the kit when the project ignores .moonfold, keeping its line endings", () => {
    const edited = ensureBrandGitignore("dist\r\n/.moonfold/\r\n");
    expect(edited.text).toBe(
      "dist\r\n/.moonfold/*\r\n\r\n# Moonfold brand kit: commit the kit, keep reference screenshots private.\r\n!.moonfold/brand/\r\n.moonfold/brand/references/\r\n",
    );
    expect(gitignoreKeepsReferencesPrivate(edited.text)).toBe(true);
    expect(isIgnoredByGitignore(edited.text, ".moonfold/vcs.json")).toBe(true);
  });

  it("starts a .gitignore when the project has none", () => {
    expect(ensureBrandGitignore("").text).toBe(
      "# Moonfold brand kit: commit the kit, keep reference screenshots private.\n.moonfold/brand/references/\n",
    );
  });
});

describe("names", () => {
  it("slugs names for domains and packages", () => {
    expect(nameSlug("Café Lumière")).toBe("cafe-lumiere");
    expect(nameSlug("  North_Star 2  ")).toBe("north-star-2");
    expect(nameSlug("!!!")).toBe("");
  });

  it("links to a trademark search for the name", () => {
    expect(trademarkSearchUrl("Café & Co")).toBe(
      "https://branddb.wipo.int/en/similarname?sort=score&strategy=concept&q=Caf%C3%A9%20%26%20Co",
    );
  });
});

describe("absolutizeKitImages", () => {
  const resolve = (relative: string) =>
    relative.startsWith("..") ? undefined : `/kit/directions/${relative}`;

  it("rewrites relative images inside the kit and leaves everything else", () => {
    expect(
      absolutizeKitImages(
        '<img src="a.png"><img src=\'shots/b.jpg\'><div style="background:url(c.svg)"></div><img src="https://x.test/d.png"><img src="../e.png"><a href="page.html">',
        resolve,
      ),
    ).toBe(
      '<img src="/kit/directions/a.png"><img src=\'/kit/directions/shots/b.jpg\'><div style="background:url(/kit/directions/c.svg)"></div><img src="https://x.test/d.png"><img src="../e.png"><a href="page.html">',
    );
  });
});
