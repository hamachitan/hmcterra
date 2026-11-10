// vim: ts=2 sw=2
import type { Command } from "../command.ts";

interface CommandInfo {
  flags: { [flag: string]: string[] };
  description?: string;
  usage?: string;
}

export default class HelpCommand
  implements Command<Record<PropertyKey, never>> {
  flags = {};
  description = "List all available commands and their usages.";
  usage = "help";
  commands: Record<string, CommandInfo> = {};

  exec(): Promise<string> {
    const groups = new Map<CommandInfo, string[]>();
    for (const [name, command] of Object.entries(this.commands)) {
      const names = groups.get(command) ?? [];
      names.push(name);
      groups.set(command, names);
    }

    const lines = [...groups.entries()].map(([command, names]) => {
      const usage = command.usage ?? names[0];
      const aliases = names.slice(1);
      let line = `- \`${usage}\`\n  ${command.description ?? ""}`;
      if (aliases.length > 0) {
        line += `\n  Aliases: ${aliases.map((name) => `\`${name}\``).join(", ")}`;
      }
      return line;
    });

    return Promise.resolve([
      "### Available commands",
      "",
      "Use `@hamachitan <command>` or `hmct <command>`.",
      "",
      lines.join("\n"),
    ].join("\n"));
  }
}
