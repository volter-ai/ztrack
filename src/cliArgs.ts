export function optionValue(args: string[], name: string, fallback = ''): string {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : fallback;
}
