async function runRpmspecCommand(
  specContent: string,
  args: string[],
): Promise<string> {
  const tempFile = await Deno.makeTempFile({
    prefix: "spec-",
    suffix: ".spec",
  });
  await Deno.writeFile(tempFile, new TextEncoder().encode(specContent));

  const child = await new Deno.Command("rpmspec", {
    args: [...args, tempFile],
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.remove(tempFile);

  if (child.code === 0) return new TextDecoder().decode(child.stdout).trim();
  throw new Error(`rpmspec failed: ${child.stderr.toString()}`);
}

export async function runRpmspec(
  specContent: string,
  queryFormat: string,
  extraArgs: string[] = [],
): Promise<string> {
  return await runRpmspecCommand(specContent, [
    "-q",
    "--undefine=dist",
    ...extraArgs,
    "--queryformat",
    queryFormat,
  ]);
}

export async function parseSpec(specContent: string): Promise<string> {
  return await runRpmspecCommand(specContent, ["-P", "--undefine=dist"]);
}
