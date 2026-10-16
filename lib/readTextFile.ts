type ReadTextFileOptions = {
  encoding?: string;
  fallbackEncoding?: string;
};

export async function readTextFile(
  file: File,
  options: ReadTextFileOptions = {},
): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  if (options.encoding) {
    return new TextDecoder(options.encoding).decode(bytes);
  }

  let encoding: string = "utf-8";
  let offset = 0;

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    offset = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    offset = 2;
  } else if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    encoding = "utf-8";
    offset = 3;
  }

  const content = bytes.slice(offset);
  if (offset === 0 && options.fallbackEncoding) {
    let utf8: string;
    try {
      utf8 = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return new TextDecoder(options.fallbackEncoding).decode(content);
    }
    return utf8;
  }

  return new TextDecoder(encoding).decode(content);
}
