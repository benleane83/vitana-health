const targets = process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  if (separator < 1) throw new Error(`Expected a Name=URL target, received: ${argument}`);
  return { name: argument.slice(0, separator), url: argument.slice(separator + 1) };
});

if (targets.length === 0) throw new Error("At least one Name=URL target is required.");

try {
  await Promise.all(targets.map(async ({ name, url }) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
    console.log(`${name} ready: ${url}`);
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
