import { NodeLibraryFolder } from "../project-library/node-folder";
import { ConnectedLibrary } from "../../shared/project-library/library";
import { AutomationService, commandFailure, CommandError } from "./service";
import { nodeArtifacts } from "./node-artifacts";
import { nodeProjectEditLocks } from "./project-locks";
import { readCliInput, serveMcp } from "./stdio";

const [, , option, root, command, ...extra] = process.argv;
try {
  if (option !== "--library" || !root || !command || extra.length) {
    throw new CommandError("invalid-command", "Usage: node dist/automation/cli.js --library ABSOLUTE_FOLDER COMMAND|mcp");
  }
  if (command === "begin_edit" || command === "end_edit") {
    throw new CommandError("invalid-command", "Edit sessions need a persistent MCP connection. The CLI locks each mutation while it runs.");
  }
  const folder = await NodeLibraryFolder.connect(root);
  const service = new AutomationService(new ConnectedLibrary(folder), nodeArtifacts(folder), nodeProjectEditLocks(folder));
  try {
    if (command === "mcp") await serveMcp(service, process.stdin, process.stdout);
    else {
      const result = await service.execute(command, await readCliInput(process.stdin));
      console.log(JSON.stringify({ ok: true, result }));
    }
  } finally {
    service.close();
  }
} catch (cause) {
  const output = commandFailure(cause);
  if (command === "mcp") console.error(JSON.stringify(output));
  else console.log(JSON.stringify(output));
  process.exitCode = 1;
}
