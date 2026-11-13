import { useAtomValue } from "@effect/atom-react";
import type { DesktopUpdateChannel } from "@moonfold/contracts";
import {
  CLI_RELEASE_CHECKSUMS_FILE,
  cliReleaseIndexPageUrl,
  cliReleaseTagApiUrl,
  newestCliReleaseVersion,
  releaseDatabaseMigration,
} from "@moonfold/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

const decodeRelease = Schema.decodeUnknownOption(
  Schema.Struct({
    draft: Schema.optional(Schema.Boolean),
    assets: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
);

/**
 * Whether Moonfold `<version>` is published on GitHub Releases with its checksums, which is where
 * servers download their update archives. A 404 or a draft is false; network and API errors stay
 * unknown. Both re-check every few minutes, so a release that lands later shows up without a
 * reload.
 */
export const cliReleasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(cliReleaseTagApiUrl(version));
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      return Option.match(decodeRelease(body), {
        onNone: () => false,
        onSome: (release) =>
          release.draft !== true &&
          release.assets.some((asset) => asset.name === CLI_RELEASE_CHECKSUMS_FILE),
      });
    }).pipe(
      // Tracing headers would make the browser send a CORS preflight for a simple GET.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`cli-release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("cli-release-published:none"),
);

/** True only once GitHub confirms the release, so callers can hide work that would download it
    until then. */
export function useCliReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? cliReleasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}

const decodeReleaseIndex = Schema.decodeUnknownOption(
  Schema.Array(
    Schema.Struct({
      tag_name: Schema.String,
      draft: Schema.optional(Schema.Boolean),
      body: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
);

/** Newest-first pages to read before giving up on a track. */
const RELEASE_INDEX_PAGES = 3;

/**
 * The newest Moonfold release on a desktop update track, from GitHub Releases (where servers and
 * desktop apps update from), or null when the track has none. Its database migration comes from
 * the marker the release workflow stamps into the notes; a release without one leaves it
 * undefined, and a switch that would cross databases stays blocked.
 */
export const cliChannelReleaseAtom = Atom.family((channel: DesktopUpdateChannel) =>
  Atom.make(
    Effect.gen(function* () {
      const releaseChannel = channel === "nightly" ? "nightly" : "stable";
      for (let page = 1; page <= RELEASE_INDEX_PAGES; page += 1) {
        const response = yield* HttpClient.get(cliReleaseIndexPageUrl(page));
        const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap((ok) => ok.json),
        );
        const releases = Option.getOrElse(decodeReleaseIndex(body), () => []);
        const version = newestCliReleaseVersion(releases, releaseChannel);
        if (version !== undefined) {
          const notes = releases.find((release) => release.tag_name === `v${version}`)?.body;
          return { version, databaseMigration: releaseDatabaseMigration(notes) };
        }
        if (releases.length < 100) break;
      }
      return null;
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withLabel(`cli-channel-release:${channel}`)),
);
