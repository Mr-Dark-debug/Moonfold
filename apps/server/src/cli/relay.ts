import { PortSchema } from "@moonfold/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command, Flag } from "effect/cli";

import { startNodeRelay } from "../anywhere/nodeRelay.ts";

const portFlag = Flag.Int("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port to listen on."),
  Flag.withDefault(8787),
);

const hostFlag = Flag.String("host").pipe(
  Flag.withDescription("Address to listen on."),
  Flag.withDefault("0.0.0.0"),
);

/** `moonfold relay`: run an Anywhere relay (D-69) on a machine phones and computers can reach. */
export const relayCommand = Command.make("relay", { port: portFlag, host: hostFlag }).pipe(
  Command.withDescription(
    "Run a relay that lets phones reach Moonfold on another network. It only forwards encrypted bytes; put it behind TLS (wss://) for production.",
  ),
  Command.withHandler((flags) =>
    Effect.acquireRelease(
      Effect.promise(() => startNodeRelay({ port: flags.port, host: flags.host })),
      (relay) => Effect.promise(() => relay.close()),
    ).pipe(
      Effect.tap((relay) =>
        Console.log(
          `Moonfold Anywhere relay listening on ${flags.host}:${relay.port}. Point Settings → Mobile App → Relay at its wss:// address.`,
        ),
      ),
      Effect.andThen(Effect.never),
      Effect.scoped,
    ),
  ),
);
