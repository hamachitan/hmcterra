export async function runRpmspec(
  specContent: string,
  queryFormat: string,
  extraArgs: string[] = [],
): Promise<string> {
  const tempFile = await Deno.makeTempFile({
    prefix: "spec-",
    suffix: ".spec",
  });
  Deno.writeFile(tempFile, new TextEncoder().encode(specContent));

  const child = await new Deno.Command("rpmspec", {
    args: [
      "-q",
      tempFile,
      "--undefine=dist",
      ...extraArgs,
      "--queryformat",
      queryFormat,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.remove(tempFile);

  if (child.code === 0) return new TextDecoder().decode(child.stdout).trim();
  throw new Error(`rpmspec failed: ${child.stderr.toString()}`);
}
