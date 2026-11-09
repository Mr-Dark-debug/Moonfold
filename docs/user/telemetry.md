# Product usage data

Moonfold collects no product usage data by default and ships no analytics key.

You can opt in to sending anonymous product events to a PostHog project you control. Set all three
variables in the server's environment before starting it:

```bash
MOONFOLD_TELEMETRY_ENABLED=true
MOONFOLD_POSTHOG_KEY=<your project key>
MOONFOLD_POSTHOG_HOST=https://<your posthog host>
```

Events are tied to a hashed installation identifier and include the provider, model, reasoning
effort, permission mode, turn result, duration, and main-agent token totals when available. They
never include prompts, responses, file contents, authentication tokens, conversation IDs, raw
provider events, or child-agent output.

The desktop app reads these variables from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export them there and restart the app. On Windows, set them as user environment variables.

The web app in a browser, including one the `moonfold` CLI opens, does not read these environment
variables. When its build has relay tracing configured, it sends its own connection traces even
if the server has opted out. The browser app has no relay tracing toggle.

## Mobile app diagnostics

When the iOS or Android app crashes or hits an error, it sends a report to Moonfold: the error
message, the stack trace, the app version, and the device model and OS version. Each launch also
sends startup timings, and every report carries a random ID for the install. Reports go through
the Moonfold Connect relay to Axiom. They do not include your threads, prompts, or connection details,
but an error message can quote a value the app was handling.

To stop sending them, turn off **Send crash reports** in **Settings > About Moonfold > Diagnostics**.

The mobile app also sends relay connection traces when its build has tracing configured. These
carry an identifier for the current app session. **Send crash reports** does not control these
traces, and the mobile app has no separate relay tracing toggle. Server environment variables and
managed policy do not disable mobile tracing.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the Moonfold Connect relay for
[mobile notifications and live activities](./mobile-notifications.md). This is separate from
product events and relay diagnostics. The telemetry opt-out does not disable it.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`MOONFOLD_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `MOONFOLD_OTLP_*_URL`, set `MOONFOLD_OTLP_HEADERS` for
receivers that need authentication and `MOONFOLD_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
