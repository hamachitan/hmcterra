import { Readable } from "node:stream";

type LogData = string | Buffer | NodeJS.ReadableStream;

async function* toAsyncIterable(data: LogData): AsyncIterable<Buffer> {
  if (typeof data === "string") {
    yield Buffer.from(data);
    return;
  }

  if (Buffer.isBuffer(data)) {
    yield data;
    return;
  }

  const readable = data as Readable;
  for await (const chunk of readable) {
    if (typeof chunk === "string") yield Buffer.from(chunk);
    else yield chunk as Buffer;
  }
}

export async function tailMatchingLines(data: LogData, limit: number): Promise<string[]> {
  // `<timestamp> rpmbuild │ `
  const prefixRegex = /^\S+ \w+ │ /;
  const tail: string[] = [];
  let buffer = "";

  const pushLine = (line: string) => {
    if (!prefixRegex.test(line)) return;
    const stripped = line.replace(prefixRegex, "");
    tail.push(stripped);
    if (tail.length > limit) tail.shift();
  };

  for await (const chunk of toAsyncIterable(data)) {
    buffer += chunk.toString("utf8");
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      pushLine(line);
      idx = buffer.indexOf("\n");
    }
  }

  if (buffer.length > 0) {
    pushLine(buffer.replace(/\r$/, ""));
  }

  return tail;
}
