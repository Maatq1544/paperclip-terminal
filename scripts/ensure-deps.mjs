// Ensure plugin SDK dependencies are available
import { existsSync } from "fs";
import { join } from "path";

const sdkPath = join(process.cwd(), "node_modules", "@paperclipai", "plugin-sdk");
if (!existsSync(sdkPath)) {
  console.log("Installing dependencies...");
  console.log("Run: pnpm install");
}
