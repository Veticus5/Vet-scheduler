import { spawn } from "node:child_process";
import { PORT } from "./config";
import { getDb } from "./db";
import { createServer } from "./server";

// Ensure the database + schema exist before accepting requests.
getDb();

const server = createServer(PORT);
const urlString = `http://localhost:${server.port}`;
console.log(`Vet Scheduler działa: ${urlString}`);

openBrowser(urlString);

/** Open the default browser to the app (best-effort, cross-platform). */
function openBrowser(target: string): void {
  if (process.env.VET_NO_OPEN) return;
  try {
    const platform = process.platform;
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    console.log(`Otwórz w przeglądarce: ${target}`);
  }
}
