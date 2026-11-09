// @effect-diagnostics nodeBuiltinImport:off -- the test owns a real window process and ends it by pid.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@moonfold/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as ServerConfig from "../config.ts";
import * as ComputerUseHelper from "./ComputerUseHelper.ts";

/**
 * A window that exists only for this test: a text box, a password box and a button that copies
 * the text into a label. The test acts on this window alone, never on the user's apps.
 */
const TEST_WINDOW_SCRIPT = [
  "param([string]$Title)",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$form = New-Object System.Windows.Forms.Form",
  "$form.Text = $Title",
  "$form.Size = New-Object System.Drawing.Size(520, 260)",
  "$form.StartPosition = 'CenterScreen'",
  "$form.TopMost = $true",
  "$box = New-Object System.Windows.Forms.TextBox",
  "$box.Location = New-Object System.Drawing.Point(20, 20)",
  "$box.Size = New-Object System.Drawing.Size(460, 30)",
  "$form.Controls.Add($box)",
  "$secret = New-Object System.Windows.Forms.TextBox",
  "$secret.UseSystemPasswordChar = $true",
  "$secret.Text = 'hunter2'",
  "$secret.Location = New-Object System.Drawing.Point(20, 60)",
  "$secret.Size = New-Object System.Drawing.Size(200, 30)",
  "$form.Controls.Add($secret)",
  "$button = New-Object System.Windows.Forms.Button",
  "$button.Text = 'Copy'",
  "$button.Location = New-Object System.Drawing.Point(20, 100)",
  "$button.Size = New-Object System.Drawing.Size(120, 36)",
  "$form.Controls.Add($button)",
  "$label = New-Object System.Windows.Forms.Label",
  "$label.Text = 'Result: (empty)'",
  "$label.Location = New-Object System.Drawing.Point(160, 108)",
  "$label.Size = New-Object System.Drawing.Size(320, 30)",
  "$form.Controls.Add($label)",
  "$button.Add_Click({ $label.Text = 'Result: ' + $box.Text })",
  "[System.Windows.Forms.Application]::Run($form)",
].join("\n");

interface Element {
  readonly type: string;
  readonly name: string;
  readonly rect?: readonly [number, number, number, number];
  readonly password?: boolean;
}

const center = (element: Element) => {
  const [x, y, width, height] = element.rect ?? [0, 0, 0, 0];
  return { x: x + Math.round(width / 2), y: y + Math.round(height / 2) };
};

it.effect.skipIf(HostProcess.Platform.defaultValue() !== "win32")(
  "reads and operates a window it owns, and never returns a password",
  () =>
    Effect.gen(function* () {
      const helper = yield* ComputerUseHelper.ComputerUseHelper;
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "moonfold-cu-"));
      const scriptPath = NodePath.join(directory, "window.ps1");
      NodeFS.writeFileSync(scriptPath, TEST_WINDOW_SCRIPT);
      const title = `Moonfold computer-use test ${NodeCrypto.randomUUID().slice(0, 8)}`;
      const owned = NodeChildProcess.spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Title", title],
        { stdio: "ignore" },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          owned.kill();
          NodeFS.rmSync(directory, { recursive: true, force: true });
        }),
      );

      // The window appears when PowerShell has loaded Windows Forms.
      const window = yield* helper.request("listWindows").pipe(
        Effect.map((result) =>
          (
            result as { windows: ReadonlyArray<{ window: string; title: string; pid: number }> }
          ).windows.find((candidate) => candidate.title === title && candidate.pid === owned.pid),
        ),
        Effect.flatMap((found) => (found ? Effect.succeed(found.window) : Effect.fail("not yet"))),
        Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 80 }),
      );

      const read = () =>
        helper
          .request("read", { window })
          .pipe(Effect.map((result) => (result as { elements: ReadonlyArray<Element> }).elements));
      const elements = yield* read();
      const secret = elements.find((element) => element.password === true);
      assert.isDefined(secret);
      assert.strictEqual(secret?.name, "");
      assert.isFalse(JSON.stringify(elements).includes("hunter2"));

      const box = elements[1]!;
      const button = elements.find((element) => element.name === "Copy")!;
      yield* helper.request("click", { window, ...center(box) });
      yield* helper.request("type", { window, text: "Hello from Moonfold" });
      yield* helper.request("click", { window, ...center(button) });
      const label = yield* read().pipe(
        Effect.map((after) => after.find((element) => element.name.startsWith("Result"))?.name),
        Effect.filterOrFail(
          (text) => text === "Result: Hello from Moonfold",
          (text) => text,
        ),
        Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 20 }),
      );
      assert.strictEqual(label, "Result: Hello from Moonfold");

      const outside = yield* helper
        .request("click", { window, x: 5000, y: 5 })
        .pipe(Effect.asVoid, Effect.flip);
      assert.include(outside.message, "outside the window");

      const shot = (yield* helper.request("screenshot", { window })) as {
        width: number;
        png: string;
      };
      assert.strictEqual(shot.width, 520);
      assert.isAbove(shot.png.length, 1000);
      yield* helper.stop;
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ComputerUseHelper.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "moonfold-computer-use-test-" }),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);
